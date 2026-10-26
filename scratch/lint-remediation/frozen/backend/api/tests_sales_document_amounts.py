"""Regression coverage for SAP currency amounts and capped OData pages."""
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit
from django.test import SimpleTestCase, TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.services.sales_order_service import SalesOrderReadError
from api.services.sales_document_normalizer import normalize_delivery_header, normalize_sales_line, normalize_list_params
from api.services.sales_order_service import SalesOrderService
from api.services.sales_quotation_service import SalesQuotationService
from api.services.sap_service import SAPServiceLayer

class DocumentAmountTests(SimpleTestCase):
    def test_all_document_currencies_and_line_totals(self):
        for currency in ('EGP','USD','EUR','GBP','AED','QAR','OMR','KWD','BHD','DKK','SEK'):
            with self.subTest(currency=currency):
                row = {'DocCurrency':currency,'DocTotal':313542.6,'DocTotalFc':6000}
                expected = 313542.6 if currency == 'EGP' else 6000
                self.assertEqual(normalize_delivery_header(row,'EGP')['total_amount'],expected)
                line = {'LineTotal':313542.6,'RowTotalFC':6000,'Currency':'EGP'}
                normalized = normalize_sales_line(line,currency,'EGP')
                self.assertEqual(normalized['line_total'],expected)
                self.assertEqual(normalized['currency'],currency)

    def test_zero_and_missing_foreign_amount_do_not_use_local_amount(self):
        for value in (0,None):
            self.assertEqual(normalize_delivery_header({'DocCurrency':'EUR','DocTotal':900,'DocTotalFc':value},'EGP')['total_amount'],value)

    def test_non_egp_company_currency(self):
        self.assertEqual(normalize_delivery_header({'DocCurrency':'USD','DocTotal':12,'DocTotalFc':0},'USD')['total_amount'],12)
        self.assertEqual(normalize_delivery_header({'DocCurrency':'EGP','DocTotal':12,'DocTotalFc':600},'USD')['total_amount'],600)

    def test_quote_and_order_details_and_lists_share_print_amounts(self):
        for service_type, entity in ((SalesOrderService,'Orders'),(SalesQuotationService,'Quotations')):
            sap = SAPServiceLayer.__new__(SAPServiceLayer)
            row = {'DocEntry':11168,'DocCurrency':'USD','DocTotal':313542.6,'DocTotalFc':6000,
                'DocumentLines':[{'LineTotal':313542.6,'RowTotalFC':6000,'Quantity':1200,'UnitPrice':5}]}
            def read(method,endpoint):
                self.assertEqual(method,'GET')
                if endpoint == 'CompanyService_GetAdminInfo': return {'LocalCurrency':'EGP'}
                return {'value':[row]} if '?' in endpoint else row
            sap._request = Mock(side_effect=read)
            service = service_type(sap)
            doc = service.get_document(11168)
            self.assertEqual(doc['total_amount'],6000)
            self.assertEqual(doc['lines'][0]['line_total'],6000)
            self.assertEqual(service.list_documents(normalize_list_params({}))['documents'][0]['total_amount'],6000)
            self.assertEqual(sum(c.args[1]=='CompanyService_GetAdminInfo' for c in sap._request.call_args_list),1)

class SapContinuationTests(SimpleTestCase):
    def test_server_twenty_row_cap_no_missing_no_duplicates_and_final_page(self):
        sap = SAPServiceLayer.__new__(SAPServiceLayer)
        sap._sales_local_currency = 'EGP'
        requests = []
        def read(method,endpoint):
            self.assertEqual(method,'GET')
            requests.append(endpoint)
            q = parse_qs(urlsplit(endpoint).query)
            self.assertEqual(q['$orderby'],['DocDate desc,DocNum desc'])
            self.assertEqual(q['$filter'],["CardCode eq 'C1'"])
            start=int(q.get('$skip',[0])[0]); top=int(q['$top'][0])
            end=min(start+20,start+top,53)
            result={'value':[{'DocEntry':i,'DocCurrency':'EGP','DocTotal':i} for i in range(start,end)]}
            if end < min(start+top,53):
                from urllib.parse import urlencode
                q['$skip']=[str(end)]; q['$top']=[str(top-(end-start))]
                result['@odata.nextLink']='Orders?'+urlencode({k:v[0] for k,v in q.items()})
            return result
        sap._request=Mock(side_effect=read)
        service=SalesOrderService(sap)
        pages=[]; offset=0
        while True:
            page=service.list_documents(normalize_list_params({'page_size':25,'offset':offset,'customer_code':'C1'}))
            pages.append(page)
            if not page['has_more']: break
            offset=page['next_offset']
        self.assertEqual([p['count'] for p in pages],[25,25,3])
        self.assertEqual([d['document_entry'] for p in pages for d in p['documents']],list(range(53)))
        self.assertEqual([p['has_more'] for p in pages],[True,True,False])
        self.assertEqual(len(requests),5)

    def test_continuation_preserved_when_sap_returns_short_service_page(self):
        client=Mock();client.get_local_currency.return_value='EGP'
        client.get_sales_orders.return_value={'value':[{'DocEntry':i} for i in range(20)],'@odata.nextLink':'Orders?$skip=20'}
        page=SalesOrderService(client).list_documents(normalize_list_params({'page_size':25}))
        self.assertTrue(page['has_more']);self.assertEqual(page['next_offset'],20)

    def test_reject_external_or_repeated_continuation(self):
        sap=SAPServiceLayer.__new__(SAPServiceLayer);sap.base_url='https://sap/b1s/v1'
        sap._request=Mock(return_value={'value':[{}],'@odata.nextLink':'https://other/Orders'})
        self.assertIn('error',sap.get_sales_orders(top=26))


class PostedDeliveryAmountTests(TestCase):
    def test_posted_delivery_api_keeps_header_and_lines_in_foreign_currency(self):
        actor=User.objects.create_superuser('document-amounts','amounts@example.com','test')
        client=APIClient();client.force_authenticate(actor)
        def read(method,endpoint):
            self.assertEqual(method,'GET')
            if endpoint == 'CompanyService_GetAdminInfo': return {'LocalCurrency':'EGP'}
            self.assertEqual(endpoint,'DeliveryNotes(27121)')
            return {'DocEntry':27121,'DocNum':111000041,'DocCurrency':'EUR','DocTotal':313542.6,'DocTotalFc':6000,
                'DocumentLines':[{'LineTotal':313542.6,'RowTotalFC':6000,'Quantity':1200,'UnitPrice':5,'WarehouseCode':'20201','BaseType':17,'BaseEntry':25829,'BaseLine':0}]}
        with patch('api.services.sap_service.SAPServiceLayer._request',side_effect=read):
            response=client.get('/api/customization-delivery/delivery/posted-documents/27121/')
        self.assertEqual(response.status_code,200)
        document=response.data['document'];self.assertEqual(document['currency'],'EUR');self.assertEqual(document['total_amount'],6000)
        self.assertEqual(document['lines'][0]['line_total'],6000)
        self.assertEqual(document['lines'][0]['base_entry'],25829)
        self.assertEqual(document['lines'][0]['warehouse_code'],'20201')

    def test_unavailable_company_currency_does_not_return_mislabelled_amount(self):
        sap=SAPServiceLayer.__new__(SAPServiceLayer)
        sap._request=Mock(side_effect=[{'DocEntry':1,'DocCurrency':'USD','DocTotal':313542.6,'DocTotalFc':6000}, {'error':'Unavailable'}])
        with self.assertRaises(SalesOrderReadError): SalesOrderService(sap).get_document(1)
