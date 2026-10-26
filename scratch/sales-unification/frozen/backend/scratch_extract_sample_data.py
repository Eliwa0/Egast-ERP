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

print("=== 5 REAL SAP NATIVE CUSTOMERS ===")
# Fetch 5 active export / sales customers that native SAP accepts
ep_c = "BusinessPartners?$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and (startswith(CardCode, 'CX') or startswith(CardCode, '1111'))&$select=CardCode,CardName,Currency,PriceListNum,PaymentGroupCode,ContactPerson&$top=5"
res_c = sap._request('GET', ep_c)
for c in res_c.get('value', []):
    print(json.dumps(c, ensure_ascii=False))

print("\n=== 5 REAL SAP NATIVE SALES ITEMS ===")
# Fetch 5 active export produce items
ep_i = "Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and ItemsGroupCode eq 104&$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,DefaultWarehouse,ItemPrices&$top=5"
res_i = sap._request('GET', ep_i)
for it in res_i.get('value', []):
    prices = it.get('ItemPrices', [])
    p0 = prices[0] if prices else {}
    print(f"Code: {it.get('ItemCode')} | Name: {it.get('ItemName')} | SalesUnit: {it.get('SalesUnit')} | InvUOM: {it.get('InventoryUOM')} | Whs: {it.get('DefaultWarehouse')} | Price(List {p0.get('PriceList')}): {p0.get('Price')} {p0.get('Currency')}")

print("\n=== 5 ACTIVE WAREHOUSES ===")
ep_w = "Warehouses?$filter=Inactive eq 'tNO'&$select=WarehouseCode,WarehouseName,DropShip,Nettable&$top=5"
res_w = sap._request('GET', ep_w)
for w in res_w.get('value', []):
    print(f"Code: {w.get('WarehouseCode')} | Name: {w.get('WarehouseName')} | DropShip: {w.get('DropShip')} | Nettable: {w.get('Nettable')}")

print("\n=== COST CENTERS DIM 1 & 2 ===")
ep_cc1 = "ProfitCenters?$filter=InWhichDimension eq 1 and Active eq 'tYES'&$select=CenterCode,CenterName&$top=3"
res_cc1 = sap._request('GET', ep_cc1)
print("Dim 1:", res_cc1.get('value', []))

ep_cc2 = "ProfitCenters?$filter=InWhichDimension eq 2 and Active eq 'tYES'&$select=CenterCode,CenterName&$top=3"
res_cc2 = sap._request('GET', ep_cc2)
print("Dim 2:", res_cc2.get('value', []))
