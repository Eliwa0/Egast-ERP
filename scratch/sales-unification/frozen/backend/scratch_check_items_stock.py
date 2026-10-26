import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
sql_code = "UAT_CHECK_ITEMS_STOCK"
sql_text = (
    'SELECT '
    'T0."ItemCode", '
    'T0."ItemName", '
    'T1."WhsCode", '
    'T1."OnHand" '
    'FROM "OITM" T0 '
    'INNER JOIN "OITW" T1 ON T1."ItemCode" = T0."ItemCode" '
    'WHERE T0."ItemCode" IN (\'1110119001\', \'1110201002\', \'1110102001\', \'1110401002\') '
    '  AND T1."OnHand" > 0 '
    'ORDER BY T0."ItemCode", T1."OnHand" DESC'
)

res = sap.ensure_sql_query(sql_code, "Check Items Stock", sql_text)
rows = sap.execute_sql_query(sql_code)
print("Stock count:", len(rows.get("value", [])))
for r in rows.get("value", []):
    print("Item:", r.get("ItemCode"), "Whs:", r.get("WhsCode"), "OnHand:", r.get("OnHand"))
