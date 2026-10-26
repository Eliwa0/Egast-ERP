"""Request-scoped counts/timings. Never collect SQL, URLs, bodies or identities."""
import json
import logging
import re
import time
import uuid
from contextlib import ExitStack
from contextvars import ContextVar

from django.conf import settings
from django.db import connections

_current = ContextVar('egast_performance', default=None)
logger = logging.getLogger('egast.performance')
_request_id = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')


def record_sap(method, endpoint, elapsed, records=0, success=True, page=False):
    metrics = _current.get()
    if metrics is None:
        return
    # The entity comes from a fixed SAP resource, never its key/filter arguments.
    entity = re.split(r"[?(]", endpoint.rsplit('/b1s/', 1)[-1])[0].split('/')[-1]
    if not re.fullmatch(r'[A-Za-z_]{1,64}', entity):
        entity = 'other'
    metrics['sap_requests'] += 1
    metrics['sap_ms'] += elapsed * 1000
    metrics['sap_records'] += records
    metrics['sap_pages'] += int(page)
    metrics['sap_errors'] += int(not success)
    # Bound per-request memory even for an unexpectedly huge continuation chain.
    if len(metrics['sap_calls']) < 100:
        metrics['sap_calls'].append({'entity': entity, 'method': method, 'ms': round(elapsed * 1000, 2), 'rows': records})


def metrics_enabled():
    return _current.get() is not None


def record_cache(event):
    metrics = _current.get()
    if metrics is not None:
        metrics['cache_' + event] = metrics.get('cache_' + event, 0) + 1


class PerformanceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get('X-Request-ID', '')
        correlation = supplied if _request_id.fullmatch(supplied) else uuid.uuid4().hex
        request.performance_id = correlation
        if not getattr(settings, 'PERFORMANCE_METRICS_ENABLED', False):
            response = self.get_response(request)
            response['X-Request-ID'] = correlation
            return response
        metrics = dict(request_id=correlation, sap_requests=0, sap_ms=0., sap_records=0,
                       sap_pages=0, sap_errors=0, sap_calls=[], db_queries=0, db_ms=0.,
                       cache_hit=0, cache_miss=0, cache_loader=0, cache_wait=0)
        token = _current.set(metrics)
        start = time.perf_counter()
        def measure_query(execute, sql, params, many, context):
            began = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                metrics['db_queries'] += 1
                metrics['db_ms'] += (time.perf_counter() - began) * 1000
        try:
            with ExitStack() as stack:
                for connection in connections.all():
                    stack.enter_context(connection.execute_wrapper(measure_query))
                response = self.get_response(request)
            total = (time.perf_counter() - start) * 1000
            metrics.update(total_ms=round(total, 2), status=response.status_code,
                           route=getattr(getattr(request, 'resolver_match', None), 'route', 'unresolved'))
            # Residual wall time includes Python, cache/network waits and middleware;
            # it is not CPU time. SAP/DB currently execute sequentially in this thread.
            metrics['django_other_ms'] = round(max(0., total - metrics['sap_ms'] - metrics['db_ms']), 2)
            for name in ('sap_ms', 'db_ms'):
                metrics[name] = round(metrics[name], 2)
            response['X-Request-ID'] = correlation
            response['Server-Timing'] = f"total;dur={total:.2f}, sap;dur={metrics['sap_ms']:.2f}, db;dur={metrics['db_ms']:.2f}"
            logger.info(json.dumps(metrics, separators=(',', ':')))
            return response
        finally:
            _current.reset(token)
