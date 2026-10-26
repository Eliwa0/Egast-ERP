import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
res = sap._request('GET', 'BatchNumbers?$top=5')
print('BatchNumbers count:', len(res.get('value', [])))
for b in res.get('value', []):
    print(b.get('ItemCode'), b.get('BatchNumber'), b.get('Quantity'), b.get('WarehouseCode'))
