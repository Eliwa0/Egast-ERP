from copy import deepcopy
from unittest.mock import Mock, patch
from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase
from api.models import AuditLog
from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.services.customization_service import CustomizationService, CustomizationPostingError
from api.services.sales_posting_journal import SalesPostingJournal, PostingPending


class SalesReadinessTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('ready', password='fixture')
        self.sap = Mock(base_url='https://fixture', company_db='FixtureCompany')
        self.payload = {'CardCode': 'C001', 'DocCurrency': 'USD', 'Comments': 'Original comments',
            'DocumentLines': [{'ItemCode': 'ITEM', 'Quantity': 250., 'UnitPrice': 24., 'WarehouseCode': 'WH'}]}

    def journal(self, key='request-1'):
        return SalesPostingJournal(self.user, self.sap, 'Quotations', key)

    def test_confirmed_response_replays_after_new_service_instance(self):
        self.sap._request.return_value = {'DocEntry': 10, 'DocNum': 20}
        self.assertEqual(self.journal().post(self.payload), self.journal().post(self.payload))
        self.sap._request.assert_called_once()
        self.assertEqual(AuditLog.objects.count(), 2)

    def test_success_lost_response_reconciles_with_marker_and_never_reposts(self):
        saved = {}
        def transport(method, endpoint, payload=None):
            if method == 'POST':
                saved.update(deepcopy(payload), DocEntry=10, DocNum=20)
                return {'error': 'response lost'}
            return {'value': [{'DocEntry': 10}]} if '?' in endpoint else saved
        self.sap._request.side_effect = transport
        with self.assertRaises(PostingPending): self.journal().post(self.payload)
        result = self.journal().post(self.payload)
        self.assertEqual(result['DocEntry'], 10)
        self.assertEqual(sum(c.args[0] == 'POST' for c in self.sap._request.call_args_list), 1)

    def test_timeout_without_match_is_still_pending_after_retry_and_new_token(self):
        self.sap._request.return_value = {'error': 'timeout'}
        with self.assertRaises(PostingPending): self.journal().post(self.payload)
        self.sap._request.return_value = {'value': []}
        for key in ['request-1', 'request-2']:
            with self.assertRaises(PostingPending): self.journal(key).post(self.payload)
        self.assertEqual(sum(c.args[0] == 'POST' for c in self.sap._request.call_args_list), 1)

    def test_duplicate_while_first_post_is_in_flight_cannot_post(self):
        def posting(method, endpoint, payload=None):
            if method == 'GET': return {'value': []}
            with self.assertRaises(PostingPending): self.journal().post(self.payload)
            return {'DocEntry': 10, 'DocNum': 20}
        self.sap._request.side_effect = posting
        self.journal().post(self.payload)
        self.assertEqual(sum(c.args[0] == 'POST' for c in self.sap._request.call_args_list), 1)

    def test_key_cannot_change_payload(self):
        self.sap._request.return_value = {'DocEntry': 10, 'DocNum': 20}
        self.journal().post(self.payload)
        with self.assertRaises(ValueError): self.journal().post({**self.payload, 'DocCurrency': 'EGP'})
        self.sap._request.assert_called_once()

    def test_company_scopes_are_independent(self):
        self.sap._request.return_value = {'DocEntry': 10, 'DocNum': 20}
        self.journal().post(self.payload)
        self.sap.company_db = 'OtherCompany'
        self.journal().post(self.payload)
        self.assertEqual(self.sap._request.call_count, 2)

    def test_mismatched_reconciliation_is_not_adopted(self):
        self.sap._request.return_value = {'error': 'timeout'}
        with self.assertRaises(PostingPending): self.journal().post(self.payload)
        marker = AuditLog.objects.first().details['marker']
        self.sap._request.side_effect = [{'value': [{'DocEntry': 10}]},
            {**self.payload, 'DocEntry': 10, 'Comments': marker, 'CardCode': 'OTHER'}]
        with self.assertRaises(PostingPending): self.journal().post(self.payload)

    def test_quote_retry_does_not_duplicate_local_draft(self):
        doc = {**self.payload, 'DocEntry': 10, 'DocNum': 20, 'DocumentLines': [
            {**self.payload['DocumentLines'][0], 'LineNum': 0}]}
        self.sap.create_sales_quotation.return_value = doc
        self.sap.get_sales_quotation.return_value = doc
        service = CustomizationService(self.sap)
        args = dict(user=self.user, customer_code='C001', request_key='stable', lines_data=[
            {'item_code': 'ITEM', 'quantity': 250, 'unit_price': 24, 'warehouse_code': 'WH'}])
        self.assertEqual(service.create_quotation_and_draft(**args).id, service.create_quotation_and_draft(**args).id)
        self.sap.create_sales_quotation.assert_called_once()
        self.assertEqual(CustomizationDraft.objects.count(), 1)

    def order_draft(self, status='READY_FOR_ORDER'):
        draft = CustomizationDraft.objects.create(created_by=self.user, customer_code='C001',
            quotation_doc_entry=10, quotation_doc_num='20', currency='USD', status=status)
        CustomizationDraftLine.objects.create(draft=draft, line_number=0, item_code='ITEM',
            original_quantity=250, customized_quantity=250, original_unit_price=24,
            customized_unit_price=24, warehouse_code='WH')
        return draft

    def test_legacy_uncertain_order_without_marker_never_reposts(self):
        draft = self.order_draft('ORDER_POSTING')
        with self.assertRaises(CustomizationPostingError) as error:
            CustomizationService(self.sap).post_sales_order_to_sap(draft, self.user)
        self.assertTrue(error.exception.is_ambiguous)
        self.sap._request.assert_not_called()

    def test_order_lost_response_retry_uses_original_payload_and_shared_actor_scope(self):
        draft = self.order_draft()
        saved = {}
        def transport(method, endpoint, payload=None):
            if method == 'POST':
                saved.update(deepcopy(payload), DocEntry=100, DocNum=200)
                return {'error': 'response lost'}
            return {'value': [{'DocEntry': 100}]} if '?' in endpoint else saved
        self.sap._request.side_effect = transport
        service = CustomizationService(self.sap)
        with self.assertRaises(CustomizationPostingError):
            service.post_sales_order_to_sap(draft, self.user, doc_due_date='2026-10-15')
        draft.refresh_from_db()
        other = User.objects.create_superuser('other-actor', password='fixture')
        result = service.post_sales_order_to_sap(draft, other, doc_due_date='2027-01-01')
        self.assertEqual(result.status, 'ORDER_POSTED')
        self.assertEqual(result.raw_order_payload['DocDueDate'], '2026-10-15')
        self.assertEqual(sum(c.args[0] == 'POST' for c in self.sap._request.call_args_list), 1)

    def test_definitive_rejection_is_persisted_without_second_post(self):
        self.sap._request.return_value = {'error': {'code': -1, 'message': {'value': 'Invalid warehouse'}}}
        self.assertEqual(self.journal().post(self.payload), self.journal().post(self.payload))
        self.sap._request.assert_called_once()
        self.assertEqual(AuditLog.objects.order_by('-id').first().details['state'], 'REJECTED')

    def test_reconciliation_transport_exception_stays_pending(self):
        self.sap._request.return_value = {'error': 'timeout'}
        with self.assertRaises(PostingPending): self.journal().post(self.payload)
        self.sap._request.side_effect = TimeoutError('SAP unavailable')
        with self.assertRaises(PostingPending): self.journal().post(self.payload)
        self.assertEqual(sum(c.args[0] == 'POST' for c in self.sap._request.call_args_list), 1)

    def test_long_comments_rejected_before_intent_or_sap_without_truncation(self):
        with self.assertRaises(ValueError): self.journal().post({**self.payload, 'Comments': 'x' * 254})
        self.sap._request.assert_not_called()
        self.assertFalse(AuditLog.objects.exists())

    def test_order_validation_before_intent_does_not_leave_false_uncertain_state(self):
        from api.services.customization_service import CustomizationStateError
        draft = self.order_draft()
        with self.assertRaises(CustomizationStateError):
            CustomizationService(self.sap).post_sales_order_to_sap(draft, self.user, customer_reference_number='x' * 254)
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'ORDER_FAILED')
        self.sap._request.assert_not_called()
        self.assertFalse(AuditLog.objects.filter(action=SalesPostingJournal.ACTION).exists())

    def test_exact_quote_status_api_recovers_lost_response_and_refresh_without_new_post(self):
        from rest_framework.test import APIClient
        saved = {}
        def transport(method, endpoint, payload=None):
            if method == 'POST':
                saved.update(deepcopy(payload), DocEntry=10, DocNum=20, DocTotal=6000)
                return {'error':'response lost'}
            return {'value':[{'DocEntry':10}]} if '?' in endpoint else saved
        self.sap._request.side_effect = transport
        self.sap.create_sales_quotation.side_effect = lambda payload: transport('POST','Quotations',payload)
        self.sap.get_sales_quotation.side_effect = lambda entry: saved
        client = APIClient(); client.force_authenticate(self.user)
        with patch('api.customization_views.CustomizationService', return_value=CustomizationService(self.sap)):
            first = client.post('/api/customization-delivery/quotations/create/', {'request_key':'reload-key',
                'customer_code':'C001','currency':'USD','lines':[{'item_code':'ITEM','quantity':250,'unit_price':24,'warehouse_code':'WH'}]}, format='json')
            self.assertEqual(first.status_code, 502, first.data)
            self.assertTrue(first.data['is_ambiguous'])
            for _ in range(2):
                recovered = client.get('/api/customization-delivery/quotations/posting/reload-key/')
                self.assertEqual(recovered.status_code, 200, recovered.data)
                self.assertEqual(recovered.data['state'], 'CONFIRMED')
                self.assertEqual(recovered.data['draft']['currency'], 'USD')
                self.assertEqual(recovered.data['draft']['total_amount'], 6000)
            other = User.objects.create_superuser('other-session', password='fixture')
            client.force_authenticate(other)
            self.assertEqual(client.get('/api/customization-delivery/quotations/posting/reload-key/').data['state'], 'NOT_STARTED')
        self.sap.create_sales_quotation.assert_called_once()
        self.assertEqual(CustomizationDraft.objects.count(), 1)

    def test_quote_warehouse_is_preserved_without_inventory_allocations(self):
        for item in ['NORMAL', 'BATCH', 'SERIAL']:
            with self.subTest(item=item):
                doc = {'DocEntry':len(item)*10,'DocNum':len(item)*20,'DocCurrency':'USD',
                    'DocumentLines':[{'LineNum':0,'ItemCode':item,'Quantity':250,'UnitPrice':24,'WarehouseCode':'OPERATOR-WH'}]}
                self.sap.create_sales_quotation.return_value = doc
                self.sap.get_sales_quotation.return_value = doc
                CustomizationService(self.sap).create_quotation_and_draft(user=self.user, customer_code='C001',
                    request_key=f'warehouse-{item}',lines_data=[{'item_code':item,'quantity':250,'unit_price':24,'warehouse_code':'OPERATOR-WH'}])
                sent = self.sap.create_sales_quotation.call_args.args[0]['DocumentLines'][0]
                self.assertEqual(sent['WarehouseCode'], 'OPERATOR-WH')
                self.assertNotIn('BatchNumbers', sent)
                self.assertNotIn('SerialNumbers', sent)

    def test_missing_warehouse_uses_sap_returned_default_and_invalid_is_not_substituted(self):
        self.sap.create_sales_quotation.return_value = {'DocEntry':10,'DocNum':20,'DocCurrency':'USD','DocumentLines':[
            {'LineNum':0,'ItemCode':'ITEM','Quantity':250,'UnitPrice':24,'WarehouseCode':'SAP-DEFAULT'}]}
        self.sap.get_sales_quotation.return_value = self.sap.create_sales_quotation.return_value
        service = CustomizationService(self.sap)
        draft = service.create_quotation_and_draft(user=self.user,customer_code='C001',request_key='missing-wh',
            lines_data=[{'item_code':'ITEM','quantity':250,'unit_price':24}])
        self.assertNotIn('WarehouseCode', self.sap.create_sales_quotation.call_args.args[0]['DocumentLines'][0])
        self.assertEqual(draft.lines.first().warehouse_code, 'SAP-DEFAULT')
        self.sap.create_sales_quotation.return_value = {'error':{'code':-1,'message':{'value':'Invalid warehouse'}}}
        with self.assertRaises(CustomizationPostingError) as error:
            service.create_quotation_and_draft(user=self.user,customer_code='C001',request_key='bad-wh',
                lines_data=[{'item_code':'ITEM','quantity':250,'unit_price':24,'warehouse_code':'INVALID'}])
        self.assertFalse(error.exception.is_ambiguous)
        self.assertEqual(self.sap.create_sales_quotation.call_args.args[0]['DocumentLines'][0]['WarehouseCode'], 'INVALID')


