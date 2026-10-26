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

print("=" * 60)
print("PART 1: SAP SYSTEM & COMPANY CONTEXT")
print("=" * 60)
admin_info = sap._request('POST', 'CompanyService_GetAdminInfo', {})
if isinstance(admin_info, dict):
    for k in ['CompanyName', 'Version', 'SystemCurrency', 'LocalCurrency', 'Country']:
        print(f"  {k}: {admin_info.get(k)}")

# Check HANA vs SQL and version via direct query or SAP metadata
print("Company DB:", sap.company_db)
print("Base URL:", sap.base_url)

print("\n" + "=" * 60)
print("PART 2: CUSTOMER MASTER DATA AUDIT (OCRD)")
print("=" * 60)
# Query OCRD statistics
sql_cust_stats = '''
SELECT 
    COUNT(*) AS "TotalBP",
    SUM(CASE WHEN T0."CardType" = 'C' THEN 1 ELSE 0 END) AS "TotalCustomers",
    SUM(CASE WHEN T0."CardType" = 'C' AND T0."validFor" = 'Y' THEN 1 ELSE 0 END) AS "ActiveCustomers",
    SUM(CASE WHEN T0."CardType" = 'C' AND (T0."validFor" = 'N' OR T0."frozenFor" = 'Y') THEN 1 ELSE 0 END) AS "InactiveOrFrozenCustomers",
    SUM(CASE WHEN T0."CardType" = 'S' THEN 1 ELSE 0 END) AS "TotalVendors",
    SUM(CASE WHEN T0."CardType" = 'L' THEN 1 ELSE 0 END) AS "TotalLeads"
FROM "OCRD" T0
'''
def run_sql(code, name, sql):
    sap.ensure_sql_query(code, name, sql)
    res = sap.execute_sql_query(code)
    return res.get('value', []) if isinstance(res, dict) else []

cust_stats = run_sql("AUDIT_CUST_STATS_V1", "Audit Customer Stats", sql_cust_stats)
print("Customer Statistics:", cust_stats)

# Query sample active customers with their price list, payment terms, currency
sql_sample_cust = '''
SELECT TOP 10 
    T0."CardCode", T0."CardName", T0."CardType", T0."Currency", 
    T0."ListNum" AS "PriceListNum", T0."GroupNum" AS "PaymentTermsCode", 
    T0."SlpCode" AS "SalesPersonCode", T0."validFor", T0."frozenFor",
    T0."CntctPrsn" AS "ContactPerson"
FROM "OCRD" T0
WHERE T0."CardType" = 'C' AND T0."validFor" = 'Y' AND T0."frozenFor" = 'N'
ORDER BY T0."CardCode"
'''
sample_cust = run_sql("AUDIT_SAMPLE_CUST_V1", "Sample Customers", sql_sample_cust)
print("\nSample Active Customers in SAP:")
for c in (sample_cust or []):
    print(f"  {c.get('CardCode')} | {c.get('CardName')} | Cur: {c.get('Currency')} | PriceList: {c.get('PriceListNum')} | PayTerms: {c.get('PaymentTermsCode')}")

# What does the CURRENT web app customer endpoint return?
curr_cust_ep = "BusinessPartners?$select=CardCode,CardName,CardType,Currency&$filter=CardType eq 'cCustomer'&$orderby=CardName&$top=100"
curr_cust_res = sap._request('GET', curr_cust_ep)
curr_cust_list = curr_cust_res.get('value', [])
print(f"\nCurrent Web App endpoint returns {len(curr_cust_list)} customers (top 100).")
print("First 5 returned by current endpoint:")
for c in curr_cust_list[:5]:
    print(f"  {c.get('CardCode')} | {c.get('CardName')} | {c.get('Currency')}")


