"""Hermetic correctness and concurrency checks; no live ERP traffic."""
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from django.core.cache import cache
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from api.services.sap_service import SAPServiceLayer


class BulkTrackingTests(SimpleTestCase):
    def test_flags_are_refreshed_on_each_read_without_inventory_or_state_caching(self):
        sap = SAPServiceLayer()
        sap._request = Mock(side_effect=[
            {'value': [{'ItemCode': 'A', 'ManageBatchNumbers': 'tYES', 'ManageSerialNumbers': 'tNO'}]},
            {'value': [{'ItemCode': 'A', 'ManageBatchNumbers': 'tNO', 'ManageSerialNumbers': 'tYES'}]},
        ])
        self.assertEqual(sap.get_item_tracking_flags_bulk(['A'])['A'], {'manage_batches': True, 'manage_serials': False})
        self.assertEqual(sap.get_item_tracking_flags_bulk(['A'])['A'], {'manage_batches': False, 'manage_serials': True})

    def test_bulk_matches_existing_tracking_flags_and_escapes_codes(self):
        sap = SAPServiceLayer()
        rows = [
            {'ItemCode': "A'1", 'ManageBatchNumbers': 'tYES', 'ManageSerialNumbers': 'tNO'},
            {'ItemCode': 'B', 'ManageBatchNumbers': 'tNO', 'ManageSerialNumbers': 'tYES'},
        ]
        sap._request = Mock(return_value={'value': rows})
        sap.get_item_tracking_flags = Mock(side_effect=AssertionError('Unexpected fallback'))
        self.assertEqual(sap.get_item_tracking_flags_bulk(["A'1", 'B', "A'1", '']), {
            "A'1": {'manage_batches': True, 'manage_serials': False},
            'B': {'manage_batches': False, 'manage_serials': True},
        })
        self.assertIn("A''1", parse_qs(urlsplit(sap._request.call_args.args[1]).query)['$filter'][0])
        self.assertEqual(sap._request.call_count, 1)

    def test_missing_fields_or_failed_bulk_preserve_exact_old_fallback(self):
        sap = SAPServiceLayer()
        sap._request = Mock(return_value={'value': [{'ItemCode': 'A', 'ManageBatchNumbers': 'tNO'}]})
        expected = {'manage_batches': True, 'manage_serials': False}
        sap.get_item_tracking_flags = Mock(return_value=expected)
        self.assertEqual(sap.get_item_tracking_flags_bulk(['A']), {'A': expected})
        sap.get_item_tracking_flags.assert_called_once_with('A')
        sap._request.return_value = {'error': 'Unsupported query'}
        self.assertEqual(sap.get_item_tracking_flags_bulk(['B']), {'B': expected})

    def test_bulk_follows_server_page_cap_and_bounds_filter_size(self):
        sap = SAPServiceLayer()
        requested = []
        def read(method, endpoint):
            query = parse_qs(urlsplit(endpoint).query)
            codes = [str(i) for i in range(101) if f"ItemCode eq '{i}'" in query['$filter'][0]]
            self.assertLessEqual(len(codes), 40)
            offset = int(query.get('$skip', ['0'])[0])
            selected = codes[offset:offset + 20]
            requested.append(len(selected))
            return {'value': [{'ItemCode': code, 'ManageBatchNumbers': 'tNO', 'ManageSerialNumbers': 'tNO'} for code in selected],
                    **({'odata.nextLink': 'more'} if offset + len(selected) < len(codes) else {})}
        sap._request = read
        sap.get_item_tracking_flags = Mock(side_effect=AssertionError('Unexpected fallback'))
        self.assertEqual(len(sap.get_item_tracking_flags_bulk([str(i) for i in range(101)])), 101)
        self.assertEqual(sum(requested), 101)


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class CacheSingleFlightTests(SimpleTestCase):
    def test_simultaneous_misses_load_once_and_cleanup_locks(self):
        from api.services import cache_service as service
        cache.clear()
        loader = Mock(side_effect=lambda: (time.sleep(.03), {'rows': [1, 2]})[1])
        with ThreadPoolExecutor(max_workers=8) as pool:
            values = list(pool.map(lambda _: service.cache_get_or_set('test', 'flight-key', loader, 'sap_items'), range(8)))
        self.assertTrue(all(value == {'rows': [1, 2]} for value in values))
        self.assertEqual(loader.call_count, 1)
        self.assertFalse(service._LOAD_LOCKS)

    def test_failure_does_not_poison_cache_or_leave_lock(self):
        from api.services import cache_service as service
        cache.clear()
        with self.assertRaises(ValueError):
            service.cache_get_or_set('test', 'error-key', lambda: (_ for _ in ()).throw(ValueError()), 'sap_items')
        self.assertEqual(service.cache_get_or_set('test', 'error-key', lambda: 7, 'sap_items'), 7)
        self.assertFalse(service._LOAD_LOCKS)


