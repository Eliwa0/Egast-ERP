"""DDL/reversal rehearsal exclusively on a newly-created local test database."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import uuid
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
from django.conf import settings
_configured_database = settings.DATABASES  # Load project .env before reading credential environment variables.
settings.DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'postgres',
    'HOST': '127.0.0.1', 'PORT': os.getenv('DB_PORT','5432'), 'USER': os.getenv('DB_USER','postgres'),
    'PASSWORD': os.getenv('DB_PASSWORD',''), 'TEST': {'NAME': 'test_predeploy_' + uuid.uuid4().hex[:12]}}}
settings.CACHES = {'default': {'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}}
import django
django.setup()
from django.core.management import call_command
from django.db import connection, transaction, IntegrityError
from django.db.migrations.executor import MigrationExecutor

OUT = Path(__file__).resolve().parent
steps = []
created = False

def migrate(name):
    executor = MigrationExecutor(connection)
    executor.migrate([('api',name)])
    return executor.loader.project_state([('api',name)]).apps

try:
    with patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden in migration rehearsal')):
        connection.creation.create_test_db(verbosity=0, autoclobber=False, serialize=False)
        created = True
        assert connection.settings_dict['NAME'].startswith('test_predeploy_')
        apps = migrate('0064_quality_grade_category')
        Draft = apps.get_model('api','DeliveryDraft')
        values = dict(sales_order_doc_entry=77, sales_order_doc_num='FIXTURE', customer_code='FIXTURE',
                      doc_date='2026-10-20', doc_due_date='2026-10-20')
        first = Draft.objects.create(**values,status='DRAFT')
        second = Draft.objects.create(**values,status='PENDING_REVIEW')
        try:
            migrate('0065_delivery_one_active_order')
        except IntegrityError:
            assert Draft.objects.count()==2
            with connection.cursor() as c:
                c.execute("SELECT COUNT(*) FROM django_migrations WHERE app='api' AND name='0065_delivery_one_active_order'")
                assert c.fetchone()[0]==0
            steps.append('duplicate data blocks 0065 atomically; both rows preserved')
        else:
            raise AssertionError('Duplicate active drafts unexpectedly accepted')
        # Resolve only deliberately-created rehearsal rows, never operational data.
        second.status='REJECTED';second.save(update_fields=['status'])
        migrate('0066_alter_transferwarehouserule_stage')
        try:
            with transaction.atomic():
                Draft.objects.create(**values,status='APPROVED')
        except IntegrityError:
            steps.append('0065 prevents duplicate active insertion on PostgreSQL')
        else:
            raise AssertionError('Active uniqueness absent')
        expected = list(Draft.objects.order_by('pk').values('id','status','sales_order_doc_entry'))
        migrate('0064_quality_grade_category')
        assert list(Draft.objects.order_by('pk').values('id','status','sales_order_doc_entry'))==expected
        with connection.cursor() as c:
            c.execute("SELECT COUNT(*) FROM pg_indexes WHERE indexname='delivery_one_active_order'")
            assert c.fetchone()[0]==0
        steps.append('0066 then 0065 reverse to 0064; all rehearsal rows/statuses unchanged')
        migrate('0066_alter_transferwarehouserule_stage')
        assert list(Draft.objects.order_by('pk').values('id','status','sales_order_doc_entry'))==expected
        steps.append('0065 then 0066 reapply; rows unchanged')
        for name in ['0065_delivery_one_active_order','0066_alter_transferwarehouserule_stage']:
            for backwards in [False,True]:
                buf=io.StringIO()
                call_command('sqlmigrate','api',name,backwards=backwards,stdout=buf)
                (OUT/(name+('-reverse' if backwards else '')+'.sql')).write_text(buf.getvalue(),encoding='utf-8')
        call_command('makemigrations',check=True,dry_run=True,interactive=False,stdout=io.StringIO())
        steps.append('makemigrations --check --dry-run: no changes')
finally:
    if created:
        connection.creation.destroy_test_db('postgres',verbosity=0)
    (OUT/'migration-rehearsal.json').write_text(json.dumps({'steps':steps,'isolated_test_database':True,
        'operational_migrations_applied':False,'test_database_destroyed':created},indent=2),encoding='utf-8')
print(json.dumps({'passed_steps':len(steps),'isolated_test_database':True}))
