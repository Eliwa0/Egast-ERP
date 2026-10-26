from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase
from django.urls import Resolver404, resolve

from api.services.transfer_service import TransferInventoryService, TransferValidationError


class TransferConfigurationCleanupTests(SimpleTestCase):
    def test_configuration_endpoints_removed(self):
        for path in ('/api/transfer/config/', '/api/transfer/policies/',
                     '/api/transfer/policies/effective/', '/api/transfer/policies/1/',
                     '/api/transfer/policies/1/activate/', '/api/transfer/policies/1/disable/'):
            with self.subTest(path=path), self.assertRaises(Resolver404):
                resolve(path)

    def test_stage4_ignores_revision_and_stored_contract_and_posts_user_destination(self):
        sap = Mock()
        sap.create_stock_transfer.return_value = {'DocEntry': 1, 'DocNum': 2}
        service = TransferInventoryService(use_mock=False, sap_client=sap)
        payload = {'transfer_stage': 'STAGE_4_TO_DESTINATION', 'from_warehouse': '90214',
                   'to_warehouse': 'USER-DESTINATION', 'lines': [
                       {'item_code': 'ITEM', 'batch_number': 'PALLET', 'quantity': 100}],
                   '_transfer_policy': {'company_scope': 'obsolete', 'enabled': False}}
        with patch.object(service, 'resolve_transfer_policy', side_effect=AssertionError('Stage 4 resolved policy/routes')), \
             patch('api.models_transfer_policy.TransferPolicyRevision.objects.filter',
                   side_effect=AssertionError('Runtime queried policy revisions')):
            for source in ('90214', '90111'):
                validated = service._validate_move_payload({**payload, 'from_warehouse': source}, stored_contract=True)
                self.assertNotIn('_transfer_policy', validated)
                service._sap_move_inventory(validated)
                posted = sap.create_stock_transfer.call_args.args[0]
                self.assertEqual(posted['FromWarehouse'], source)
                self.assertEqual(posted['ToWarehouse'], 'USER-DESTINATION')
                line = posted['StockTransferLines'][0]
                self.assertEqual(line['FromWarehouseCode'], source)
                self.assertEqual(line['WarehouseCode'], 'USER-DESTINATION')
            for source, destination in [('90111', '90111'), ('90214', '90214'), ('', 'USER-DESTINATION')]:
                with self.subTest(source=source), self.assertRaises(TransferValidationError):
                    service._validate_move_payload({**payload, 'from_warehouse': source,
                                                    'to_warehouse': destination})


class Stage5WithoutConfigurationTests(TestCase):
    def test_direct_load_has_no_policy_lookup_or_sap_post(self):
        from django.contrib.auth.models import User
        from rest_framework.test import APIClient
        from api.models import PendingTransferRequest, TransferPalletCustody
        actor = User.objects.create_superuser('cleanup-admin', 'cleanup@example.test', 'test')
        PendingTransferRequest.objects.create(transfer_stage='STAGE_4_TO_DESTINATION',
            status='POSTED', from_warehouse='90214', to_warehouse='USER-DESTINATION',
            batch_number='PALLET', quantity=100, sap_doc_entry='123', created_by=actor,
            lines=[{'item_code': 'ITEM', 'batch_number': 'PALLET', 'quantity': 100}])
        client = APIClient()
        client.force_login(actor)
        with patch('api.models_transfer_policy.TransferPolicyRevision.objects.filter',
                   side_effect=AssertionError('Stage 5 queried policy revisions')), \
             patch('requests.sessions.Session.request', side_effect=AssertionError('SAP call forbidden')):
            response = client.post('/api/transfer/physical/load/', {
                'source_warehouse': 'USER-DESTINATION', 'batch_number': 'PALLET',
                'container_number': 'CONT-CLEANUP'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['sap_posting'])
        self.assertEqual(TransferPalletCustody.objects.get(batch_number='PALLET').state,
                         'LOADED_TO_CONTAINER')
