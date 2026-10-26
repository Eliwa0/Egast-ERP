from copy import deepcopy
from unittest.mock import Mock, patch
from django.test import SimpleTestCase, TestCase
from api.services.transfer_destination_bins import destination_bin_options, validate_destination_bin, validate_destination_allocations
from api.services.transfer_service import TransferInventoryService


class DestinationSapBinTests(SimpleTestCase):
    def setUp(self):
        self.sap = Mock()
        self.sap.get_warehouse_details.return_value = {'WarehouseCode': 'DEST', 'EnableBinLocations': 'tYES'}
        self.bin = {'Warehouse': 'DEST', 'BinCode': 'DEST-VALID', 'AbsEntry': 42, 'Inactive': 'tNO', 'IsSystemBin': 'tNO'}
        self.sap.get_bin_locations_by_warehouse.return_value = {'value': [self.bin]}
        self.payload = {'transfer_stage': 'STAGE_3_FROM_FRIDGE', 'from_warehouse': 'COLD', 'from_bin': 'SOURCE',
                        'to_warehouse': 'DEST', 'to_bin': 'DEST-VALID',
                        'lines': [{'item_code': 'ITEM', 'batch_number': 'PALLET', 'quantity': 100}]}

    def test_no_bins_requires_no_selection(self):
        self.sap.get_warehouse_details.return_value['EnableBinLocations'] = 'tNO'
        self.payload['to_bin'] = ''
        self.assertIsNone(validate_destination_bin(self.sap, self.payload))
        self.sap.get_bin_locations_by_warehouse.assert_not_called()

    def test_bin_is_required_without_default(self):
        options = destination_bin_options(self.sap, 'DEST')
        self.assertTrue(options['requires_bin'])
        self.assertNotIn('selected_bin', options)
        self.payload['to_bin'] = ''
        with self.assertRaisesRegex(ValueError, 'required'):
            validate_destination_bin(self.sap, self.payload)

    def test_invalid_bin_rejected(self):
        self.payload['to_bin'] = 'OTHER'
        with self.assertRaises(ValueError): validate_destination_bin(self.sap, self.payload)

    def test_inactive_system_foreign_and_invalid_abs_entry_excluded(self):
        for changes in [{'Inactive': 'tYES'}, {'IsSystemBin': 'tYES'}, {'Warehouse': 'OTHER'}, {'AbsEntry': 0}]:
            with self.subTest(changes=changes):
                self.sap.get_bin_locations_by_warehouse.return_value = {'value': [{**self.bin, **changes}]}
                with self.assertRaisesRegex(ValueError, 'no valid bins'): validate_destination_bin(self.sap, self.payload)

    def test_unknown_metadata_blocks(self):
        self.sap.get_warehouse_details.return_value = {'WarehouseCode': 'DEST'}
        with self.assertRaises(ValueError): validate_destination_bin(self.sap, self.payload)

    def test_sap_payload_full_allocation(self):
        self.sap.get_bin_locations_by_warehouse.side_effect = lambda warehouse: {'value': [self.bin if warehouse == 'DEST' else {**self.bin, 'Warehouse': 'COLD', 'BinCode': 'SOURCE', 'AbsEntry': 7}]}
        self.sap.create_stock_transfer.return_value = {'DocEntry': 1, 'DocNum': 2}
        TransferInventoryService(use_mock=False, sap_client=self.sap)._sap_move_inventory(self.payload)
        line = self.sap.create_stock_transfer.call_args.args[0]['StockTransferLines'][0]
        validate_destination_allocations([line], 42)
        self.assertEqual(line['StockTransferLinesBinAllocations'][1]['Quantity'], 100)
        for quantity in [99, 0]:
            broken = deepcopy(line)
            broken['StockTransferLinesBinAllocations'][1]['Quantity'] = quantity
            with self.assertRaises(ValueError): validate_destination_allocations([broken], 42)

    def test_missing_bin_never_posts(self):
        self.payload['to_bin'] = ''
        with self.assertRaises(ValueError): TransferInventoryService(use_mock=False, sap_client=self.sap)._sap_move_inventory(self.payload)
        self.sap.create_stock_transfer.assert_not_called()

    def test_stage3_policy_does_not_pin_runtime_destination_bin(self):
        from api.services.transfer_policy_service import TransferPolicyResolver
        policy = TransferPolicyResolver(use_mock=True).resolve(intermediate=['INT'], fridge=['COLD'], include_persisted=False)
        stage = policy.config['stages']['STAGE_3_FROM_FRIDGE']
        stage.update(policy_source='persisted_policy', route_pairs=[{'from_warehouse':'COLD','to_warehouse':'DEST'}],
                     source_bin_policy='required', destination_bin_policy='required',
                     allowed_source_bins={'COLD':[{'bin_code':'SOURCE'}]}, allowed_destination_bins={})
        before = deepcopy(stage)
        policy.validate_route(self.payload)
        self.assertEqual(stage, before)


class FailedTransferBinPreflightTests(TestCase):
    def test_missing_bin_preserves_failed_historical_record(self):
        from api.models import PendingTransferRequest
        from api.views import post_pending_transfer
        from rest_framework.test import APIRequestFactory, force_authenticate
        from django.contrib.auth.models import User
        actor = User.objects.create_user(username='bin-admin', is_superuser=True)
        payload = {'transfer_stage': 'STAGE_3_FROM_FRIDGE', 'to_warehouse': 'DEST', 'lines': []}
        pending = PendingTransferRequest.objects.create(transfer_stage='STAGE_3_FROM_FRIDGE',
            from_warehouse='COLD', to_warehouse='DEST', status='FAILED', raw_payload_json=payload,
            error_message='1470000341 original SAP rejection', created_by=actor)
        before = PendingTransferRequest.objects.values().get(pk=pending.pk)
        sap = Mock()
        sap.get_warehouse_details.return_value = {'WarehouseCode': 'DEST', 'EnableBinLocations': 'tYES'}
        sap.get_bin_locations_by_warehouse.return_value = {'value': [{'Warehouse': 'DEST', 'BinCode': 'DEST-BIN',
            'AbsEntry': 42, 'Inactive': 'tNO', 'IsSystemBin': 'tNO'}]}
        request = APIRequestFactory().post(f'/api/admin/pending-transfers/{pending.pk}/post/')
        force_authenticate(request, user=actor)
        with patch('api.views.transfer_service', TransferInventoryService(use_mock=False, sap_client=sap)):
            response = post_pending_transfer(request, pending.pk)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(before, PendingTransferRequest.objects.values().get(pk=pending.pk))
        sap.create_stock_transfer.assert_not_called()
