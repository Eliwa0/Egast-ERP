from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (AuditLog, PendingTransferRequest, PendingTransferBatchGuard,
    TransferPositionReconciliation, TransferPalletCustody, ShippingContainer,
    PhysicalTransferEvent, UserProfile, UserModulePermission, TransferWarehouseRule)
from api.services.physical_transfer_service import company_scope


class Stage5Fixture:
    batch = '112000027-39'
    load_url = '/api/transfer/physical/load/'

    def setup_loading(self):
        self.actor = User.objects.create_user('stage5-loader', password='test')
        UserProfile.objects.filter(user=self.actor).update(role='transfer', module_permissions_initialized=True)
        UserModulePermission.objects.create(user=self.actor, module=UserModulePermission.MODULE_TRANSFER, level='USER')
        for warehouse in ('20201', '20202'):
            TransferWarehouseRule.objects.create(user=self.actor, stage='STAGE_5_TO_CONTAINER', direction='FROM', warehouse_code=warehouse)
        self.source = self.posted_move('20201', 'STAGE_2_TO_FRIDGE')
        self.client = APIClient()
        self.client.force_login(self.actor)
        for target in ('requests.sessions.Session.request', 'api.views._user_can_access_transfer_warehouse'):
            guard = patch(target, side_effect=AssertionError(f'Stage 5 must not call {target}'))
            guard.start()
            self.addCleanup(guard.stop)

    def posted_move(self, warehouse, stage='STAGE_4_TO_DESTINATION', **extra):
        return PendingTransferRequest.objects.create(transfer_stage=stage, status='POSTED',
            from_warehouse='PREVIOUS', to_warehouse=warehouse, batch_number=self.batch,
            quantity=100, lines=[{'batch_number': self.batch, 'item_code': 'ITEM', 'quantity': 100}],
            posted_at=extra.pop('posted_at', timezone.now()), sap_doc_entry='123', created_by=self.actor, **extra)

    def check_batch(self):
        return self.client.get(f'/api/transfer/physical/batches/{self.batch}/')

    def confirm(self, warehouse='20201', container='60508', **extra):
        return self.client.post(self.load_url, {'batch_number': self.batch,
            'source_warehouse': warehouse, 'container_number': container, **extra}, format='json')