print("\n" + "=" * 60)
print("PART 3: ITEM MASTER DATA AUDIT (OITM)")
print("=" * 60)
sql_item_stats = '''
SELECT 
    COUNT(*) AS "TotalItems",
    SUM(CASE WHEN T0."SellItem" = 'Y' THEN 1 ELSE 0 END) AS "TotalSalesItems",
    SUM(CASE WHEN T0."SellItem" = 'Y' AND T0."validFor" = 'Y' AND T0."frozenFor" = 'N' THEN 1 ELSE 0 END) AS "ActiveSalesItems",
    SUM(CASE WHEN T0."PrchseItem" = 'Y' AND T0."SellItem" = 'N' THEN 1 ELSE 0 END) AS "PurchaseOnlyItems",
    SUM(CASE WHEN T0."InvntItem" = 'Y' AND T0."SellItem" = 'N' AND T0."PrchseItem" = 'N' THEN 1 ELSE 0 END) AS "InventoryOnlyItems"
FROM "OITM" T0
'''
item_stats = run_sql("AUDIT_ITEM_STATS_V1", "Audit Item Stats", sql_item_stats)
print("Item Statistics:", item_stats)

# Inspect what the current web app endpoint returns: Items?$top=50
curr_items_ep = "Items?$select=ItemCode,ItemName,InventoryUOM&$top=50"
curr_items_res = sap._request('GET', curr_items_ep)
curr_items_list = curr_items_res.get('value', [])
print(f"\nCurrent Web App endpoint returns {len(curr_items_list)} items.")
print("Sample of first 5 items from current web endpoint:")
for it in curr_items_list[:5]:
    print(f"  {it.get('ItemCode')} | {it.get('ItemName')} | InvUOM: {it.get('InventoryUOM')}")

# Check if those 5 items are actually sellable!
sample_codes = [it.get('ItemCode') for it in curr_items_list[:5] if it.get('ItemCode')]
if sample_codes:
    in_clause = "','".join(sample_codes)
    sql_check_sellable = f'''
    SELECT T0."ItemCode", T0."ItemName", T0."SellItem", T0."PrchseItem", T0."InvntItem", 
           T0."SalUnitMsr", T0."InvntryUom", T0."validFor", T0."frozenFor", T0."ItmsGrpCod"
    FROM "OITM" T0
    WHERE T0."ItemCode" IN ('{in_clause}')
    '''
    check_res = run_sql("AUDIT_CHECK_SELLABLE_V1", "Check Sellable", sql_check_sellable)
    print("\nAre the first 5 web items sellable in SAP?")
    for r in (check_res or []):
        print(f"  {r.get('ItemCode')} | SellItem: {r.get('SellItem')} | PrchseItem: {r.get('PrchseItem')} | SalesUOM: {r.get('SalUnitMsr')} | InvUOM: {r.get('InvntryUom')} | Valid: {r.get('validFor')}")

# Sample of TRUE sellable items in SAP
sql_true_sales_items = '''
SELECT TOP 10 
    T0."ItemCode", T0."ItemName", T0."SellItem", T0."SalUnitMsr", T0."InvntryUom", 
    T0."UgpEntry", T0."validFor", T0."ItmsGrpCod"
FROM "OITM" T0
WHERE T0."SellItem" = 'Y' AND T0."validFor" = 'Y' AND T0."frozenFor" = 'N'
ORDER BY T0."ItemCode"
'''
true_sales = run_sql("AUDIT_TRUE_SALES_ITEMS_V1", "True Sales Items", sql_true_sales_items)
print("\nSample of TRUE Active Sales Items in SAP:")
for it in (true_sales or []):
    print(f"  {it.get('ItemCode')} | {it.get('ItemName')} | SalesUOM: {it.get('SalUnitMsr')} | InvUOM: {it.get('InvntryUom')} | UgpEntry: {it.get('UgpEntry')}")