class PerformanceMetricsTests(SimpleTestCase):
    @override_settings(PERFORMANCE_METRICS_ENABLED=True)
    def test_middleware_has_correlated_timings_and_no_payload_or_query_values(self):
        from api.performance import PerformanceMiddleware, record_sap, record_cache
        def view(request):
            record_sap('GET', 'Items?$filter=SECRET', .012, 20, True)
            record_cache('hit')
            return JsonResponse({'secret': 'not-in-metrics'})
        request = RequestFactory().get('/api/items/?secret=private', HTTP_X_REQUEST_ID='fixture-123')
        request.resolver_match = SimpleNamespace(route='api/items/')
        with self.assertLogs('egast.performance', level='INFO') as logs:
            response = PerformanceMiddleware(view)(request)
        self.assertEqual(response['X-Request-ID'], 'fixture-123')
        self.assertIn('sap;dur=12.00', response['Server-Timing'])
        summary = json.loads(logs.output[0].split('egast.performance:', 1)[1])
        self.assertEqual(summary['sap_requests'], 1)
        self.assertEqual(summary['sap_records'], 20)
        self.assertNotIn('SECRET', logs.output[0])
        self.assertNotIn('private', logs.output[0])
        self.assertNotIn('not-in-metrics', logs.output[0])

    @override_settings(PERFORMANCE_METRICS_ENABLED=False)
    def test_untrusted_correlation_id_is_replaced_and_metrics_disabled(self):
        from api.performance import PerformanceMiddleware
        response = PerformanceMiddleware(lambda request: JsonResponse({}))(RequestFactory().get('/', HTTP_X_REQUEST_ID='bad\nvalue'))
        self.assertNotEqual(response['X-Request-ID'], 'bad\nvalue')
        self.assertNotIn('Server-Timing', response)


class CandidateBatchTests(SimpleTestCase):
    def test_duplicate_entries_are_read_once_with_bounded_pages(self):
        from api.services.workflow_order_reads import read_candidate_orders
        sap = Mock()
        sap._request.return_value = {'value': [{'DocEntry': 1, 'DocumentLines': []}, {'DocEntry': 2, 'DocumentLines': []}]}
        self.assertEqual(set(read_candidate_orders(sap, [1, 1, 2])), {1, 2})
        query = parse_qs(urlsplit(sap._request.call_args.args[1]).query)
        self.assertEqual(query['$top'], ['2'])


class TransportPoolingTests(SimpleTestCase):
    def test_pool_reuses_only_same_thread_and_scope_without_automatic_retries(self):
        from api.services import sap_transport as transport
        transport._local = threading.local()
        with patch.object(transport.requests, 'Session') as factory:
            session = factory.return_value
            session.request.return_value = SimpleNamespace(status_code=200)
            transport.pooled_request(('company-A', True), 'GET', 'https://example.invalid/Items', timeout=30)
            transport.pooled_request(('company-A', True), 'POST', 'https://example.invalid/DeliveryNotes', json={'test': True}, timeout=30)
            self.assertEqual(factory.call_count, 1)
            self.assertEqual(session.request.call_count, 2)
            policy = session.cookies.set_policy.call_args.args[0]
            self.assertFalse(policy.set_ok(None, None))
            transport.pooled_request(('company-B', True), 'GET', 'https://example.invalid/Items')
            self.assertEqual(factory.call_count, 2)
            session.close.assert_called_once()
        transport._local = threading.local()

    def test_threads_have_independent_sessions(self):
        from api.services import sap_transport as transport
        barrier = threading.Barrier(2)
        with patch.object(transport.requests, 'Session') as factory:
            def request(_):
                barrier.wait(timeout=2)
                transport.pooled_request('same-company', 'GET', 'https://example.invalid/Items')
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(request, range(2)))
            self.assertEqual(factory.call_count, 2)