class Stage5LoadingTests(Stage5Fixture, TestCase):
    def setUp(self):
        self.setup_loading()

    def check_admin_bypass(self, with_rules):
        from api.views import _transfer_access_summary, _transfer_allowed_codes, _filter_transfer_warehouses_for_any_access
        UserProfile.objects.filter(user=self.actor).update(role='admin')
        UserModulePermission.objects.filter(user=self.actor, module='transfer').update(level='ADMIN')
        TransferWarehouseRule.objects.filter(user=self.actor).delete()
        if with_rules:
            TransferWarehouseRule.objects.create(user=self.actor, stage='STAGE_4_TO_DESTINATION',
                direction='FROM', warehouse_code='RESTRICTED')
        self.actor = User.objects.get(pk=self.actor.pk)
        with patch('api.views._active_transfer_rules_for_user', side_effect=AssertionError('Admin must bypass rules')):
            self.assertTrue(_transfer_access_summary(self.actor)['allow_all'])
            self.assertEqual(_transfer_access_summary(self.actor)['rules'], [])
            self.assertIsNone(_transfer_allowed_codes(self.actor, 'FROM', 'STAGE_5_TO_CONTAINER'))
            warehouses=[{'code':'20201'},{'code':'20202'}]
            self.assertEqual(_filter_transfer_warehouses_for_any_access(self.actor, warehouses), warehouses)
        self.assertEqual(self.check_batch().status_code, 200)
        loaded=self.confirm()
        self.assertEqual(loaded.status_code, 200, loaded.content)
        self.assertFalse(loaded.data['sap_posting'])
        self.assertEqual(TransferPalletCustody.objects.get(batch_number=self.batch).state, 'LOADED_TO_CONTAINER')

    def test_admin_without_rules_reads_and_confirms_local_loading(self):
        self.check_admin_bypass(False)

    def test_admin_with_rules_reads_and_confirms_local_loading(self):
        self.check_admin_bypass(True)

    def test_real_endpoints_read_then_load_with_stage5_from_rules_record_every_field(self):
        self.assertFalse(TransferWarehouseRule.objects.filter(user=self.actor, direction='TO').exists())
        read = self.check_batch()
        self.assertEqual(read.status_code, 200, read.content)
        self.assertEqual(read.data['data']['current_location'], '20201')
        self.assertEqual(read.data['data']['current_state'], 'STAGE_2_COMPLETED')
        loaded = self.confirm()
        self.assertEqual(loaded.status_code, 200, loaded.content)
        self.assertFalse(loaded.data['sap_posting'])
        pallet = TransferPalletCustody.objects.get(batch_number=self.batch)
        self.assertEqual(pallet.state, 'LOADED_TO_CONTAINER')
        self.assertEqual(pallet.container.container_number, '60508')
        self.assertEqual(pallet.updated_by, self.actor)
        self.assertIsNotNone(pallet.updated_at)
        event = PhysicalTransferEvent.objects.get(pallet=pallet, stage=5)
        self.assertEqual(event.source_location, '20201')
        self.assertEqual(event.destination_location, 'CONTAINER:60508')
        self.assertEqual(event.actor, self.actor)
        self.assertIsNotNone(event.created_at)
        audit = AuditLog.objects.get(entity_type='TransferPalletCustody', entity_id=str(pallet.pk))
        self.assertEqual(audit.user, self.actor)
        self.assertEqual(audit.details['source_location'], '20201')
        self.assertEqual(audit.details['container_number'], '60508')
        self.assertFalse(audit.details['sap_posting'])

    def test_screenshot_location_mismatch_is_rejected_without_writes(self):
        result = self.confirm('20202')
        self.assertEqual(result.status_code, 409, result.content)
        self.assertIn('20201', result.data['error'])
        self.assertNotIn('Transfer warehouse access', result.data['error'])
        self.assertFalse(TransferPalletCustody.objects.exists())
        self.assertFalse(ShippingContainer.objects.exists())
        self.assertFalse(PhysicalTransferEvent.objects.exists())

    def test_latest_confirmed_stage4_location_is_used_and_rechecked_on_confirm(self):
        self.assertEqual(self.check_batch().data['data']['current_location'], '20201')
        source = self.posted_move('20202')
        self.assertEqual(self.confirm('20201').status_code, 409)
        read = self.check_batch().data['data']
        self.assertEqual(read['current_location'], '20202')
        self.assertEqual(read['current_state'], 'STAGE_4_COMPLETED')
        self.assertEqual(self.confirm('20202').status_code, 200)
        self.assertEqual(TransferPalletCustody.objects.get().source_transfer_id, source.pk)
        self.assertEqual(PhysicalTransferEvent.objects.get().source_location, '20202')

    def test_old_null_timestamp_and_unposted_moves_cannot_override_confirmed_location(self):
        self.posted_move('UNVERIFIED', posted_at=None)
        PendingTransferRequest.objects.create(status='PENDING', transfer_stage='STAGE_4_TO_DESTINATION',
            batch_number=self.batch, from_warehouse='20201', to_warehouse='20202', created_by=self.actor)
        self.assertEqual(self.check_batch().data['data']['current_location'], '20201')
        self.assertEqual(self.confirm('20202').status_code, 409)

    def test_newer_confirmed_move_supersedes_stale_hall_custody(self):
        pallet = TransferPalletCustody.objects.create(company_scope=company_scope(), batch_number=self.batch,
            state='IN_SHIPPING_HALL', physical_location='SHIPPING_HALL', source_transfer=self.source, updated_by=self.actor)
        source = self.posted_move('20202', posted_at=pallet.updated_at + timedelta(seconds=1))
        self.assertEqual(self.check_batch().data['data']['current_location'], '20202')
        self.assertEqual(self.confirm('20202').status_code, 200)
        pallet.refresh_from_db()
        self.assertEqual(pallet.source_transfer_id, source.pk)
        self.assertEqual(pallet.state, 'LOADED_TO_CONTAINER')

    def test_duplicate_loading_cannot_create_another_container_or_event(self):
        self.assertEqual(self.confirm().status_code, 200)
        for container in ('60508', 'ANOTHER'):
            self.assertEqual(self.confirm(container=container).status_code, 409)
        self.assertEqual(PhysicalTransferEvent.objects.count(), 1)
        self.assertEqual(ShippingContainer.objects.count(), 1)
        self.assertEqual(self.check_batch().data['data']['current_state'], 'LOADED_TO_CONTAINER')

    def test_active_operation_and_unreconciled_state_block_loading(self):
        guard = PendingTransferBatchGuard.objects.create(transfer=self.source, normalized_batch_number=self.batch,
            normalized_from_warehouse='20201', transfer_stage='STAGE_4_TO_DESTINATION')
        self.assertEqual(self.confirm().status_code, 409)
        guard.delete()
        TransferPositionReconciliation.objects.create(transfer=self.source, status='PENDING')
        self.assertEqual(self.confirm().status_code, 409)
        self.assertFalse(ShippingContainer.objects.exists())

    def test_invalid_batch_container_and_missing_source_rejected(self):
        for container in ('', None, 'BAD\nCONTAINER', 'x' * 101):
            self.assertEqual(self.confirm(container=container).status_code, 400)
        self.assertEqual(self.confirm(batch_number='UNKNOWN').status_code, 400)
        self.assertEqual(self.confirm(warehouse='').status_code, 400)
        self.assertFalse(TransferPalletCustody.objects.exists())

    def test_audit_failure_rolls_back_all_loading_records(self):
        with patch('api.services.physical_transfer_service.log_action', return_value=None):
            result = self.confirm()
        self.assertEqual(result.status_code, 503)
        self.assertFalse(TransferPalletCustody.objects.exists())
        self.assertFalse(PhysicalTransferEvent.objects.exists())
        self.assertFalse(ShippingContainer.objects.exists())

    def test_module_access_is_still_required(self):
        self.client.logout()
        self.assertEqual(self.check_batch().status_code, 401)
        self.assertEqual(self.confirm().status_code, 401)
        outsider = User.objects.create_user('not-a-loader')
        self.client.force_login(outsider)
        self.assertEqual(self.check_batch().status_code, 403)
        self.assertEqual(self.confirm().status_code, 403)

    def test_unauthorized_inactive_and_other_stage_source_rules_are_rejected(self):
        TransferWarehouseRule.objects.filter(user=self.actor).delete()
        self.assertEqual(self.check_batch().status_code,403)
        self.assertEqual(self.confirm().status_code, 403)
        rule = TransferWarehouseRule.objects.create(user=self.actor, stage='STAGE_4_TO_DESTINATION', direction='FROM', warehouse_code='20201')
        self.assertEqual(self.confirm().status_code, 403)
        rule.stage='STAGE_5_TO_CONTAINER';rule.is_active=False;rule.save()
        self.assertEqual(self.confirm().status_code, 403)
        rule.is_active=True;rule.save()
        self.assertEqual(self.confirm().status_code, 200)

    def test_admin_saves_multiple_stage5_from_rules_without_destination_and_reload(self):
        TransferWarehouseRule.objects.filter(user=self.actor).delete()
        admin=User.objects.create_superuser('stage5-rule-admin', 'stage5@example.test', 'test')
        self.client.force_login(admin)
        for warehouse in ('20201','20202'):
            result=self.client.post('/api/transfer/rules/warehouse-access/', {'user_id':self.actor.pk,
                'stage':'STAGE_5_TO_CONTAINER','direction':'FROM','warehouse_code':warehouse},format='json')
            self.assertEqual(result.status_code,201,result.content)
        rows=self.client.get('/api/transfer/rules/warehouse-access/').data['data']['rules']
        saved=[row for row in rows if row['user_id']==self.actor.pk and row['stage']=='STAGE_5_TO_CONTAINER']
        self.assertEqual({row['warehouse_code'] for row in saved},{'20201','20202'})
        self.assertEqual({row['direction'] for row in saved},{'FROM'})
        for direction in ('TO','BOTH'):
            response=self.client.post('/api/transfer/rules/warehouse-access/', {'user_id':self.actor.pk,
                'stage':'STAGE_5_TO_CONTAINER','direction':direction,'warehouse_code':'20203'},format='json')
            self.assertEqual(response.status_code,400)
        response=self.client.patch(f"/api/transfer/rules/warehouse-access/{saved[0]['id']}/",{'direction':'TO'},format='json')
        self.assertEqual(response.status_code,400)


class Stage5LoadingConcurrencyTests(Stage5Fixture, TransactionTestCase):
    def setUp(self):
        if connection.vendor != 'postgresql':
            self.skipTest('Requires PostgreSQL row locks.')
        self.setup_loading()

    def test_two_first_loads_have_one_winner_without_warehouse_permissions(self):
        barrier = Barrier(2)
        def run(container):
            close_old_connections()
            try:
                client = APIClient()
                client.force_login(User.objects.get(pk=self.actor.pk))
                barrier.wait(timeout=10)
                return client.post(self.load_url, {'source_warehouse': '20201',
                    'batch_number': self.batch, 'container_number': container}).status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(run, ['FIRST', 'SECOND'])), [200, 409])
        self.assertEqual(TransferPalletCustody.objects.count(), 1)
        self.assertEqual(PhysicalTransferEvent.objects.count(), 1)
        self.assertEqual(ShippingContainer.objects.count(), 1)