class SalesPostingWorkerConcurrencyTests(TransactionTestCase):
    def test_independent_database_connections_cannot_double_post(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier, Lock
        from django.db import connections
        user = User.objects.create_superuser('parallel-posting', password='fixture')
        barrier, guard = Barrier(2), Lock()
        sent = []
        sap = Mock(base_url='https://fixture', company_db='FixtureCompany')
        payload = {'CardCode':'C001','DocCurrency':'USD','DocumentLines':[{'ItemCode':'ITEM','Quantity':1}]}
        def transport(method, endpoint, body=None):
            if method == 'GET': return {'value':[]}
            with guard: sent.append(body)
            return {'DocEntry':10,'DocNum':20}
        sap._request.side_effect = transport
        def worker():
            try:
                actor = User.objects.get(pk=user.pk)
                barrier.wait(timeout=5)
                return SalesPostingJournal(actor, sap, 'Quotations', 'parallel-1').post(payload)
            except PostingPending:
                return 'VERIFYING'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(lambda _: worker(), range(2)))
        # A contended SQLite claim can fail closed in both workers, before SAP.
        # A subsequent request may create its first intent, but can never duplicate a sent one.
        if not sent:
            SalesPostingJournal(user, sap, 'Quotations', 'parallel-1').post(payload)
        self.assertEqual(len(sent), 1, outcomes)
        self.assertEqual(AuditLog.objects.filter(action=SalesPostingJournal.ACTION, details__state='VERIFYING').count(), 1)
