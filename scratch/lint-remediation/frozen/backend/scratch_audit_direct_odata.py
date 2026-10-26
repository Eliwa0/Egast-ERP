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

print("=== 1. WAREHOUSES DIRECT ODATA ===")
whs_res = sap._request('GET', 'Warehouses?$select=WarehouseCode,WarehouseName,Inactive,DropShip&$top=100')
whs_list = whs_res.get('value', [])
print(f"Warehouses count: {len(whs_list)}")
for w in whs_list[:10]:
    print(f"  {w.get('WarehouseCode')} | {w.get('WarehouseName')} | Inactive: {w.get('Inactive')}")

print("\n=== 2. TAX CODES (VatGroups) ===")
vat_res = sap._request('GET', 'VatGroups?$select=Code,Name,Rate,Category,Inactive&$top=100')
vat_list = vat_res.get('value', [])
print(f"VatGroups count: {len(vat_list)}")
for v in vat_list[:10]:
    print(f"  {v.get('Code')} | {v.get('Name')} | Rate: {v.get('Rate')}% | Category: {v.get('Category')} | Inactive: {v.get('Inactive')}")

print("\n=== 3. PROFIT CENTERS (Cost Centers) ===")
pc1_res = sap._request('GET', 'ProfitCenters?$filter=InWhichDimension eq 1 and Active eq \'tYES\'&$select=CenterCode,CenterName,InWhichDimension&$top=100')
pc1_list = pc1_res.get('value', [])
print(f"Dimension 1 ProfitCenters count: {len(pc1_list)}")
for p in pc1_list[:5]:
    print(f"  Dim 1: {p.get('CenterCode')} | {p.get('CenterName')}")

pc2_res = sap._request('GET', 'ProfitCenters?$filter=InWhichDimension eq 2 and Active eq \'tYES\'&$select=CenterCode,CenterName,InWhichDimension&$top=100')
pc2_list = pc2_res.get('value', [])
print(f"Dimension 2 ProfitCenters count: {len(pc2_list)}")
for p in pc2_list[:5]:
    print(f"  Dim 2: {p.get('CenterCode')} | {p.get('CenterName')}")

print("\n=== 4. CUSTOMER GROUPS & SERIES ===")
# Check business partner groups
bp_groups = sap._request('GET', 'BusinessPartnerGroups?$top=20')
print(f"BP Groups count: {len(bp_groups.get('value', []))}")
for g in bp_groups.get('value', [])[:10]:
    print(f"  Code: {g.get('Code')} | Name: {g.get('Name')} | Type: {g.get('Type')}")

print("\n=== 5. ITEMS WITH ITEM GROUPS & SALES ITEM FLAG ===")
# Check items that have SalesItem eq 'tYES'
sales_items_odata = sap._request('GET', "Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES'&$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode&$top=20")
si_list = sales_items_odata.get('value', [])
print(f"Sales Items count returned: {len(si_list)}")
for it in si_list[:10]:
    print(f"  {it.get('ItemCode')} | {it.get('ItemName')} | SalesUnit: {it.get('SalesUnit')} | InvUOM: {it.get('InventoryUOM')} | Group: {it.get('ItemsGroupCode')}")

print("\n=== 6. ITEM GROUPS (ItemGroups) ===")
ig_res = sap._request('GET', 'ItemGroups?$top=50')
ig_list = ig_res.get('value', [])
print(f"Item Groups count: {len(ig_list)}")
for ig in ig_list[:15]:
    print(f"  GroupCode: {ig.get('Number')} | GroupName: {ig.get('GroupName')}")
