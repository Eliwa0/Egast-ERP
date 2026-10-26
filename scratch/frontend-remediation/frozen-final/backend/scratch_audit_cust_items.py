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

print("=== 1. CUSTOMERS WITH NAMES & ACTIVE STATUS ===")
# Query customers where CardType eq 'cCustomer', Valid eq 'tYES', CardName ne null, CardName ne ''
ep = "BusinessPartners?$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and CardName ne null and CardName ne ''&$select=CardCode,CardName,Currency,GroupCode,PriceListNum,PaymentGroupCode&$top=50"
res = sap._request('GET', ep)
valid_custs = res.get('value', [])
print(f"Valid customers count in first page: {len(valid_custs)}")
for c in valid_custs[:10]:
    print(f"  {c.get('CardCode')} | {c.get('CardName')} | Cur: {c.get('Currency')} | Group: {c.get('GroupCode')}")

# Specifically check export customers (CardCode starts with CX or GroupCode in 103..108)
ep_export = "BusinessPartners?$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and (startswith(CardCode, 'CX') or GroupCode eq 103 or GroupCode eq 104 or GroupCode eq 105 or GroupCode eq 106 or GroupCode eq 107 or GroupCode eq 108)&$select=CardCode,CardName,Currency,GroupCode&$top=50"
res_export = sap._request('GET', ep_export)
export_custs = res_export.get('value', [])
print(f"\nExport customers count in first page: {len(export_custs)}")
for c in export_custs[:10]:
    print(f"  {c.get('CardCode')} | {c.get('CardName')} | Cur: {c.get('Currency')} | Group: {c.get('GroupCode')}")

print("\n=== 2. FINISHED GOODS / EXPORT PRODUCE ITEMS ===")
# Check finished goods items (GroupCode 104 is 11101-بطاطس تصدير, 219 is 11107 عنب تصدير, etc.)
ep_fg = "Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and (ItemsGroupCode eq 104 or ItemsGroupCode eq 219 or startswith(ItemCode, '11101'))&$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode&$top=50"
res_fg = sap._request('GET', ep_fg)
fg_items = res_fg.get('value', [])
print(f"Finished Goods items returned: {len(fg_items)}")
for it in fg_items[:15]:
    print(f"  {it.get('ItemCode')} | {it.get('ItemName')} | SalesUnit: {it.get('SalesUnit')} | InvUOM: {it.get('InventoryUOM')} | Group: {it.get('ItemsGroupCode')}")
