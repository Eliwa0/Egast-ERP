from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import TransferWarehouseRule, UserModulePermission, UserProfile
from api.services.transfer_service import TransferValidationError
from api.views import _create_pending_transfer_request, _transfer_rule_matches


STAGES = (
    TransferWarehouseRule.STAGE_1_TO_INTERMEDIATE,
    TransferWarehouseRule.STAGE_2_TO_FRIDGE,
    TransferWarehouseRule.STAGE_3_FROM_FRIDGE,
    TransferWarehouseRule.STAGE_4_TO_DESTINATION,
)


class TransferStagePermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('stage_operator', password='test-password')
        self.admin = User.objects.create_user('stage_admin', password='test-password')
        self.super_admin = User.objects.create_superuser('stage_super', 'super@example.test', 'test-password')
        UserProfile.objects.filter(user=self.user).update(role='transfer_user')
        UserProfile.objects.filter(user=self.admin).update(role='transfer_admin')
        self.client.force_login(self.user)

    def add_route(self, stage):
        for code, direction in (('SOURCE', 'FROM'), ('DEST', 'TO')):
            TransferWarehouseRule.objects.create(
                user=self.user, warehouse_code=code, direction=direction, stage=stage,
            )

    def move(self, stage):
        pending = SimpleNamespace(
            id=42, status='PENDING', transfer_stage=stage,
            from_warehouse='SOURCE', to_warehouse='DEST', from_bin='', to_bin='',
            item_code='', batch_number='', quantity=0,
            pallet_position_code='', source_pallet_position_code='',
        )
        payload = {'transfer_stage': stage, 'from_warehouse': 'SOURCE', 'to_warehouse': 'DEST'}
        with patch('api.views.transfer_service._validate_move_payload'), \
             patch('api.views._annotate_transfer_payload_sources', return_value=(payload, False)), \
             patch('api.views._create_pending_transfer_request_with_retry', return_value=pending) as create, \
             patch('api.views.log_action'):
            response = self.client.post('/api/transfer/move/', payload, format='json')
        return response, create

    def test_each_explicit_stage_allows_only_itself_before_creation_or_reservation(self):
        for permitted in STAGES:
            with self.subTest(permitted=permitted):
                TransferWarehouseRule.objects.filter(user=self.user).delete()
                self.add_route(permitted)
                for attempted in STAGES:
                    with self.subTest(attempted=attempted):
                        response, create = self.move(attempted)
                        if attempted == permitted:
                            self.assertEqual(response.status_code, 200, response.content)
                            create.assert_called_once()
                        else:
                            self.assertEqual(response.status_code, 403, response.content)
                            create.assert_not_called()

    def test_no_rules_denies_all_stages_to_transfer_user(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                response, create = self.move(stage)
                self.assertEqual(response.status_code, 403)
                create.assert_not_called()

    def test_legacy_both_grants_first_two_stages_but_not_outbound(self):
        self.add_route(TransferWarehouseRule.STAGE_BOTH)
        for stage in STAGES:
            with self.subTest(stage=stage):
                response, create = self.move(stage)
                self.assertEqual(response.status_code, 403 if stage in STAGES[2:] else 200)
                if stage in STAGES[2:]:
                    create.assert_not_called()

    def test_rule_api_accepts_explicit_outbound_stage(self):
        self.client.force_login(self.admin)
        response = self.client.post('/api/transfer/rules/warehouse-access/', {
            'user_id': self.user.id, 'warehouse_code': 'SOURCE',
            'direction': 'FROM', 'stage': STAGES[2],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(TransferWarehouseRule.objects.get(user=self.user).stage, STAGES[2])

    def test_stage4_rule_save_reload_and_runtime_warehouse_restrictions(self):
        self.client.force_login(self.admin)
        for warehouse, direction in [('SOURCE', 'FROM'), ('DEST', 'TO')]:
            response = self.client.post('/api/transfer/rules/warehouse-access/', {
                'user_id': self.user.pk, 'warehouse_code': warehouse,
                'direction': direction, 'stage': STAGES[3]}, format='json')
            self.assertEqual(response.status_code, 201, response.content)
        refreshed = self.client.get('/api/transfer/rules/warehouse-access/')
        self.assertEqual(refreshed.status_code, 200)
        saved = [row for row in refreshed.data['data']['rules'] if row['user_id'] == self.user.pk]
        self.assertEqual({(row['warehouse_code'], row['direction'], row['stage']) for row in saved},
                         {('SOURCE', 'FROM', STAGES[3]), ('DEST', 'TO', STAGES[3])})
        self.client.force_login(self.user)
        access = self.client.get('/api/transfer/warehouse-access/me/')
        self.assertEqual(access.status_code, 200)
        self.assertEqual(len(access.data['data']['access']['rules']), 2)
        response, create = self.move(STAGES[3])
        self.assertEqual(response.status_code, 200, response.content)
        create.assert_called_once()
        from api.views import _user_can_access_transfer_warehouse
        self.assertTrue(_user_can_access_transfer_warehouse(self.user, 'SOURCE', 'FROM', STAGES[3]))
        self.assertTrue(_user_can_access_transfer_warehouse(self.user, 'DEST', 'TO', STAGES[3]))
        self.assertFalse(_user_can_access_transfer_warehouse(self.user, 'DEST', 'FROM', STAGES[3]))
        self.assertFalse(_user_can_access_transfer_warehouse(self.user, 'SOURCE', 'TO', STAGES[3]))
        self.assertFalse(_user_can_access_transfer_warehouse(self.user, 'OTHER', 'FROM', STAGES[3]))

    def test_admin_pending_list_and_post_boundary(self):
        self.assertEqual(self.client.get('/api/admin/pending-transfers/').status_code, 403)
        self.assertEqual(self.client.post('/api/admin/pending-transfers/999/post/').status_code, 403)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get('/api/admin/pending-transfers/?refresh_sources=false').status_code, 200)
        self.assertEqual(self.client.post('/api/admin/pending-transfers/999/post/').status_code, 404)
        self.client.force_login(self.super_admin)
        self.assertEqual(self.client.get('/api/admin/pending-transfers/?refresh_sources=false').status_code, 200)

    def test_cold_storage_reads_require_relevant_stage_and_mutations_stay_admin_only(self):
        url = '/api/cold-storage/SOURCE/layout/'
        self.assertEqual(self.client.get(url).status_code, 403)
        self.add_route(STAGES[0])
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertEqual(self.client.post('/api/cold-storage/positions/999/reserve/').status_code, 403)
        TransferWarehouseRule.objects.filter(user=self.user).delete()
        self.add_route(STAGES[2])
        with patch('api.services.cold_storage_layout_service.get_cold_storage_layout_service') as factory:
            factory.return_value.get_warehouse_layout.return_value = {'hierarchy': []}
            self.assertEqual(self.client.get(url).status_code, 200)
        self.client.logout()
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_both_matcher_never_covers_stage_three(self):
        rule = TransferWarehouseRule(stage=TransferWarehouseRule.STAGE_BOTH, direction='FROM')
        self.assertTrue(_transfer_rule_matches(rule, 'FROM', STAGES[0]))
        self.assertTrue(_transfer_rule_matches(rule, 'FROM', STAGES[1]))
        self.assertFalse(_transfer_rule_matches(rule, 'FROM', STAGES[2]))

    def test_position_reservation_fields_are_bound_to_their_stage(self):
        with self.assertRaisesRegex(TransferValidationError, 'Stage 2'):
            _create_pending_transfer_request(self.user, {
                'transfer_stage': STAGES[0], 'pallet_position_id': 999,
            })
        with self.assertRaisesRegex(TransferValidationError, 'Stage 3'):
            _create_pending_transfer_request(self.user, {
                'transfer_stage': STAGES[1], 'source_pallet_position_id': 999,
            })

    def test_other_module_admin_does_not_bypass_transfer_warehouse_rules(self):
        UserModulePermission.objects.create(user=self.user, module=UserModulePermission.MODULE_PRODUCTION, level='ADMIN')
        UserModulePermission.objects.create(user=self.user, module=UserModulePermission.MODULE_TRANSFER, level='USER')
        response, create = self.move(STAGES[0])
        self.assertEqual(response.status_code, 403)
        create.assert_not_called()
