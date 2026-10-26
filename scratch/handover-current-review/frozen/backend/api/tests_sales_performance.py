import json
import re
from pathlib import Path
from time import perf_counter
from unittest.mock import Mock, patch
from urllib.parse import urlsplit, parse_qs
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from api.models_customization import CustomizationDraft, CustomizationDraftLine
from api.models_delivery import DeliveryDraft, DeliveryDraftLine


class SalesLargeDatasetTests(TestCase):
    @override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
    def test_large_master_search_pages_and_cache(self):
        from django.core.cache import cache
        cache.clear()
        user = User.objects.create_superuser('master-performance', password='fixture')
        client = APIClient()
        client.force_authenticate(user)
        metrics = []
        for size in [1000, 5000, 10000]:
            for label, endpoint, entity, code, name, collection in [
                ('Customers', '/api/customization-delivery/customers/', 'BusinessPartners', 'CardCode', 'CardName', 'customers'),
                ('Items', '/api/customization-delivery/items/', 'Items', 'ItemCode', 'ItemName', 'items'),
                ('Warehouses', '/api/warehouses/', 'Warehouses', 'WarehouseCode', 'WarehouseName', 'warehouses')]:
                cache.clear()
                source = [{code:f'FIX-{i:05}',name:f'Catalog {i:05} long descriptive name',
                    'Inactive':'tNO','Currency':'USD','CardType':'cCustomer','ItemPrices':[], 'BPAddresses':[],
                    'SalesUnit':'KG','DefaultWarehouse':'WH'} for i in range(size)]
                sap = Mock()
                def transport(method, path, **kwargs):
                    self.assertEqual(method, 'GET')
                    query = parse_qs(urlsplit(path).query)
                    self.assertIn('$top', query)
                    limit = int(query['$top'][0]); offset = int(query.get('$skip', [0])[0])
                    self.assertLessEqual(limit, 25)
                    selection = [source[1]] if 'Catalog 00001' in query.get('$filter', [''])[0] else source
                    return {'value': selection[offset:offset+limit]}
                sap._request.side_effect = transport
                initial_params = {'lookup':1, 'limit':25, **({'initial':1} if label == 'Warehouses' else {'search':'Catalog'})}
                with patch('api.services.sap_service.SAPServiceLayer', return_value=sap), \
                    patch('api.customization_views.SAPServiceLayer', return_value=sap), \
                    patch('api.views.SAPServiceLayer', return_value=sap), \
                    patch('api.views.sap', sap), \
                    patch('api.customization_views._get_octg_terms_map', return_value={}), \
                    patch('api.customization_views._get_payment_terms_details', return_value={}):
                    first = client.get(endpoint, initial_params)
                    second = client.get(endpoint, {**initial_params, 'offset':25})
                    result = client.get(endpoint, {'lookup':1,'limit':25,'search':'Catalog 00001'})
                    calls_before_repeat = sap._request.call_count
                    repeated = client.get(endpoint, initial_params)
                self.assertEqual(first.status_code, 200, first.data)
                self.assertEqual(second.status_code, 200)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(len(first.data.get('data', first.data)[collection]), 25, (label, first.data))
                self.assertEqual(len(second.data.get('data', second.data)[collection]), 25)
                self.assertEqual(len(result.data.get('data', result.data)[collection]), 1)
                self.assertEqual(repeated.data, first.data)
                if label != 'Items':
                    self.assertEqual(sap._request.call_count, calls_before_repeat)
                metrics.append({'list':label,'dataset':size,'browser_requests':4,
                    'sap_reads':sap._request.call_count,'initial_bytes':len(first.content),'search_bytes':len(result.content),
                    'initial_rows':25,'next_rows':25,'search_rows':1,'server_cached':label != 'Items'})
        (Path(__file__).resolve().parents[2] / 'scratch/readiness-master-performance.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')

    def test_document_pages_are_bounded_at_1000_5000_and_10000(self):
        user = User.objects.create_superuser('performance', password='fixture')
        client = APIClient()
        client.force_login(user)
        client.force_authenticate(user)
        metrics = []
        sap = Mock()
        sap.get_sales_order.return_value = {'DocEntry': 1, 'DocCurrency': 'USD', 'DocTotal': 6000,
            'DocumentLines': [{'ItemCode': 'ITEM', 'ItemDescription': 'Long fixture item description', 'Quantity': 250,
                              'RemainingOpenQuantity': 250, 'WarehouseCode': 'WH'}]}
        def batch_read(method, endpoint):
            self.assertEqual(method, 'GET')
            query = parse_qs(urlsplit(endpoint).query)
            entries = [int(value) for value in re.findall(r'DocEntry eq (\d+)', query['$filter'][0])]
            self.assertLessEqual(len(entries), 50)
            return {'value': [{**sap.get_sales_order.return_value, 'DocEntry': entry} for entry in entries]}
        sap._request.side_effect = batch_read
        previous = 0
        for size in [1000, 5000, 10000]:
            quotes = CustomizationDraft.objects.bulk_create([CustomizationDraft(
                customer_code=f'C{i:05}', customer_name=f'Customer {i:05} with a realistic long description',
                status='ORDER_POSTED', currency='USD', quotation_doc_entry=i+1, quotation_doc_num=str(i+10000),
                sap_order_doc_entry=str(i+20000), sap_order_doc_num=str(i+30000), created_by=user)
                for i in range(previous, size)])
            CustomizationDraftLine.objects.bulk_create([CustomizationDraftLine(draft=q, line_number=j,
                item_code=f'ITEM-{j}', item_description='A realistic long product description',
                original_quantity=50, customized_quantity=50, original_unit_price=24, customized_unit_price=24,
                warehouse_code='WH') for q in quotes for j in range(5)])
            deliveries = DeliveryDraft.objects.bulk_create([DeliveryDraft(customer_code=q.customer_code,
                customer_name=q.customer_name, sales_order_doc_entry=int(q.sap_order_doc_entry),
                sales_order_doc_num=q.sap_order_doc_num, status='POSTED', sap_doc_entry=str(q.pk+40000),
                sap_doc_num=str(q.pk+50000), doc_date='2026-10-04', doc_due_date='2026-10-04', created_by=user) for q in quotes])
            DeliveryDraftLine.objects.bulk_create([DeliveryDraftLine(draft=d, line_number=j,
                item_code=f'ITEM-{j}', item_description='Long delivery item description', order_quantity=50,
                open_quantity_at_draft=50, delivery_quantity=50, warehouse_code='WH') for d in deliveries for j in range(5)])
            previous = size
            for label, endpoint, collection in [
                ('Quotations', '/api/customization-delivery/customization/drafts/', 'drafts'),
                ('Sales Orders', '/api/customization-delivery/orders/?filter=all', 'orders'),
                ('Delivery Orders', '/api/customization-delivery/delivery/eligible-orders/?filter=all', 'orders'),
                ('Posted Deliveries', '/api/customization-delivery/delivery/drafts/?status=POSTED', 'drafts')]:
                sap.get_sales_order.reset_mock()
                sap._request.reset_mock()
                started = perf_counter()
                with patch('api.services.sap_service.SAPServiceLayer', return_value=sap):
                    first = client.get(endpoint, {'page_size': 25})
                    next_page = client.get(endpoint, {'page_size': 25, 'offset': 25})
                    search = client.get(endpoint, {'page_size': 25, 'search': 'Customer 00001'})
                self.assertEqual(first.status_code, 200)
                self.assertLessEqual(len(first.data[collection]), 25)
                self.assertLessEqual(len(search.data[collection]), 25)
                self.assertEqual(first.data['pagination']['total'], size)
                self.assertTrue(first.data['pagination']['has_more'])
                self.assertFalse(search.data['pagination']['has_more'])
                self.assertEqual(len(search.data[collection]), 1)
                ids = 'id' if collection == 'drafts' else 'customization_draft_id'
                self.assertFalse({d[ids] for d in first.data[collection]} & {d[ids] for d in next_page.data[collection]})
                self.assertLessEqual(sap.get_sales_order.call_count, 51)
                self.assertLessEqual(sap._request.call_count, 2*((size+49)//50))
                metrics.append({'list': label, 'dataset': size, 'browser_requests': 3,
                    'sap_reads_initial_plus_next_plus_search': sap.get_sales_order.call_count,
                    'initial_bytes': len(first.content), 'search_bytes': len(search.content),
                    'returned_initial': len(first.data[collection]), 'returned_search': len(search.data[collection]),
                    'three_requests_ms': round((perf_counter()-started)*1000, 2)})
        target = Path(__file__).resolve().parents[2] / 'scratch/readiness-performance.json'
        target.write_text(json.dumps(metrics, indent=2), encoding='utf-8')
