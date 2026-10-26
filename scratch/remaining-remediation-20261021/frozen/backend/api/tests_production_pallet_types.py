from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.models import ProductionPalletType, UserModulePermission, PendingReceipt, PendingReceiptBatch
from api.production_pallet_views import validate_receipt_pallets


class ProductionPalletTests(TestCase):
    def test_batch_pallet_snapshot_survives_catalogue_change_and_is_exposed(self):
        from api.views import _pending_receipt_to_dict, _local_receipt_batch_to_transfer_batch, _decorate_sap_transfer_batch
        rows = [{'palletTypeId': self.pallet.pk, 'quantity': 700}]
        validate_receipt_pallets(rows)
        receipt = PendingReceipt.objects.create(production_order_doc_entry=1,
            production_order_doc_num='1', item_code='ITEM', status='POSTED')
        batch = PendingReceiptBatch.objects.create(pending_receipt=receipt,
            batch_number='PALLET-SNAPSHOT', quantity=700, raw_batch_json=rows[0])
        self.pallet.name = 'Renamed'; self.pallet.capacity_kg = 800; self.pallet.save()
        batch.refresh_from_db()
        expected = batch.production_pallet
        self.assertEqual(expected['production_pallet_type_name'], 'Standard')
        self.assertEqual(expected['production_pallet_capacity_kg'], '1200.000')
        review = _pending_receipt_to_dict(receipt, include_batches=True)['batches'][0]
        local = _local_receipt_batch_to_transfer_batch(batch)
        sap = _decorate_sap_transfer_batch({'batch_number': batch.batch_number, 'item_code': 'ITEM'})
        for payload in (review, local, sap):
            for key, value in expected.items():
                self.assertEqual(payload[key], value)

    def setUp(self):
        self.admin = User.objects.create_user('pallet-admin', is_superuser=True)
        self.user = User.objects.create_user('pallet-user')
        UserModulePermission.objects.create(user=self.user, module='production', level='USER')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.pallet = ProductionPalletType.objects.create(name='Standard', capacity_kg=1200)

    def test_admin_can_define_type_user_can_only_read(self):
        response = self.client.post('/api/production/pallet-types/', {'name': 'Euro', 'capacity_kg': 800}, format='json')
        self.assertEqual(response.status_code, 201)
        self.client.force_authenticate(self.user)
        self.assertEqual(len(self.client.get('/api/production/pallet-types/').data['types']), 2)
        self.assertEqual(self.client.post('/api/production/pallet-types/', {'name': 'Other', 'capacity_kg': 500}, format='json').status_code, 403)

    def test_full_and_partial_pallets_accepted_with_server_snapshot(self):
        for quantity in (1200, 900, 0.5):
            batches = [{'palletTypeId': self.pallet.pk, 'quantity': quantity, 'palletCapacityKg': '99999'}]
            validate_receipt_pallets(batches)
            self.assertEqual(batches[0]['palletCapacityKg'], '1200.000')
            self.assertEqual(batches[0]['palletTypeName'], 'Standard')

    def test_limits_apply_per_pallet_not_combined_receipt_total(self):
        validate_receipt_pallets([{'palletTypeId': self.pallet.pk, 'quantity': 1000}, {'palletTypeId': self.pallet.pk, 'quantity': 1200}])
        euro = ProductionPalletType.objects.create(name='Euro', capacity_kg=800)
        for type_id, quantity in [(self.pallet.pk, 1200.001), (euro.pk, 801), (self.pallet.pk, 'NaN')]:
            with self.assertRaises(ValueError): validate_receipt_pallets([{'palletTypeId': type_id, 'quantity': quantity}])

    def test_missing_or_disabled_type_rejected(self):
        with self.assertRaises(ValueError): validate_receipt_pallets([{'quantity': 500}])
        self.pallet.is_active = False; self.pallet.save()
        with self.assertRaises(ValueError): validate_receipt_pallets([{'palletTypeId': self.pallet.pk, 'quantity': 500}])

    def test_invalid_capacity_rejected(self):
        for value in (0, -1, 'NaN', 'Infinity', '800.0001'):
            response = self.client.post('/api/production/pallet-types/', {'name': 'Invalid', 'capacity_kg': value}, format='json')
            self.assertEqual(response.status_code, 400)

    def test_explicit_no_pallets_is_allowed_but_conflicting_choice_is_rejected(self):
        batches = [{'withoutPallet': True, 'quantity': 2000, 'palletTypeId': None}]
        validate_receipt_pallets(batches)
        self.assertIsNone(batches[0]['palletCapacityKg'])
        with self.assertRaises(ValueError):
            validate_receipt_pallets([{'withoutPallet': True, 'quantity': 2000, 'palletTypeId': self.pallet.pk}])
        with self.assertRaises(ValueError):
            validate_receipt_pallets([{'withoutPallet': 'true', 'quantity': 2000}])

    def test_receipt_endpoint_rejects_capacity_override_before_sap_calls(self):
        from unittest.mock import patch
        self.client.force_authenticate(self.user)
        self.client.force_login(self.user)
        with patch('requests.sessions.Session.request', side_effect=AssertionError('No SAP request expected')):
            response = self.client.post('/api/pending-receipts/', {
                'ProductionOrderEntry': 1, 'Quantity': 1201, 'UnitCount': 1,
                'Batches': [{'quantity': 1201, 'unitCount': 1, 'palletTypeId': self.pallet.pk, 'palletCapacityKg': '99999'}],
            }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('1200', str(response.data))
