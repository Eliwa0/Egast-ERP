import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

res = sap._request('GET', "Items('1110119001')?$select=ItemCode,ItemName,SalesUnit,ItemPrices")
print('Item:', res.get('ItemCode'), res.get('ItemName'))
for ip in res.get('ItemPrices', []):
    print(f"  PriceList: {ip.get('PriceList')} | Price: {ip.get('Price')} | Currency: {ip.get('Currency')}")
