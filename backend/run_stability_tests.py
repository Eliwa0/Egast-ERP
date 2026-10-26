"""Isolated health runs with a fail-loud network tripwire and per-case results.

--postgres uses a unique test_* database on local PostgreSQL only. Never migrates
the configured operational DB. Credentials are read without printing them.
"""
import json
import os
import sys
import time
import uuid
from pathlib import Path
from unittest.mock import patch
from unittest import TextTestResult

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
from django.conf import settings

postgres = '--postgres' in sys.argv
labels = [value for value in sys.argv[1:] if value != '--postgres'] or ['api', 'scale']
settings.DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
if postgres:
    settings.DATABASES = {'default': {
        'ENGINE': 'django.db.backends.postgresql', 'NAME': 'postgres', 'HOST': '127.0.0.1',
        'PORT': os.getenv('DB_PORT') or '5432', 'USER': os.getenv('DB_USER') or os.getenv('PGUSER') or 'postgres',
        'PASSWORD': os.getenv('DB_PASSWORD') or os.getenv('PGPASSWORD') or '',
        'TEST': {'NAME': 'test_egast_stability_' + uuid.uuid4().hex[:12]},
    }}
settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
import django
django.setup()
from django.test.runner import DiscoverRunner

OUT = Path(__file__).resolve().parents[1] / 'scratch'
NAME = os.getenv('STABILITY_RUN_NAME', 'stability-' + ('postgres' if postgres else 'sqlite'))
attempts = []
active_test = None


def forbid_network(*args, **kwargs):
    # Deliberately do not retain URL, payload, headers or connection credentials.
    method = args[0] if args else kwargs.get('method', 'unknown')
    attempts.append({'test': active_test, 'method': method if method in ('GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS') else 'unknown'})
    raise AssertionError('Unexpected HTTP: supply an explicit scenario-specific SAP fixture')


class Result(TextTestResult):
    cases = []

    def startTest(self, test):
        global active_test
        active_test = test.id()
        self.began = time.perf_counter()
        self.network_start = len(attempts)
        super().startTest(test)

    def stopTest(self, test):
        unexpected = attempts[self.network_start:]
        if unexpected and not any(item[0] is test for item in self.failures + self.errors):
            try:
                raise AssertionError(f'{len(unexpected)} unexpected HTTP attempts were caught inside application code')
            except AssertionError:
                self.addFailure(test, sys.exc_info())
        self.cases.append({'test': test.id(), 'ms': round((time.perf_counter() - self.began) * 1000, 2),
                           'unexpected_http': len(unexpected)})
        super().stopTest(test)


class Runner(DiscoverRunner):
    def get_resultclass(self):
        return Result

    def run_suite(self, suite, **kwargs):
        result = super().run_suite(suite, **kwargs)
        data = {'database': 'postgresql' if postgres else 'sqlite', 'run': result.testsRun,
                'failures': [{'test': test.id(), 'trace': trace} for test, trace in result.failures],
                'errors': [{'test': test.id(), 'trace': trace} for test, trace in result.errors],
                'skipped': [{'test': test.id(), 'reason': reason} for test, reason in result.skipped],
                'unexpected_http': attempts, 'cases': result.cases}
        (OUT / (NAME + '.json')).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        return result


if __name__ == '__main__':
    with patch('requests.sessions.Session.request', side_effect=forbid_network):
        raise SystemExit(bool(Runner(verbosity=1, interactive=False).run_tests(labels)))
