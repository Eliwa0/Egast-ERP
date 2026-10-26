import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

# Query OCTG via SQLQueries
sql = 'SELECT T0."GroupNum", T0."PymntGroup" FROM "OCTG" T0 ORDER BY T0."GroupNum"'
sap.ensure_sql_query("AUDIT_OCTG_V1", "Audit OCTG", sql)
res = sap.execute_sql_query("AUDIT_OCTG_V1")
print("OCTG rows:", res.get('value', []))
