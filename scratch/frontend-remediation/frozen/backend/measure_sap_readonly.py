"""Operator-approved live reads. No business writes, SQL definition changes or response data exports.

All outbound HTTP is guarded at requests' transport boundary, including calls
inside views. The only POSTs allowed are Login and one verified, existing SELECT
query's List operation; SAP exposes that read operation over POST.
"""
import contextlib
import io
import json
import logging
import os
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlencode
from unittest.mock import patch

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
import django
from django.conf import settings
settings.PERFORMANCE_METRICS_ENABLED = True
settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
django.setup()
import requests
from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
origin = urlsplit(sap.base_url)
original_request = requests.sessions.Session.request
calls, blocked, measurements, flag_shapes = [], [], [], []
tracking_comparison = None
verified_flag_query = False
FLAG_SQL = 'SELECT T0."ItemCode", T0."ManBtchNum", T0."ManSerNum" FROM "OITM" T0 WHERE T0."ItemCode" = :itemCode'


def guard(session, method, url, **kwargs):
    global verified_flag_query
    target = urlsplit(url)
    resource = target.path[len(origin.path.rstrip('/')):].lstrip('/')
    if ((target.scheme, target.netloc) != (origin.scheme, origin.netloc)
            or not target.path.startswith(origin.path.rstrip('/') + '/')
            or not (method == 'GET' or (method == 'POST' and (resource == 'Login' or
                    (resource == "SQLQueries('Z_OITM_FLAGS_BY_ITEM')/List" and verified_flag_query))))):
        blocked.append({'method': method, 'entity': resource.split('(')[0].split('/')[0],
                        'operation': 'List' if resource.endswith('/List') else 'definition-or-other'})
        raise RuntimeError('Read-only audit blocked an outbound operation')
    if len(calls) >= 160:
        raise RuntimeError('Read-only audit request budget exhausted')
    kwargs['timeout'] = 15
    began = time.perf_counter()
    row = {'method': method, 'entity': resource.split('(')[0].split('/')[0]}
    calls.append(row)
    try:
        response = original_request(session, method, url, **kwargs)
        row['status'] = response.status_code
        if method == 'GET' and resource == "SQLQueries('Z_OITM_FLAGS_BY_ITEM')":
            try:
                verified_flag_query = response.status_code == 200 and response.json().get('SqlText', '').strip() == FLAG_SQL
            except (ValueError, AttributeError):
                verified_flag_query = False
        if resource == 'Items' and 'ManageBatchNumbers' in url:
            try:
                body = response.json()
                for item in body.get('value', []):
                    def shape(value):
                        return value if value in ('tYES', 'tNO', None, True, False) else type(value).__name__
                    flag_shapes.append({key: shape(item.get(key)) for key in ('ManageBatchNumbers', 'ManageSerialNumbers')})
            except (ValueError, AttributeError):
                pass
        return response
    finally:
        row['ms'] = round((time.perf_counter() - began) * 1000, 2)


def measure(label, operation, samples=5):
    rows = []
    result = None
    for _ in range(samples):
        start, count, denied = time.perf_counter(), len(calls), len(blocked)
        try:
            result = operation()
            if isinstance(result, dict):
                ok = not bool(result.get('error'))
                size = len(result['value']) if isinstance(result.get('value'), list) else None
            elif isinstance(result, bool):
                ok, size = result, None
            else:
                ok, size = 200 <= result.status_code < 300, None
            ok = ok and len(blocked) == denied and all(row.get('status', 599) < 400 for row in calls[count:])
            rows.append({'ms': round((time.perf_counter()-start)*1000, 2), 'blocked_operations': len(blocked)-denied,
                         'sap_calls': len(calls)-count, 'success': ok, 'rows': size})
        except Exception as exc:
            rows.append({'ms': round((time.perf_counter()-start)*1000, 2), 'sap_calls': len(calls)-count,
                         'success': False, 'error_type': type(exc).__name__,
                         'error': 'operation failed; response details deliberately excluded'})
            break
        if not ok:
            break
    measurements.append({'label': label, 'samples': rows,
                         'median_ms': round(statistics.median(row['ms'] for row in rows), 2)})
    return result


class Capture(logging.Handler):
    def emit(self, record):
        try:
            metrics.append(json.loads(record.getMessage()))
        except (ValueError, TypeError):
            pass


