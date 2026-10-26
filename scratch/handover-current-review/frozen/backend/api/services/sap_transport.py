"""Per-thread, per-company connection pools; SAP cookies remain explicit.

No automatic retries: retrying a business POST can duplicate a transaction.
"""
import os
import threading
import time
from http.cookiejar import CookiePolicy

import requests

from api.performance import metrics_enabled, record_sap

_local = threading.local()


class _NoStoredCookies(CookiePolicy):
    netscape = True
    rfc2965 = False
    hide_cookie2 = True

    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False

    def domain_return_ok(self, domain, request):
        return False

    def path_return_ok(self, path, request):
        return False


def pooled_request(scope, method, url, **kwargs):
    key = (os.getpid(), scope)
    if getattr(_local, 'key', None) != key:
        old = getattr(_local, 'session', None)
        if old is not None:
            old.close()
        _local.session = requests.Session()
        _local.session.cookies.set_policy(_NoStoredCookies())
        _local.key = key
    started = time.perf_counter()
    response = None
    try:
        response = _local.session.request(method, url, **kwargs)
        return response
    finally:
        elapsed = time.perf_counter() - started
        if metrics_enabled():
            rows = 0
            page = False
            if response is not None:
                try:
                    body = response.json()
                    value = body.get('value') if isinstance(body, dict) else None
                    page = isinstance(value, list)
                    rows = len(value) if page else int(isinstance(body, dict) and bool(body) and not body.get('error')
                                                     and not url.endswith(('/Login', '/Logout')))
                except (ValueError, TypeError):
                    pass
            record_sap(method, url.split('/b1s/')[-1].split('/', 1)[-1], elapsed, rows,
                       response is not None and response.status_code < 400, page=page)
