"""Historical policy schema remains migratable; removed routes stay absent."""
from django.contrib.auth.models import User
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from rest_framework.test import APIClient


class TransferPolicyMigrationRuntimeTests(TransactionTestCase):
    def test_missing_policy_table_is_fixed_without_resurrecting_removed_api(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(latest))
        executor.migrate([('api', '0058_deliverydraft_cost_center_1_and_more')])
        self.assertNotIn('api_transferpolicyrevision', connection.introspection.table_names())
        actor = User.objects.create_superuser('schema-admin', password='test-only')
        client = APIClient(); client.force_authenticate(actor)
        paths = ('/api/transfer/config/', '/api/transfer/policies/', '/api/transfer/policies/effective/')
        for path in paths:
            self.assertEqual(client.get(path).status_code, 404)
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan([('api', '0059_transfer_policy_revisions')])
        self.assertEqual([(migration.name, backwards) for migration, backwards in plan],
                         [('0059_transfer_policy_revisions', False)])
        executor.migrate([('api', '0059_transfer_policy_revisions')])
        self.assertIn('api_transferpolicyrevision', connection.introspection.table_names())
        from api.models_transfer_policy import TransferPolicyRevision
        self.assertEqual(TransferPolicyRevision.objects.count(), 0)
        for path in paths:
            self.assertEqual(client.get(path).status_code, 404)