metrics = []
logger = logging.getLogger('egast.performance')
capture = Capture()
logger.addHandler(capture)
logger.propagate = False
logger.setLevel(logging.INFO)
out = Path(__file__).resolve().parents[1] / 'scratch' / os.getenv('SAP_READONLY_RESULT', 'stability-sap-live-readonly.json')
try:
    with patch.object(requests.sessions.Session, 'request', guard), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        # Authentication timing is reported independently from warm read samples.
        measure('SAP authentication', sap.login, samples=1)
        production = None
        entities = (['ProductionOrders'] if any(arg in sys.argv for arg in ('--endpoints-only', '--tracking-comparison')) else
                    ['Items', 'Warehouses', 'BusinessPartners', 'ProductionOrders', 'Orders',
                     'DeliveryNotes', 'PurchaseOrders', 'PurchaseDeliveryNotes', 'PurchaseQuotations', 'Quotations', 'StockTransfers'])
        for entity in entities:
            data = measure(entity + ' first 5 rows', lambda entity=entity: sap._request('GET', entity + '?' + urlencode({'$top': 5})),
                           samples=1 if any(arg in sys.argv for arg in ('--endpoints-only', '--tracking-comparison')) else 5)
            if entity == 'ProductionOrders' and isinstance(data, dict) and data.get('value'):
                production = data['value'][0].get('AbsoluteEntry')

        if '--tracking-comparison' in sys.argv and production is not None:
            order = sap.get_production_order(production)
            codes = list(dict.fromkeys(str(line.get('ItemNo') or '').strip()
                                      for line in order.get('ProductionOrderLines', []) if line.get('ItemNo')))[:10]
            old = measure('Legacy tracking reads, same live codes',
                          lambda: {code: sap.get_item_tracking_flags(code) for code in codes}, samples=3)
            new = measure('Current bulk tracking reads, same live codes',
                          lambda: sap.get_item_tracking_flags_bulk(codes), samples=3)
            tracking_comparison = {'codes': len(codes), 'equal_flags': old == new,
                                   'sampling': 'First ten distinct codes of the same production order; three repetitions.'}

        from django.contrib.auth.models import User
        from django.db import connection
        from django.urls import resolve
        from rest_framework.test import APIRequestFactory, force_authenticate
        from api.performance import PerformanceMiddleware
        from django.core.cache import cache
        actor = User(username='readonly-diagnostic', is_superuser=True, is_staff=True)

        def sql_readonly(execute, sql, params, many, context):
            if not sql.lstrip().upper().startswith(('SELECT', 'SHOW', 'PRAGMA')):
                raise RuntimeError('Read-only audit blocked database write')
            return execute(sql, params, many, context)

        def endpoint(path):
            request = APIRequestFactory().get(path)
            request.user = actor  # Django permission wrapper precedes DRF authentication on production routes.
            force_authenticate(request, actor)
            match = resolve(request.path)
            request.resolver_match = match
            response = PerformanceMiddleware(lambda req: match.func(req, *match.args, **match.kwargs))(request)
            if hasattr(response, 'render'):
                response.render()
            return response

        paths = [('Warehouse lookup', '/api/warehouses/?lookup=1&initial=1&limit=10'),
                 ('Purchase currency lookup', '/api/currencies/')]
        if production is not None:
            paths.append(('Production order detail and tracking flags', f'/api/production-orders/{production}/'))
        if '--tracking-comparison' in sys.argv:
            paths = []
        with connection.execute_wrapper(sql_readonly):
            for label, path in paths:
                cache.clear()  # Only this process's LocMemCache, never shared operational cache.
                measure(label + ' cold', lambda path=path: endpoint(path), samples=1)
                measure(label + ' warm', lambda path=path: endpoint(path))
finally:
    logger.removeHandler(capture)
    # Never serialize SAP responses, document IDs, query filters or credentials.
    out.write_text(json.dumps({'read_only': True, 'measurements': measurements, 'http': calls,
                               'blocked': blocked, 'tracking_flag_shapes': flag_shapes,
                               'tracking_comparison': tracking_comparison, 'endpoint_metrics': metrics,
                               'limitations': 'Five sequential samples; no production p95, load test or browser render timings.'}, indent=2), encoding='utf-8')
print(json.dumps({'artifact': out.name, 'groups': len(measurements), 'http_calls': len(calls), 'blocked': len(blocked)}))