print("\n" + "=" * 60)
print("PART 4: WAREHOUSES AUDIT (OWHS)")
print("=" * 60)
sql_whs = '''
SELECT T0."WhsCode", T0."WhsName", T0."Inactive", T0."DropShip", T0."Nettable"
FROM "OWHS" T0
ORDER BY T0."WhsCode"
'''
whs_res = run_sql("AUDIT_WHS_V1", "Audit Warehouses", sql_whs)
print(f"Total Warehouses in SAP: {len(whs_res or [])}")
for w in (whs_res or []):
    print(f"  {w.get('WhsCode')} | {w.get('WhsName')} | Inactive: {w.get('Inactive')} | DropShip: {w.get('DropShip')} | Nettable: {w.get('Nettable')}")

print("\n" + "=" * 60)
print("PART 5: PRICE LISTS & COMMERCIAL LOGIC AUDIT (OPLN)")
print("=" * 60)
sql_price_lists = '''
SELECT T0."ListNum", T0."ListName", T0."BASE_NUM", T0."Factor", T0."PrimCurr"
FROM "OPLN" T0
ORDER BY T0."ListNum"
'''
pl_res = run_sql("AUDIT_PRICE_LISTS_V1", "Audit Price Lists", sql_price_lists)
print("Price Lists in SAP:")
for pl in (pl_res or []):
    print(f"  ListNum: {pl.get('ListNum')} | Name: {pl.get('ListName')} | PrimCurr: {pl.get('PrimCurr')}")

print("\n" + "=" * 60)
print("PART 6: UNIT OF MEASURE GROUPS (OUGP, OUOM)")
print("=" * 60)
sql_uom = '''
SELECT TOP 10 T0."UgpEntry", T0."UgpCode", T0."UgpName", T0."BaseUom"
FROM "OUGP" T0
'''
uom_res = run_sql("AUDIT_UOM_V1", "Audit UOM", sql_uom)
print("UoM Groups in SAP:")
for u in (uom_res or []):
    print(f"  UgpEntry: {u.get('UgpEntry')} | UgpCode: {u.get('UgpCode')} | UgpName: {u.get('UgpName')}")

print("\n" + "=" * 60)
print("PART 7: TAX CODES (OVTG)")
print("=" * 60)
sql_tax = '''
SELECT T0."Code", T0."Name", T0."Rate", T0."Category", T0."Inactive"
FROM "OVTG" T0
WHERE T0."Inactive" = 'N'
'''
tax_res = run_sql("AUDIT_TAX_V1", "Audit Tax", sql_tax)
print(f"Active Tax Codes in SAP ({len(tax_res or [])}):")
for t in (tax_res or []):
    print(f"  Code: {t.get('Code')} | Name: {t.get('Name')} | Rate: {t.get('Rate')}% | Category: {t.get('Category')}")

print("\n" + "=" * 60)
print("PART 8: COST CENTERS & DIMENSIONS (OPRC, ODIM)")
print("=" * 60)
sql_dims = '''
SELECT T0."DimCode", T0."DimName", T0."DimActive", T0."DimDesc"
FROM "ODIM" T0
ORDER BY T0."DimCode"
'''
dim_res = run_sql("AUDIT_DIMS_V1", "Audit Dimensions", sql_dims)
print("Dimensions in SAP:")
for d in (dim_res or []):
    print(f"  DimCode: {d.get('DimCode')} | DimName: {d.get('DimName')} | Active: {d.get('DimActive')}")

sql_cc = '''
SELECT TOP 15 T0."PrcCode", T0."PrcName", T0."DimCode", T0."Active"
FROM "OPRC" T0
WHERE T0."Active" = 'Y'
ORDER BY T0."DimCode", T0."PrcCode"
'''
cc_res = run_sql("AUDIT_CC_V1", "Audit Cost Centers", sql_cc)
print("\nSample Active Cost Centers in SAP:")
for cc in (cc_res or []):
    print(f"  Dim: {cc.get('DimCode')} | Code: {cc.get('PrcCode')} | Name: {cc.get('PrcName')}")
