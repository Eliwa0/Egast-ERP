"""Deterministic before/after measurements, simulated ERP RTT, zero live SAP calls.

The legacy path reproduces the original production lookup loop. This measures
actual wall time under a controlled 2ms transport delay, NOT production latency.
"""
import json
import os
import re
import statistics
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
import django
django.setup()
from api.services.sap_service import SAPServiceLayer
from api.services.workflow_order_reads import read_candidate_orders


def run():
    results = []
    for count in (1, 10, 50, 101):
        for mode in ('legacy', 'bulk'):
            samples, calls = [], []
            for _ in range(10):
                sap = SAPServiceLayer()
                codes = [f'F{i:03}' for i in range(count)]
                request_count = 0
                def pause():
                    nonlocal request_count
                    request_count += 1
                    time.sleep(.002)
                def ensure(*args):
                    pause()
                    return {}
                def sql(code, params):
                    pause()
                    item = params.split("'")[1]
                    return {'value': [{'ItemCode': item, 'ManBtchNum': 'Y', 'ManSerNum': 'N'}]}
                def read(method, path):
                    pause()
                    query = parse_qs(urlsplit(path).query)
                    selected = re.findall(r"ItemCode eq '([^']+)'", query['$filter'][0])
                    offset = int(query.get('$skip', ['0'])[0])
                    page = selected[offset:offset + 20]
                    return {'value': [{'ItemCode': code, 'ManageBatchNumbers': 'tYES', 'ManageSerialNumbers': 'tNO'} for code in page],
                            **({'odata.nextLink': 'more'} if offset + len(page) < len(selected) else {})}
                sap.ensure_sql_query = ensure
                sap.execute_sql_query = sql
                sap._request = read
                began = time.perf_counter()
                flags = ({code: sap.get_item_tracking_flags(code) for code in codes} if mode == 'legacy'
                         else sap.get_item_tracking_flags_bulk(codes))
                samples.append((time.perf_counter() - began) * 1000)
                calls.append(request_count)
                assert flags == {code: {'manage_batches': True, 'manage_serials': False} for code in codes}
            results.append({'workflow': 'production_item_flags', 'items': count, 'mode': mode,
                            'samples': len(samples), 'median_ms': round(statistics.median(samples), 2),
                            'sap_calls': calls[0], 'equivalent': True,
                            'note': 'fixture transport delay 2ms per call; no production p95'})
    for count in (1, 10, 50, 101):
        for mode in ('legacy', 'batch'):
            sap = Mock()
            def read_orders(method, endpoint):
                time.sleep(.002)
                query = parse_qs(urlsplit(endpoint).query)
                entries = [int(value) for value in re.findall(r'DocEntry eq (\d+)', query['$filter'][0])]
                offset = int(query.get('$skip', ['0'])[0])
                page = entries[offset:offset + 20]
                return {'value': [{'DocEntry': value, 'DocumentLines': []} for value in page],
                        **({'odata.nextLink': 'more'} if offset + len(page) < len(entries) else {})}
            sap._request.side_effect = read_orders
            sap.get_sales_order.side_effect = lambda entry: (time.sleep(.002), {'DocEntry': entry, 'DocumentLines': []})[1]
            entries = list(range(count))
            started = time.perf_counter()
            if count > (50 if mode == 'legacy' else 1):
                records = read_candidate_orders(sap, entries)
            else:
                records = {entry: sap.get_sales_order(entry) for entry in entries}
            assert len(records) == count
            results.append({'workflow': 'candidate_reads', 'candidates': count, 'mode': mode,
                            'sap_calls': sap._request.call_count + sap.get_sales_order.call_count,
                            'elapsed_ms': round((time.perf_counter() - started) * 1000, 2),
                            'note': 'one fixture sample, simulated 2ms RTT, all candidate eligibility preserved'})
    from django.core.cache import cache
    from django.test import override_settings
    from api.services.cache_service import cache_get_or_set
    with override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}):
        for mode in ('legacy', 'single_loader'):
            cache.clear()
            loader = Mock(side_effect=lambda: (time.sleep(.02), {'fixture': True})[1])
            for state in ('cold', 'warm'):
                loader.reset_mock()
                barrier = threading.Barrier(8)
                def get(_):
                    barrier.wait(timeout=3)
                    if mode == 'single_loader':
                        return cache_get_or_set('fixture', 'benchmark-key', loader, 'sap_items')
                    value = cache.get('benchmark-key')
                    if value is None:
                        value = loader()
                        cache.set('benchmark-key', value, 60)
                    return value
                started = time.perf_counter()
                with ThreadPoolExecutor(max_workers=8) as pool:
                    values = list(pool.map(get, range(8)))
                assert values == [{'fixture': True}] * 8
                results.append({'workflow': 'cache_load', 'mode': mode, 'state': state,
                                'concurrent_readers': 8, 'loader_calls': loader.call_count,
                                'elapsed_ms': round((time.perf_counter() - started) * 1000, 2)})
    target = Path(__file__).resolve().parents[1] / 'scratch/performance-before-after.json'
    target.write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    run()
