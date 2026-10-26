"""Read-only operational metadata and duplicate audit. Never migrate this DB."""
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
import django
django.setup()
from django.db import connection, transaction
from django.db.models import Count
from django.db.migrations.executor import MigrationExecutor
from api.models_delivery import DeliveryDraft

report = {'read_only': True, 'database_vendor': connection.vendor}
assert connection.vendor == 'postgresql', 'Stop: operational database is not PostgreSQL'
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
        cursor.execute('SHOW transaction_read_only')
        report['server_read_only'] = cursor.fetchone()[0]
        cursor.execute('SHOW server_version')
        report['server_version'] = cursor.fetchone()[0]
        cursor.execute("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='api_deliverydraft' AND indexname='delivery_one_active_order'")
        report['delivery_constraint_indexes'] = cursor.fetchall()
    active = DeliveryDraft.objects.filter(status__in=['DRAFT','PENDING_REVIEW','APPROVED','POSTING'])
    report['active_drafts'] = active.count()
    report['duplicate_groups'] = list(active.values('sales_order_doc_entry').annotate(drafts=Count('pk')).filter(drafts__gt=1))
    executor = MigrationExecutor(connection)
    report['api_leaves'] = executor.loader.graph.leaf_nodes('api')
    report['unapplied_plan'] = [{'app': migration.app_label, 'name': migration.name, 'backwards': backwards}
                                for migration, backwards in executor.migration_plan(executor.loader.graph.leaf_nodes())]
    report['applied_api_tail'] = sorted(name for app, name in executor.loader.applied_migrations if app=='api')[-5:]
Path(__file__).with_name('database-readonly.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
