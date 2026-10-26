from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase
from django.db import connection, close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import PendingReceipt, PendingReceiptBatch, PendingTransferRequest, PendingTransferBatchGuard, PhysicalTransferEvent, UserModulePermission, TransferWarehouseRule
from api.models_shipping import ShippingOperation
from api.models_delivery import DeliveryDraft
from scale.models import ScaleItemElement, ScaleDraft


class ShippingHandoffTests(TestCase):
    def test_production_pallet_type_follows_batch_into_shipping_order(self):
        from api.services.shipping_service import source_details
        from api.shipping_views import manifest_dict
        receipt = PendingReceipt.objects.create(production_order_doc_entry=1,
            production_order_doc_num='1', item_code='ITEM-A', status='POSTED')
        PendingReceiptBatch.objects.create(pending_receipt=receipt, batch_number='PALLET-A',
            raw_batch_json={'palletTypeId': 7, 'palletTypeName': 'Euro', 'palletCapacityKg': '800.000'})
        self.assertEqual(source_details('PALLET-A', self.shipper)['production_pallet_type_name'], 'Euro')
        self.first()
        self.save()
        self.op.refresh_from_db()
        commercial = manifest_dict(self.op, True)
        self.assertEqual(commercial['pallets'][0]['production_pallet_type_name'], 'Euro')
        self.assertEqual(commercial['pallets'][0]['production_pallet_capacity_kg'], '800.000')

    def setUp(self):
        self.admin = User.objects.create_user('shipping-admin', is_superuser=True)
        self.scale = User.objects.create_user('scale-only')
        self.shipper = User.objects.create_user('shipping-only')
        self.delivery = User.objects.create_user('delivery-only')
        for actor, module in [(self.scale, 'scale'), (self.shipper, 'transfer'), (self.delivery, 'delivery')]:
            UserModulePermission.objects.create(user=actor, module=module, level='USER')
        TransferWarehouseRule.objects.create(user=self.shipper, stage='STAGE_5_TO_CONTAINER',
            direction='FROM', warehouse_code='20204', is_active=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.pallet = ScaleItemElement.objects.create(item_code='PACK-PALLET', name='Wood pallet', weight=25)
        self.box = ScaleItemElement.objects.create(item_code='PACK-BOX', name='Carton', weight=Decimal('0.5'))
        for batch, item, qty in [('PALLET-A', 'ITEM-A', 1000), ('PALLET-B', 'ITEM-B', 500)]:
            PendingTransferRequest.objects.create(transfer_stage='STAGE_4_TO_DESTINATION', status='POSTED',
                from_warehouse='90214', to_warehouse='20204', batch_number=batch, item_code=item,
                quantity=qty, lines=[{'item_code': item, 'batch_number': batch, 'quantity': qty}],
                sap_doc_entry='123', sap_doc_num='456', posted_at=timezone.now(), created_by=self.admin)
        self.order = {'DocEntry': 123, 'DocNum': 456, 'CardCode': 'SECRET-CUSTOMER',
            'CardName': 'Secret customer name', 'DocumentStatus': 'bost_Open',
            'DocumentLines': [{'LineNum': i, 'ItemCode': item, 'ItemDescription': item, 'UoMCode': 'KG',
                               'Quantity': 2000, 'RemainingOpenQuantity': 2000, 'WarehouseCode': '20204'}
                              for i, item in enumerate(['ITEM-A', 'ITEM-B'])]}
        mocked_order = patch('api.services.sap_service.SAPServiceLayer.get_sales_order', return_value=self.order)
        mocked_order.start(); self.addCleanup(mocked_order.stop)
        forbidden = patch('requests.sessions.Session.request', side_effect=AssertionError('Unexpected live SAP call'))
        forbidden.start(); self.addCleanup(forbidden.stop)

    def first(self):
        self.client.force_authenticate(self.scale)
        response = self.client.post('/api/scale/drafts/first-weight/', {
            'start_type': 'empty', 'weight': 10000, 'is_direct_entry': True,
            'direct_vehicle_number': 'TRUCK-A', 'direct_driver_name': 'Driver', 'truck_type': 'container',
            'containers': [{'container_number': 'CONTAINER-A'}]}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.draft_id = response.json()['data']['id']
        self.op = ShippingOperation.objects.get(scale_draft_id=self.draft_id)
        self.client.force_authenticate(self.shipper)

    def manifest(self):
        return {'revision': self.op.revision, 'sales_order_doc_entry': 123, 'container_number': 'CONTAINER-A',
                'pallets': [{'batch_number': batch, 'order_line_number': i, 'quantity': qty,
                            'pallet_element_id': self.pallet.pk, 'box_element_id': self.box.pk, 'box_count': boxes}
                           for i, (batch, qty, boxes) in enumerate([('PALLET-A', 1000, 80), ('PALLET-B', 500, 40)])]}

    def save(self, payload=None):
        response = self.client.put(f'/api/shipping/operations/{self.op.pk}/', payload or self.manifest(), format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.op.refresh_from_db()
        return response

    def ready(self):
        self.first(); self.save()
        response = self.client.post(f'/api/shipping/operations/{self.op.pk}/submit/', {'revision': self.op.revision}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.op.refresh_from_db()

    def weigh(self):
        self.client.force_authenticate(self.scale)
        response = self.client.post(f'/api/scale/drafts/{self.draft_id}/second-weight/', {'weight': 25000}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.op.refresh_from_db()
        return response

    def test_pending_transfer_is_reported_at_scan_and_submission_without_loading(self):
        self.first()
        self.save()
        pending = PendingTransferRequest.objects.create(transfer_stage='STAGE_3_FROM_FRIDGE',
            status='PENDING', from_warehouse='90214', to_warehouse='20204', batch_number='PALLET-A')
        guard = PendingTransferBatchGuard.objects.create(transfer=pending, normalized_batch_number='PALLET-A',
            normalized_from_warehouse='90214', transfer_stage=pending.transfer_stage)
        response = self.client.get('/api/shipping/sources/PALLET-A/')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'PENDING_SAP_TRANSFER')
        self.assertEqual(response.data['batch_number'], 'PALLET-A')
        self.assertEqual(response.data['pending_transfers'][0]['transfer_id'], pending.pk)
        response = self.client.post(f'/api/shipping/operations/{self.op.pk}/submit/', {'revision': self.op.revision}, format='json')
        self.assertEqual(response.status_code, 409)
        self.op.refresh_from_db()
        self.assertEqual(self.op.status, 'LOADING')
        self.assertFalse(PhysicalTransferEvent.objects.filter(stage=5).exists())
        self.assertTrue(PendingTransferBatchGuard.objects.filter(pk=guard.pk).exists())

    def test_complete_multi_item_handoff_and_idempotent_delivery(self):
        receipt = PendingReceipt.objects.create(production_order_doc_entry=1, production_order_doc_num='1', item_code='ITEM-A', status='POSTED')
        PendingReceiptBatch.objects.create(pending_receipt=receipt, batch_number='PALLET-A', brand='TEST-BRAND', size='72', packing='CARTON', season='2026')
        self.ready()
        self.assertEqual(PhysicalTransferEvent.objects.filter(stage=5).count(), 2)
        self.assertEqual(self.op.scale_draft.draft_elements.count(), 4)
        self.box.weight = 9; self.box.save()
        response = self.weigh()
        self.assertEqual(Decimal(response.json()['data']['product_weight']), Decimal('14890'))
        self.assertEqual(self.op.status, 'WEIGHED')
        printed_batch = response.json()['data']['shipping_manifest']['pallets'][0]
        self.assertEqual(response.json()['data']['shipping_manifest']['sales_order_number'], '456')
        self.assertEqual(printed_batch['batch_number'], 'PALLET-A')
        self.assertEqual(printed_batch['attributes']['brand'], 'TEST-BRAND')
        self.assertEqual(printed_batch['attributes']['size'], '72')
        self.assertNotIn('vendor', printed_batch['attributes'])
        self.assertNotIn('Secret customer', response.content.decode())
        self.assertNotIn('SECRET-CUSTOMER', response.content.decode())
        self.assertNotIn('sales_order_doc_entry', response.content.decode())
        self.client.force_authenticate(self.delivery)
        board = self.client.get('/api/shipping/deliveries/').data['operations'][0]
        self.assertEqual(board['order']['customer_code'], 'SECRET-CUSTOMER')
        self.assertEqual(board['box_count'], 120)
        self.assertEqual(board['net_weight'], '14890.00')
        result = self.client.post(f'/api/shipping/operations/{self.op.pk}/delivery/', {}, format='json')
        self.assertEqual(result.status_code, 200, result.content)
        repeated = self.client.post(f'/api/shipping/operations/{self.op.pk}/delivery/', {}, format='json')
        self.assertEqual(repeated.data, result.data)
        self.assertEqual(DeliveryDraft.objects.count(), 1)
        draft = DeliveryDraft.objects.get()
        self.assertEqual([line.delivery_quantity for line in draft.lines.order_by('line_number')], [1000, 500])
        self.assertEqual(draft.status, 'DRAFT')
        self.assertEqual(sum(line.batches.count() for line in draft.lines.all()), 2)

    def test_second_weight_blocked_before_manifest_and_after_reopen(self):
        self.first()
        self.client.force_authenticate(self.scale)
        response = self.client.post(f'/api/scale/drafts/{self.draft_id}/second-weight/', {'weight': 25000}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertIsNone(ScaleDraft.objects.get(pk=self.draft_id).weight_loaded)
        self.client.force_authenticate(self.shipper); self.save()
        sent = self.client.post(f'/api/shipping/operations/{self.op.pk}/submit/', {'revision': self.op.revision}, format='json')
        self.assertEqual(sent.status_code, 200, sent.content)
        self.op.refresh_from_db()
        self.client.force_authenticate(self.admin)
        reopened = self.client.post(f'/api/shipping/operations/{self.op.pk}/reopen/', {'revision': self.op.revision}, format='json')
        self.assertEqual(reopened.status_code, 200, reopened.content)
        self.op.refresh_from_db()
        self.client.force_authenticate(self.scale)
        self.assertEqual(self.client.post(f'/api/scale/drafts/{self.draft_id}/second-weight/', {'weight': 25000}, format='json').status_code, 409)
        self.client.force_authenticate(self.shipper)
        self.save()
        resent = self.client.post(f'/api/shipping/operations/{self.op.pk}/submit/', {'revision': self.op.revision}, format='json')
        self.assertEqual(resent.status_code, 200, resent.content)
        self.assertEqual(PhysicalTransferEvent.objects.count(), 2)
        self.assertEqual(self.op.scale_draft.draft_elements.count(), 4)

    def test_manifest_validation_and_revision_conflict(self):
        self.first()
        cases = []
        payload = self.manifest(); payload['pallets'].append(payload['pallets'][0].copy()); cases.append(payload)
        payload = self.manifest(); payload['pallets'][0]['order_line_number'] = 1; cases.append(payload)
        payload = self.manifest(); payload['pallets'][0]['box_count'] = 0; cases.append(payload)
        payload = self.manifest(); payload['container_number'] = 'OTHER'; cases.append(payload)
        payload = self.manifest(); payload['pallets'][0]['quantity'] = 'NaN'; cases.append(payload)
        for payload in cases:
            result = self.client.put(f'/api/shipping/operations/{self.op.pk}/', payload, format='json')
            self.assertEqual(result.status_code, 400, result.content)
            self.assertEqual(self.op.pallets.count(), 0)
        original = self.manifest(); self.save()
        conflict = self.client.put(f'/api/shipping/operations/{self.op.pk}/', original, format='json')
        self.assertEqual(conflict.status_code, 400)

    def test_scale_cannot_access_commercial_routes_or_change_packaging(self):
        self.ready(); self.client.force_authenticate(self.scale)
        for route in ['operations/', f'operations/{self.op.pk}/', 'orders/123/', 'deliveries/']:
            self.assertEqual(self.client.get('/api/shipping/' + route).status_code, 403)
        response = self.client.get(f'/api/scale/drafts/{self.draft_id}/')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('SECRET-CUSTOMER', response.content.decode())
        changed = self.client.post(f'/api/scale/drafts/{self.draft_id}/second-weight/', {
            'weight': 25000, 'elements': [{'item_element_id': self.box.pk, 'count': 1}]}, format='json')
        self.assertEqual(changed.status_code, 400)
        changed = self.client.post(f'/api/scale/drafts/{self.draft_id}/elements/', {
            'item_element_id': self.box.pk, 'count': 1}, format='json')
        self.assertEqual(changed.status_code, 403)
        self.client.force_authenticate(self.shipper)
        self.assertEqual(self.client.post(f'/api/shipping/operations/{self.op.pk}/delivery/', {}, format='json').status_code, 403)

    def test_invalid_net_does_not_certify_or_create_delivery(self):
        self.ready(); self.client.force_authenticate(self.scale)
        response = self.client.post(f'/api/scale/drafts/{self.draft_id}/second-weight/', {'weight': 10050}, format='json')
        self.assertEqual(response.status_code, 400)
        self.op.refresh_from_db()
        self.assertEqual(self.op.status, 'READY')
        self.assertIsNone(ScaleDraft.objects.get(pk=self.draft_id).product_weight)
        self.client.force_authenticate(self.delivery)
        self.assertEqual(self.client.post(f'/api/shipping/operations/{self.op.pk}/delivery/', {}, format='json').status_code, 400)
        self.assertEqual(DeliveryDraft.objects.count(), 0)

    def test_certified_delivery_cargo_cannot_be_changed(self):
        from api.services.delivery_posting_service import DeliveryPostingService, DeliveryStateError
        self.ready(); self.weigh()
        self.client.force_authenticate(self.delivery)
        result = self.client.post(f'/api/shipping/operations/{self.op.pk}/delivery/', {}, format='json')
        self.assertEqual(result.status_code, 200, result.content)
        draft = DeliveryDraft.objects.get()
        service = DeliveryPostingService()
        with self.assertRaises(DeliveryStateError):
            service.update_draft(draft, [{'line_number': 0, 'delivery_quantity': 999}], self.delivery)
        with self.assertRaises(DeliveryStateError):
            service.update_draft(draft, [{'line_number': 0, 'batches': []}], self.delivery)
        service.update_draft(draft, [{'line_number': 0, 'cost_center_code': 'COST'}], self.delivery)
        self.assertEqual(draft.lines.get(line_number=0).delivery_quantity, 1000)
        details = self.client.get(f'/api/customization-delivery/delivery/drafts/{draft.pk}/')
        self.assertEqual(details.status_code, 200, details.content)
        self.assertIn('shipping_manifest', str(details.data))

    def test_submission_rollback_preserves_manifest_and_custody(self):
        self.first(); self.save()
        from api.services.physical_transfer_service import load
        calls = []
        def fail_second(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise ValueError('Second pallet cannot be loaded')
            return load(*args, **kwargs)
        with patch('api.services.shipping_service.load', side_effect=fail_second):
            response = self.client.post(f'/api/shipping/operations/{self.op.pk}/submit/', {'revision': self.op.revision}, format='json')
        self.assertEqual(response.status_code, 400)
        self.op.refresh_from_db()
        self.assertEqual(self.op.status, 'LOADING')
        self.assertEqual(PhysicalTransferEvent.objects.count(), 0)
        self.assertEqual(self.op.scale_draft.draft_elements.count(), 0)

    def test_loading_rules_and_locked_manifest(self):
        self.first()
        TransferWarehouseRule.objects.filter(user=self.shipper).delete()
        response = self.client.put(f'/api/shipping/operations/{self.op.pk}/', self.manifest(), format='json')
        self.assertEqual(response.status_code, 403)
        self.client.force_authenticate(self.admin); self.save()
        sent = self.client.post(f'/api/shipping/operations/{self.op.pk}/submit/', {'revision': self.op.revision}, format='json')
        self.assertEqual(sent.status_code, 200, sent.content)
        self.op.refresh_from_db()
        self.assertEqual(self.client.put(f'/api/shipping/operations/{self.op.pk}/', self.manifest(), format='json').status_code, 400)
        self.client.force_authenticate(self.scale)
        self.assertEqual(self.client.post(f'/api/scale/drafts/{self.draft_id}/cancel/', {}, format='json').status_code, 409)

    def test_outbound_shipments_are_excluded_from_quality_queue(self):
        self.ready(); self.weigh()
        response = self.client.get('/api/scale/quality/pending-drafts/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn(self.op.scale_draft.draft_number, response.content.decode())


@skipUnless(connection.vendor == 'postgresql', 'PostgreSQL row locking required')
class ShippingConcurrencyTests(TransactionTestCase):
    setUp = ShippingHandoffTests.setUp
    first = ShippingHandoffTests.first
    manifest = ShippingHandoffTests.manifest
    save = ShippingHandoffTests.save
    ready = ShippingHandoffTests.ready
    weigh = ShippingHandoffTests.weigh

    def test_concurrent_submission_records_each_pallet_once(self):
        from api.services.shipping_service import submit_manifest
        self.first(); self.save()
        barrier = Barrier(2)
        def submit():
            close_old_connections()
            try:
                actor = User.objects.get(pk=self.shipper.pk)
                barrier.wait(timeout=10)
                try:
                    submit_manifest(self.op.pk, self.op.revision, actor)
                    return 'submitted'
                except ValueError:
                    return 'conflict'
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: submit(), range(2)))
        self.assertCountEqual(results, ['submitted', 'conflict'])
        self.assertEqual(PhysicalTransferEvent.objects.count(), 2)
        self.assertEqual(self.op.scale_draft.draft_elements.count(), 4)

    def test_concurrent_delivery_creation_returns_one_draft(self):
        from api.services.shipping_service import create_delivery
        self.ready(); self.weigh()
        barrier = Barrier(2)
        def create():
            close_old_connections()
            try:
                actor = User.objects.get(pk=self.delivery.pk)
                barrier.wait(timeout=10)
                return create_delivery(self.op.pk, actor).pk
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(DeliveryDraft.objects.count(), 1)
