"""Compatibility run with optimization switches disabled in memory only.

This is NOT a clean Git checkout. It isolates the changed read/transport/cache
algorithms against current fixtures; all unrelated working-tree code stays put.
"""
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
from django.conf import settings
settings.DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
import django
django.setup()
from django.test.runner import DiscoverRunner


class Runner(DiscoverRunner):
    def build_suite(self, *args, **kwargs):
        from unittest import TestSuite
        suite = super().build_suite(*args, **kwargs)
        def flatten(items):
            for item in items:
                if isinstance(item, TestSuite):
                    yield from flatten(item)
                elif not item.id().startswith('api.tests_performance_improvements.'):
                    yield item
        return TestSuite(flatten(suite))

    def run_suite(self, suite, **kwargs):
        result = super().run_suite(suite, **kwargs)
        report = {'mode': sys.argv[1], 'run': result.testsRun,
                  'failures': [test.id() for test, _ in result.failures],
                  'errors': [test.id() for test, _ in result.errors],
                  'skipped': [test.id() for test, _ in result.skipped]}
        target = Path(__file__).resolve().parents[1] / f'scratch/performance-suite-{sys.argv[1]}.json'
        target.write_text(json.dumps(report, indent=2), encoding='utf-8')
        return result


@contextmanager
def no_guard(key):
    yield


def main():
    from contextlib import ExitStack
    from api.services.sap_service import SAPServiceLayer
    from api.services import workflow_order_reads, cache_service, master_data_search
    import requests
    original = workflow_order_reads.read_candidate_orders
    def legacy_candidates(sap, entries):
        # The old threshold belonged to the view, not to the batch helper itself.
        # Direct tests/callers of the pre-existing helper must keep their semantics.
        if sys._getframe(1).f_code.co_name == '_workflow_orders_response' and len(entries) <= 50:
            return {}
        return original(sap, entries)
    with ExitStack() as stack:
        stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('Live SAP HTTP forbidden')))
        if sys.argv[1] == 'legacy-disabled':
            stack.enter_context(patch.object(SAPServiceLayer, '_http_request', lambda self, method, url, **kw: requests.request(method, url, **kw)))
            stack.enter_context(patch.object(SAPServiceLayer, 'get_item_tracking_flags_bulk', lambda self, codes: {code: self.get_item_tracking_flags(code) for code in codes}))
            stack.enter_context(patch.object(workflow_order_reads, 'read_candidate_orders', legacy_candidates))
            stack.enter_context(patch.object(cache_service, 'cache_load_guard', no_guard))
            stack.enter_context(patch.object(master_data_search, 'cache_load_guard', no_guard))
        return Runner(verbosity=1, interactive=False).run_tests(['api', 'scale'])


if __name__ == '__main__':
    raise SystemExit(bool(main()))