class DeliveryListQueryTests(TestCase):
    def test_list_query_count_does_not_grow_for_absent_shipping_operations(self):
        from datetime import date
        from pathlib import Path
        from django.contrib.auth.models import User
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        from rest_framework.test import APIClient
        from api.models_delivery import DeliveryDraft
        user = User.objects.create_superuser('query-fixture', password='fixture')
        for index in range(10):
            DeliveryDraft.objects.create(customer_code='FIXTURE', customer_name='Fixture',
                sales_order_doc_entry=index + 1, sales_order_doc_num=str(index + 1),
                doc_date=date(2026, 10, 20), doc_due_date=date(2026, 10, 20), created_by=user)
        client = APIClient()
        client.force_authenticate(user)
        samples = []
        for size in (1, 10):
            start = time.perf_counter()
            with CaptureQueriesContext(connection) as captured:
                response = client.get('/api/customization-delivery/delivery/drafts/', {'page_size': size})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.data['drafts']), size)
            self.assertTrue(all(row['shipping_manifest'] is None for row in response.data['drafts']))
            samples.append({'rows': size, 'queries': len(captured), 'ms': round((time.perf_counter() - start) * 1000, 2)})
        # Keep evidence even if the regression assertion fails on the legacy code.
        Path('../scratch/performance-orm-latest.json' if Path.cwd().name == 'backend' else 'scratch/performance-orm-latest.json').write_text(json.dumps(samples, indent=2))
        self.assertLessEqual(samples[1]['queries'], samples[0]['queries'] + 1)

    def test_batch_candidate_results_match_legacy_for_filters_and_offsets(self):
        from datetime import date
        from django.contrib.auth.models import User
        from rest_framework.test import APIClient
        from api.models_customization import CustomizationDraft, CustomizationDraftLine
        from api.services.workflow_order_reads import read_candidate_orders
        user = User.objects.create_superuser('equivalence', password='fixture')
        for index in range(12):
            draft = CustomizationDraft.objects.create(customer_code='FIXTURE', customer_name='Fixture',
                status='ORDER_POSTED', currency='USD', quotation_doc_entry=index+1,
                sap_order_doc_entry=str(index+1), sap_order_doc_num=str(index+100), created_by=user)
            CustomizationDraftLine.objects.create(draft=draft, line_number=0, item_code='FIXTURE',
                original_quantity=10, customized_quantity=10, original_unit_price=2, customized_unit_price=2)
        def document(entry):
            return {'DocEntry': entry, 'DocNum': entry+100, 'DocumentStatus': 'bost_Close' if entry % 3 == 0 else 'bost_Open',
                    'DocCurrency': 'USD', 'DocTotal': 20, 'DocDate': '2026-10-20', 'DocumentLines':
                    [{'ItemCode': 'FIXTURE', 'ItemDescription': 'Fixture', 'Quantity': 10, 'RemainingOpenQuantity': 5 if entry % 2 else 10}]}
        sap = Mock()
        sap.get_sales_order.side_effect = document
        sap.get_local_currency.return_value = 'USD'
        def batch(method, endpoint):
            query = parse_qs(urlsplit(endpoint).query)
            import re
            return {'value': [document(int(value)) for value in re.findall(r'DocEntry eq (\d+)', query['$filter'][0])]}
        sap._request.side_effect = batch
        client = APIClient(); client.force_authenticate(user)
        with patch('api.services.sap_service.SAPServiceLayer', return_value=sap):
            for path in ('orders/', 'delivery/eligible-orders/'):
                for status in ('all', 'active', 'completed'):
                    for delivery_status in ('ALL', 'FULLY_DELIVERED', 'PARTIAL', 'NOT_DELIVERED'):
                        params = {'filter': status, 'delivery_status': delivery_status, 'page_size': 3, 'offset': 3}
                        with patch('api.services.workflow_order_reads.read_candidate_orders', return_value={}):
                            legacy = client.get('/api/customization-delivery/' + path, params)
                        with patch('api.services.workflow_order_reads.read_candidate_orders', wraps=read_candidate_orders):
                            current = client.get('/api/customization-delivery/' + path, params)
                        self.assertEqual(current.status_code, 200)
                        self.assertEqual(current.data, legacy.data)
