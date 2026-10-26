import os
import sys
import django
import json

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()

# 1. Look for existing native quotations
print("=== 1. SEARCHING FOR NATIVE QUOTATIONS ===")
q11114 = sap._request('GET', 'Quotations(11114)')

native_quotations = []
# Let's search descending from 11113 downwards to find 2-3 native quotations
for doc_entry in range(11113, 11090, -1):
    res = sap._request('GET', f'Quotations({doc_entry})')
    if isinstance(res, dict) and 'DocEntry' in res and not res.get('error'):
        native_quotations.append(res)
        if len(native_quotations) >= 3:
            break

print(f"Found {len(native_quotations)} native quotations.")
for nq in native_quotations:
    print(f"Native DocEntry={nq.get('DocEntry')}, DocNum={nq.get('DocNum')}, CardCode={nq.get('CardCode')}, CardName={nq.get('CardName')}, DocTotal={nq.get('DocTotal')}, DocCur={nq.get('DocCur')}")

# If none found between 11113 and 11090, try SQL query on OQUT
if not native_quotations:
    print("Searching via SQL query on OQUT...")
    sql_text = 'SELECT TOP 5 T0."DocEntry", T0."DocNum", T0."CardCode", T0."CardName", T0."DocDate", T0."DocDueDate", T0."DocCur", T0."DocTotal" FROM "OQUT" T0 ORDER BY T0."DocEntry" DESC'
    res = sap.execute_custom_sql("AUDIT_OQUT_TOP5", "Audit OQUT", sql_text)
    print("OQUT Top 5:", res)
    if isinstance(res, list) and len(res) > 1:
        # fetch the second one (first is 11114)
        for row in res[:3]:
            de = row.get("DocEntry")
            full_q = sap._request('GET', f'Quotations({de})')
            if isinstance(full_q, dict) and 'DocEntry' in full_q:
                native_quotations.append(full_q)

# Compare fields
print("\n=== 2. DETAILED COMPARISON OF QUOTATION HEADER ===")
header_keys = [
    'DocEntry', 'DocNum', 'CardCode', 'CardName', 'CardType', 'DocDate', 'DocDueDate', 'TaxDate',
    'DocCur', 'DocRate', 'DocTotal', 'DocTotalSys', 'DocTotalFC',
    'PriceListNum', 'SalesPersonCode', 'PaymentGroupCode', 'ContactPersonCode',
    'Address', 'Address2', 'ShipToCode', 'PayToCode',
    'Comments', 'JournalMemo', 'U_AppSource', 'U_AppUser'
]

print("--- Web Created Quotation (DocEntry 11114) ---")
for k in header_keys:
    print(f"  {k}: {q11114.get(k)}")

if native_quotations:
    nq = native_quotations[0]
    print(f"\n--- Native Quotation (DocEntry {nq.get('DocEntry')}) ---")
    for k in header_keys:
        print(f"  {k}: {nq.get(k)}")

print("\n=== 3. DETAILED COMPARISON OF DOCUMENT LINE 0 ===")
line_keys = [
    'LineNum', 'ItemCode', 'ItemDescription', 'Quantity', 'Price', 'UnitPrice', 'PriceAfterVAT',
    'Currency', 'Rate', 'DiscountPercent', 'WarehouseCode', 'TaxCode', 'TaxPercentagePerRow',
    'CostingCode', 'CostingCode2', 'CostingCode3', 'CostingCode4', 'CostingCode5',
    'MeasureUnit', 'UnitsOfMeasurment', 'UoMCode', 'UoMEntry', 'InventoryQuantity',
    'BaseType', 'BaseEntry', 'BaseLine',
    'U_Brand', 'U_size', 'U_Pallets', 'FreeText'
]

l0 = q11114.get('DocumentLines', [{}])[0]
print("--- Web Line 0 ---")
for k in line_keys:
    print(f"  {k}: {l0.get(k)}")

if native_quotations:
    nl0 = native_quotations[0].get('DocumentLines', [{}])[0]
    print(f"\n--- Native Line 0 (from DocEntry {native_quotations[0].get('DocEntry')}) ---")
    for k in line_keys:
        print(f"  {k}: {nl0.get(k)}")
