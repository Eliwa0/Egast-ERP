import os
import sys
import django

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

endpoint = "Items?$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,DefaultWarehouse,ItemPrices,UoMGroupEntry&$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO'&$orderby=ItemCode asc&$top=20"
res = sap._request('GET', endpoint)
items = res.get('value', [])
print('Count returned with orderby ItemCode:', len(items))
for it in items[:10]:
    print(' ', it.get('ItemCode'), '|', it.get('ItemName'), '| SalesUnit:', it.get('SalesUnit'))
