import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
item1 = sap._request('GET', "Items('1110119001')?$select=ItemCode,ItemName,ManageBatchNumbers,InventoryItem,SalesItem")
print('1110119001:', item1)
