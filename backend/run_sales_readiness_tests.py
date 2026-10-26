"""Run readiness fixtures in isolated SQLite, never the configured operational DB."""
import os
import sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
from django.conf import settings
settings.DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
import django
django.setup()
from django.core.management import call_command
from unittest.mock import patch
with patch('requests.sessions.Session.request', side_effect=AssertionError('Live SAP HTTP is forbidden in readiness fixtures')):
    call_command('test', *sys.argv[1:], verbosity=1, interactive=False)
