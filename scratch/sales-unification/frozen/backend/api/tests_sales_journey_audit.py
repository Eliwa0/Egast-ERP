"""Regression evidence for the Quotation -> Order -> explicit Delivery audit."""
from copy import deepcopy
from unittest.mock import Mock, patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import UserModulePermission
from api.models_customization import CustomizationDraft
from api.models_delivery import DeliveryDraft
from api.role_permissions import MODULE_CUSTOMIZATION, LEVEL_USER
from api.services.customization_service import CustomizationService, CustomizationStateError


class SalesJourneyAuditTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('journey-admin', password='test')
        self.sap = Mock()
        self.service = CustomizationService(self.sap)
        self.request_lines = [
            {'item_code': 'FRUIT', 'item_description': 'Fruit', 'quantity': 10, 'unit_price': 100,
             'warehouse_code': 'WH', 'uom_entry': 7, 'tax_code': 'T0', 'discount_percent': 10},
            {'item_code': 'FRUIT', 'item_description': 'Fruit', 'quantity': 20, 'unit_price': 250,
             'warehouse_code': 'WH', 'uom_entry': 7, 'tax_code': 'T0', 'discount_percent': 0},
        ]
        self.quotation = {'DocEntry': 1001, 'DocNum': 5001, 'CardCode': 'C001', 'CardName': 'Buyer',
            'DocCurrency': 'USD', 'DocumentStatus': 'bost_Open', 'DocumentLines': [
                {'LineNum': i, 'ItemCode': row['item_code'], 'ItemDescription': 'Fruit',
                 'Quantity': row['quantity'], 'UnitPrice': row['unit_price'], 'WarehouseCode': 'WH',
                 'UoMEntry': 7, 'UoMCode': 'KG', 'VatGroup': 'T0', 'DiscountPercent': row['discount_percent']}
                for i, row in enumerate(self.request_lines)]}
        self.sap.create_sales_quotation.return_value = deepcopy(self.quotation)
        self.sap.get_sales_quotation.return_value = deepcopy(self.quotation)

    def create(self, lines=None):
        return self.service.create_quotation_and_draft(self.user, 'C001', lines_data=lines or self.request_lines)

    def test_duplicate_items_keep_distinct_quantities_prices_and_base_lines(self):
        draft = self.create()
        self.assertEqual([(line.customized_quantity, float(line.customized_unit_price)) for line in draft.lines.all()], [(10, 100), (20, 250)])
        self.sap._request.return_value = {'DocEntry': 2001, 'DocNum': 6001}
        self.service.post_sales_order_to_sap(draft, self.user)
        args = self.sap._request.call_args.args
        self.assertEqual(args[:2], ('POST', 'Orders'))
        self.assertEqual(args[2]['DocCurrency'], 'USD')
        self.assertEqual([(line['BaseType'], line['BaseEntry'], line['BaseLine'], line['Quantity'], line['UnitPrice']) for line in args[2]['DocumentLines']], [(23, 1001, 0, 10, 100), (23, 1001, 1, 20, 250)])
        self.assertFalse(DeliveryDraft.objects.exists())
        self.assertEqual(self.sap._request.call_count, 1)

    def test_zero_quantity_is_rejected_before_any_sap_write(self):
        with self.assertRaises(CustomizationStateError):
            self.create([{**self.request_lines[0], 'quantity': 0}])
        self.sap.create_sales_quotation.assert_not_called()

    def test_missing_quotation_id_is_ambiguous_not_an_internal_error(self):
        from api.services.customization_service import CustomizationPostingError
        self.sap.create_sales_quotation.return_value = {}
        with self.assertRaises(CustomizationPostingError) as error:
            self.create()
        self.assertTrue(error.exception.is_ambiguous)
        self.assertFalse(CustomizationDraft.objects.exists())

    def prepared_delivery(self):
        from api.services.delivery_posting_service import DeliveryPostingService
        self.sap.get_sales_order.return_value = {**deepcopy(self.quotation), 'DocEntry': 2001, 'DocNum': 6001}
        service = DeliveryPostingService(self.sap)
        draft = service.create_draft(self.user, 2001)
        service.submit_for_review(draft, self.user)
        service.approve_review(draft, self.user)
        return service, draft

    def test_definitive_delivery_rejection_is_failed_and_human_readable(self):
        from api.services.delivery_posting_service import DeliveryPostingError
        service, draft = self.prepared_delivery()
        self.sap._request.return_value = {'error': {'code': -10, 'message': {'value': 'Insufficient stock'}}}
        with self.assertRaises(DeliveryPostingError) as error:
            service.post_delivery_to_sap(draft, self.user)
        self.assertFalse(error.exception.is_ambiguous)
        self.assertIn('Insufficient stock', str(error.exception))
        self.assertNotIn("'value'", str(error.exception))
        draft.refresh_from_db()
        self.assertEqual(draft.status, DeliveryDraft.STATUS_FAILED)

    def test_exact_quotation_api_validation_and_ambiguous_response_contract(self):
        client = APIClient()
        client.force_login(self.user)
        client.force_authenticate(self.user)
        endpoint = '/api/customization-delivery/quotations/create/'
        with patch('api.customization_views.CustomizationService', return_value=self.service):
            self.assertEqual(client.post(endpoint, {'lines': self.request_lines}, format='json').status_code, 400)
            self.assertEqual(client.post(endpoint, {'customer_code': 'C001', 'lines': []}, format='json').status_code, 400)
            self.sap.create_sales_quotation.return_value = {}
            response = client.post(endpoint, {'customer_code': 'C001', 'currency': 'USD', 'lines': self.request_lines}, format='json')
            self.assertEqual(response.status_code, 502)
            self.assertTrue(response.data['is_ambiguous'])
            self.assertNotIn('Internal error', response.data['error'])

    def test_invalid_currency_sap_rejection_preserves_message_and_payload(self):
        from api.services.customization_service import CustomizationPostingError
        self.sap.create_sales_quotation.return_value = {'error': {'message': {'value': 'Invalid document currency ZZZ'}}}
        with self.assertRaises(CustomizationPostingError) as error:
            self.service.create_quotation_and_draft(self.user, 'C001', lines_data=self.request_lines, currency='ZZZ')
        self.assertFalse(error.exception.is_ambiguous)
        self.assertIn('Invalid document currency ZZZ', str(error.exception))
        self.assertEqual(self.sap.create_sales_quotation.call_args.args[0]['DocCurrency'], 'ZZZ')

    def test_ambiguous_delivery_blocks_new_draft_and_reconciles_without_posting(self):
        from api.services.delivery_posting_service import DeliveryPostingError, DeliveryStateError
        service, draft = self.prepared_delivery()
        self.sap._request.return_value = {'error': 'Read timed out after SAP may have committed'}
        with self.assertRaises(DeliveryPostingError) as error:
            service.post_delivery_to_sap(draft, self.user)
        self.assertTrue(error.exception.is_ambiguous)
        draft.refresh_from_db()
        self.assertEqual(draft.status, DeliveryDraft.STATUS_POSTING)
        with self.assertRaises(DeliveryStateError):
            service.create_draft(self.user, 2001)
        self.sap._request.reset_mock()
        self.sap._request.side_effect = [
            {'value': [{'DocEntry': 3001, 'DocNum': 7001}]},
            {'Comments': f'Delivery Note (Draft #{draft.id})', 'CardCode': 'C001',
             'DocumentLines': [{'BaseType': 17, 'BaseEntry': 2001, 'BaseLine': i, 'ItemCode': line['ItemCode'], 'WarehouseCode': line['WarehouseCode'], 'Quantity': line['Quantity']} for i, line in enumerate(self.quotation['DocumentLines'])]},
        ]
        result = service.reconcile_delivery(draft)
        self.assertEqual(result.status, DeliveryDraft.STATUS_POSTED)
        self.assertEqual(result.sap_doc_num, '7001')
        self.assertTrue(all(call.args[0] == 'GET' for call in self.sap._request.call_args_list))

    def test_reconciliation_cannot_adopt_another_delivery_of_same_order(self):
        service, draft = self.prepared_delivery()
        draft.status = DeliveryDraft.STATUS_POSTING
        draft.save()
        self.sap._request.side_effect = [
            {'value': [{'DocEntry': 3001, 'DocNum': 7001}]},
            {'Comments': '(Draft #99999)', 'CardCode': 'C001',
             'DocumentLines': [{'BaseType': 17, 'BaseEntry': 2001, 'BaseLine': 0, 'Quantity': 10}]},
        ]
        self.assertEqual(service.reconcile_delivery(draft).status, DeliveryDraft.STATUS_POSTING)

    def test_delivery_sends_verified_order_currency_and_rejects_missing_post_id(self):
        from api.services.delivery_posting_service import DeliveryPostingError
        service, draft = self.prepared_delivery()
        self.sap._request.return_value = {}
        with self.assertRaises(DeliveryPostingError):
            service.post_delivery_to_sap(draft, self.user)
        self.assertEqual(self.sap._request.call_args.args[2]['DocCurrency'], 'USD')
        draft.refresh_from_db()
        self.assertEqual(draft.status, DeliveryDraft.STATUS_POSTING)

    def test_missing_order_post_id_is_not_reported_as_success(self):
        from api.services.customization_service import CustomizationPostingError
        draft = self.create()
        self.sap._request.return_value = {}
        with self.assertRaises(CustomizationPostingError):
            self.service.post_sales_order_to_sap(draft, self.user)
        draft.refresh_from_db()
        self.assertEqual(draft.status, CustomizationDraft.STATUS_ORDER_POSTING)

    def test_posted_quotation_preserves_commercial_fields_and_discounted_total(self):
        draft = self.create()
        line = draft.lines.order_by('line_number').first()
        self.assertEqual(line.uom_entry, 7)
        self.assertEqual(line.tax_code, 'T0')
        self.assertEqual(line.discount_percent, 10)
        from api.customization_views import _serialize_draft
        result = _serialize_draft(draft)
        self.assertEqual(result['total_amount'], 5900)
        self.assertEqual(result['lines'][0]['line_total'], 900)

    def test_customization_only_user_can_open_own_sales_order_read_module(self):
        draft = self.create()
        draft.status = CustomizationDraft.STATUS_ORDER_POSTED
        draft.sap_order_doc_entry, draft.sap_order_doc_num = '2001', '6001'
        draft.save()
        operator = User.objects.create_user('journey-custom-only', password='test')
        operator.userprofile.module_permissions_initialized = True
        operator.userprofile.save(update_fields=['module_permissions_initialized'])
        UserModulePermission.objects.create(user=operator, module=MODULE_CUSTOMIZATION, level=LEVEL_USER)
        client = APIClient()
        client.force_login(operator)
        client.force_authenticate(operator)
        with patch('api.services.sap_service.SAPServiceLayer.get_local_currency', return_value='EGP'), patch('api.services.sap_service.SAPServiceLayer.get_sales_order', return_value={**self.quotation, 'DocEntry': 2001, 'DocNum': 6001}):
            self.assertEqual(client.get('/api/customization-delivery/orders/').status_code, 200)
            self.assertEqual(client.get('/api/customization-delivery/orders/documents/2001/').status_code, 200)
        # The fix cannot grant Delivery creation permissions.
        self.assertEqual(client.post('/api/customization-delivery/delivery/drafts/', {'sales_order_doc_entry': 2001}).status_code, 403)
        self.assertEqual(client.get('/api/customization-delivery/delivery/eligible-orders/').status_code, 403)

    def test_order_list_sap_outage_reports_warning_without_runtime_500(self):
        draft = self.create()
        draft.status = CustomizationDraft.STATUS_ORDER_POSTED
        draft.sap_order_doc_entry, draft.sap_order_doc_num = '2001', '6001'
        draft.save()
        client = APIClient()
        client.force_login(self.user)
        client.force_authenticate(self.user)
        with patch('api.services.sap_service.SAPServiceLayer.get_local_currency', return_value='EGP'), patch('api.services.sap_service.SAPServiceLayer.get_sales_order', side_effect=TimeoutError('SAP unavailable')):
            response = client.get('/api/customization-delivery/orders/?filter=all')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['orders'][0]['sap_error'], 'SAP unavailable')
