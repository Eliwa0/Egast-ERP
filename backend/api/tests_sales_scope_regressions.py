from datetime import datetime, timezone
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit
import re
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.models_delivery import DeliveryDraft, DeliveryDraftLine
from api.services.customization_service import CustomizationService
from api.services.workflow_order_reads import read_candidate_orders

BASE = '/api/customization-delivery/'


class SalesScopeRegressions(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('scope-fix', password='fixture')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def quote(self, **kwargs):
        return CustomizationDraft.objects.create(created_by=self.user, customer_code='C001', currency='USD', **kwargs)

    def test_draft_filter_keeps_sap_linked_drafts(self):
        linked = self.quote(status='DRAFT', quotation_doc_entry=901)
        local = self.quote(status='DRAFT')
        self.quote(status='ORDER_POSTED', quotation_doc_entry=902)
        response = self.client.get(BASE+'customization/drafts/', {'status':'DRAFT'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({d['id'] for d in response.data['drafts']}, {linked.id, local.id})
        self.assertEqual(response.data['pagination']['total'], 2)

    def test_docentry_search_finds_old_document_outside_first_page(self):
        old = self.quote(status='DRAFT', quotation_doc_entry=873492)
        for i in range(30):
            self.quote(status='DRAFT', quotation_doc_entry=100+i)
        first = self.client.get(BASE+'customization/drafts/').data
        self.assertNotIn(old.id, [d['id'] for d in first['drafts']])
        result = self.client.get(BASE+'customization/drafts/', {'search':'873492'}).data
        self.assertEqual([d['id'] for d in result['drafts']], [old.id])
        self.assertEqual(result['pagination']['total'], 1)

    def test_invalid_numeric_deep_links_return_400_without_sap(self):
        cases = [('delivery/drafts/', 'document'), ('delivery/report/', 'document'),
            ('orders/', 'id'), ('orders/', 'order_number'), ('orders/', 'draft_ids'),
            ('customization/drafts/', 'id'), ('customization/drafts/', 'quotation'),
            ('customization/drafts/', 'quotation_doc_entry'), ('customization/drafts/', 'order_entries')]
        with patch('api.services.sap_service.SAPServiceLayer.get_sales_order') as sap:
            for path, parameter in cases:
                for value in ['invalid', '-1', '9'*100, '١٢']:
                    with self.subTest(path=path, parameter=parameter, value=value):
                        response = self.client.get(BASE+path, {parameter:value})
                        self.assertEqual(response.status_code, 400, getattr(response, 'data', None))
            sap.assert_not_called()

    def seed_deliveries(self):
        for i in range(30):
            draft = DeliveryDraft.objects.create(sales_order_doc_entry=i+10, sales_order_doc_num=str(100+i%3),
                customer_code='C'+str(i%2), customer_name='<Buyer & '+str(i%2)+'>', status='POSTED',
                sap_doc_entry=str(800+i), sap_doc_num=str(900+i), doc_date='2026-09-01', doc_due_date='2026-09-01',
                posted_at=datetime(2026, 10, 1+i%2, tzinfo=timezone.utc), created_by=self.user)
            for j, quantity in enumerate([2., 3.]):
                DeliveryDraftLine.objects.create(draft=draft, line_number=j, item_code='I'+str(j),
                    item_description='Item '+str(j), delivery_quantity=quantity, warehouse_code='WH')

    def test_report_global_totals_and_groups_are_invariant_between_pages(self):
        self.seed_deliveries()
        first = self.client.get(BASE+'delivery/report/').data['report']
        second = self.client.get(BASE+'delivery/report/', {'offset':25}).data['report']
        expected = {'deliveries':30, 'quantity':150., 'customers':2, 'salesOrders':3, 'items':2}
        self.assertEqual(first['summary'], expected)
        self.assertEqual(second['summary'], expected)
        self.assertEqual(len(first['details']), 25)
        self.assertEqual(len(second['details']), 5)
        self.assertTrue(set(d['id'] for d in first['details']).isdisjoint(d['id'] for d in second['details']))
        for name in ['byCustomer', 'byItem', 'bySalesOrder', 'byDate']:
            self.assertEqual(first[name], second[name])
            self.assertEqual(sum(g['quantity'] for g in first[name]), 150.)
        self.assertEqual(second['pagination']['total'], 30)

    def test_report_item_and_date_filters_apply_before_aggregation_and_pagination(self):
        self.seed_deliveries()
        params = {'item':'I0', 'dateFrom':'2026-10-02', 'dateTo':'2026-10-02', 'page_size':5}
        for offset in [0, 5]:
            report = self.client.get(BASE+'delivery/report/', {**params, 'offset':offset}).data['report']
            self.assertEqual(report['summary']['deliveries'], 15)
            self.assertEqual(report['summary']['quantity'], 30.)
            self.assertEqual(report['summary']['items'], 1)
            self.assertEqual(report['pagination']['total'], 15)
            self.assertTrue(all(d['quantity']==2. and d['date']=='2026-10-02' for d in report['details']))
            self.assertTrue(all(len(d['draft']['lines'])==2 for d in report['details']))

    def test_print_contains_complete_filtered_report_and_escaped_labels(self):
        self.seed_deliveries()
        response = self.client.get(BASE+'delivery/report/', {'item':'I0', 'output':'print', 'offset':25})
        self.assertEqual(response.status_code, 200)
        html = b''.join(response.streaming_content).decode()
        self.assertEqual(html.count('<tr>'), 31)  # 30 documents + one item total.
        for number in range(900, 930):
            self.assertIn('#'+str(number), html)
        self.assertIn('&lt;Buyer &amp;', html)
        self.assertNotIn('Item 1', html)
        self.assertIn('<td>60</td>', html)

    def test_report_lookups_browse_and_search_full_dataset_with_bounded_pages(self):
        self.seed_deliveries()
        for i in range(30):
            DeliveryDraft.objects.filter(sap_doc_num=str(900+i)).update(customer_code='B'+str(i), customer_name='Buyer '+str(i))
        first = self.client.get(BASE+'delivery/report/', {'field':'customers'}).data
        self.assertEqual(len(first['options']), 25)
        self.assertEqual(first['next_offset'], 25)
        second = self.client.get(BASE+'delivery/report/', {'field':'customers', 'offset':25}).data
        self.assertEqual(len(second['options']), 5)
        self.assertIsNone(second['next_offset'])
        key = second['options'][0]['key']
        searched = self.client.get(BASE+'delivery/report/', {'field':'customers', 'search':key}).data
        self.assertIn(key, [o['key'] for o in searched['options']])

    def seed_orders(self):
        for i in range(30):
            draft = self.quote(status='ORDER_POSTED', sap_order_doc_entry=str(100+i), sap_order_doc_num=str(1000+i))
            CustomizationDraftLine.objects.create(draft=draft, line_number=0, item_code='ITEM',
                original_quantity=10, customized_quantity=10, original_unit_price=1, customized_unit_price=1)

    def test_order_and_delivery_status_filter_entire_candidates_before_paging(self):
        self.seed_orders()
        # Newest 25 orders are completed; active orders exist outside the old first page.
        def order(entry):
            remaining = 5 if entry < 105 else 0
            return {'DocumentLines':[{'Quantity':10, 'RemainingOpenQuantity':remaining}]}
        def batch(method, endpoint):
            self.assertEqual(method, 'GET')
            self.assertEqual(urlsplit(endpoint).path, 'Orders')
            query = parse_qs(urlsplit(endpoint).query)
            entries = [int(value) for value in re.findall(r'DocEntry eq (\d+)', query['$filter'][0])]
            return {'value': [{'DocEntry': entry, **order(entry)} for entry in entries]}
        with patch('api.services.sap_service.SAPServiceLayer._request', side_effect=batch), \
                patch('api.services.sap_service.SAPServiceLayer.get_sales_order', side_effect=order) as individual:
            for endpoint in ['orders/', 'delivery/eligible-orders/']:
                active = self.client.get(BASE+endpoint, {'filter':'active'}).data
                self.assertEqual(active['pagination']['total'], 5)
                self.assertEqual(len(active['orders']), 5)
                self.assertEqual(active['counts'], {'total':30, 'active':5, 'completed':25})
                self.assertTrue(all(o['sales_order_doc_entry']<105 for o in active['orders']))
                complete = self.client.get(BASE+endpoint, {'filter':'completed', 'page_size':10, 'offset':10}).data
                self.assertEqual(complete['pagination']['total'], 25)
                self.assertEqual(len(complete['orders']), 10)
            partial = self.client.get(BASE+'orders/', {'filter':'all', 'delivery_status':'PARTIAL', 'local_only':'true', 'page_size':2, 'offset':2}).data
            self.assertEqual(partial['pagination']['total'], 5)
            self.assertEqual(len(partial['orders']), 2)
            self.assertTrue(all(o['delivered_quantity']==5 for o in partial['orders']))
            individual.assert_not_called()

    def test_quote_recovery_definitive_rejection_vs_pending_never_reposts(self):
        sap = Mock(base_url='https://fixture', company_db='Fixture')
        sap._request.return_value = {'error':{'code':-1, 'message':{'value':'Invalid warehouse'}}}
        sap.create_sales_quotation.side_effect = lambda data: sap._request('POST', 'Quotations', data)
        request = {'customer_code':'C001', 'currency':'USD', 'lines':[{'item_code':'ITEM','quantity':2,'unit_price':3}]}
        with patch('api.customization_views.CustomizationService', return_value=CustomizationService(sap)):
            rejected = self.client.post(BASE+'quotations/create/', {**request, 'request_key':'rejected'}, format='json')
            self.assertEqual(rejected.status_code, 502)
            for _ in range(2):
                response = self.client.get(BASE+'quotations/posting/rejected/')
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.data['state'], 'REJECTED')
                self.assertFalse(response.data['is_ambiguous'])
            sap._request.assert_called_once()
            sap._request.return_value = {'error':'timeout'}
            pending = self.client.post(BASE+'quotations/create/', {**request, 'customer_code':'C002', 'request_key':'pending'}, format='json')
            self.assertEqual(pending.status_code, 502)
            sap._request.return_value = {'value':[]}
            for _ in range(2):
                response = self.client.get(BASE+'quotations/posting/pending/')
                self.assertEqual(response.status_code, 202)
                self.assertTrue(response.data['is_ambiguous'])
            self.assertEqual(sum(c.args[0]=='POST' for c in sap._request.call_args_list), 2)

    def test_bulk_candidate_reads_follow_sap_pages_and_ignore_unrequested_ids(self):
        sap = Mock()
        sap._request.side_effect = [
            {'value':[{'DocEntry':1}, {'DocEntry':999}], 'odata.nextLink':'Orders?$skip=2'},
            {'value':[{'DocEntry':2}]},
        ]
        result = read_candidate_orders(sap, [1, 2, 3])
        self.assertEqual(set(result), {1, 2})
        self.assertEqual(sap._request.call_count, 2)
        self.assertTrue(all(c.args[0]=='GET' for c in sap._request.call_args_list))
        self.assertIn('%24skip=2', sap._request.call_args.args[1])

    def test_bulk_candidate_read_failure_keeps_existing_individual_fallback(self):
        sap = Mock()
        sap._request.side_effect = TimeoutError('Unavailable')
        self.assertEqual(read_candidate_orders(sap, [1, 2]), {})
        sap._request.assert_called_once()

    def test_large_order_filter_uses_full_bulk_statuses_before_paging(self):
        for i in range(60):
            self.quote(status='ORDER_POSTED', sap_order_doc_entry=str(100+i), sap_order_doc_num=str(1000+i))
        def batch(method, endpoint):
            self.assertEqual(method, 'GET')
            if endpoint == 'CompanyService_GetAdminInfo':
                return {'LocalCurrency': 'EGP'}
            query = parse_qs(urlsplit(endpoint).query)
            entries = [int(value) for value in re.findall(r'DocEntry eq (\d+)', query['$filter'][0])]
            return {'value':[{'DocEntry':entry, 'DocCurrency':'USD', 'DocTotal':522.571, 'DocTotalFc':10,
                'DocumentLines':[{'Quantity':10,'RemainingOpenQuantity':5 if entry < 130 else 0}]} for entry in entries]}
        with patch('api.services.sap_service.SAPServiceLayer._request', side_effect=batch) as transport, \
                patch('api.services.sap_service.SAPServiceLayer.get_sales_order') as individual:
            first = self.client.get(BASE+'orders/', {'filter':'active'}).data
            second = self.client.get(BASE+'orders/', {'filter':'active', 'offset':25}).data
            self.assertEqual(first['pagination']['total'], 30)
            self.assertEqual(second['pagination']['total'], 30)
            self.assertEqual(len(first['orders']), 25)
            self.assertEqual(len(second['orders']), 5)
            self.assertEqual(first['counts'], {'total':60, 'active':30, 'completed':30})
            individual.assert_not_called()
            self.assertEqual(transport.call_count, 6)
