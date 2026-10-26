import os
import sys
import django

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

endpoint = "Items?$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,DefaultWarehouse,ItemPrices,UoMGroupEntry&$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO'&$top=50"
res = sap._request('GET', endpoint)
items = res.get('value', [])
print('Count returned:', len(items))
for it in items[:10]:
    prices = it.get('ItemPrices', [])
    p1 = next((p.get('Price') for p in prices if p.get('PriceList') == 1), 0.0)
    print(it.get('ItemCode'), '|', it.get('ItemName'), '| SalesUnit:', it.get('SalesUnit'), '| InvUOM:', it.get('InventoryUOM'), '| PriceList 1:', p1, '| Ugp:', it.get('UoMGroupEntry'))

# Also test search for Carozo or 11101
ep_search = "Items?$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,DefaultWarehouse,ItemPrices,UoMGroupEntry&$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO' and (contains(ItemCode, 'Carozo') or contains(ItemName, 'Carozo'))&$top=20"
res_s = sap._request('GET', ep_search)
print('\nSearch Carozo count:', len(res_s.get('value', [])))
for it in res_s.get('value', []):
    print(it.get('ItemCode'), '|', it.get('ItemName'), '| SalesUnit:', it.get('SalesUnit'))
