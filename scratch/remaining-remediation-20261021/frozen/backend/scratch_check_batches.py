import os
import sys

backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "receipt_project.settings")

import django
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
sql = 'SELECT T0."ItemCode", T0."ManBtchNum", T0."ManSerNum" FROM "OITM" T0 WHERE T0."ItemCode" = :itemCode'
sap.ensure_sql_query('Z_OITM_FLAGS_BY_ITEM', 'OITM Flags By Item', sql)
res = sap.execute_sql_query('Z_OITM_FLAGS_BY_ITEM', "itemCode='2710100006'")
print('Result for 2710100006:', res.get('value'))
res2 = sap.execute_sql_query('Z_OITM_FLAGS_BY_ITEM', "itemCode='3300040001'")
print('Result for 3300040001:', res2.get('value'))
