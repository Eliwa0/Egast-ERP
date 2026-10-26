import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
sql_code = "UAT_FIND_POTATO_BATCHES"
sql_text = (
    'SELECT TOP 10 '
    'T0."ItemCode", '
    'T0."DistNumber" AS "BatchNumber", '
    'T1."WhsCode", '
    'T3."AbsEntry" AS "BinAbsEntry", '
    'T3."BinCode", '
    'T1."OnHandQty" '
    'FROM "OBTN" T0 '
    'INNER JOIN "OBBQ" T1 ON T1."ItemCode" = T0."ItemCode" AND T1."SnBMDAbs" = T0."AbsEntry" '
    'INNER JOIN "OBIN" T3 ON T3."AbsEntry" = T1."BinAbs" '
    'WHERE T0."ItemCode" = \'1110119001\' AND T1."OnHandQty" > 0 '
    'ORDER BY T1."OnHandQty" DESC'
)

res = sap.ensure_sql_query(sql_code, "UAT Find Potato Batches", sql_text)
rows = sap.execute_sql_query(sql_code)
print("Potato batches in bins count:", len(rows.get("value", [])))
for r in rows.get("value", []):
    print("Batch:", r.get("BatchNumber"), "Whs:", r.get("WhsCode"), "BinAbs:", r.get("BinAbsEntry"), "BinCode:", r.get("BinCode"), "OnHand:", r.get("OnHandQty"))
