"""Regression tests on an isolated SQLite database; forbid live SAP HTTP."""
import os
import sys
from pathlib import Path
from unittest.mock import patch

# Django's normal test progress uses stderr. Route it to stdout so PowerShell
# does not turn successful progress messages into NativeCommandError records.
sys.stderr = sys.stdout

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
from django.conf import settings
settings.DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
import django
django.setup()
from django.test.runner import DiscoverRunner

modules = sys.argv[1:] or [
    'api.tests_master_data_search', 'api.tests_persisted_transfer_policy',
    'api.tests_transfer_policy', 'api.tests_cost_centers_cache',
    'api.tests_production_issue', 'api.tests_module_permissions',
    'api.tests_delivery_workflow', 'api.tests_customization_workflow',
    'api.tests_customization_delivery', 'scale.tests',
]
with patch('requests.sessions.Session.request', side_effect=AssertionError('Live SAP HTTP is forbidden in regression tests')):
    failures = DiscoverRunner(verbosity=2, interactive=False).run_tests(modules)
sys.exit(bool(failures))
