import os
import sys
import json
import django

sys.path.insert(0, r'c:\Users\hp\Desktop\receipt_from_production\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

res = sap._request('GET', "Orders?$filter=DocumentStatus eq 'bost_Open'&$top=5&$select=DocEntry,DocNum,CardCode,CardName,DocumentStatus")
print("Open Orders in SAP:")
for o in res.get('value', []):
    print(f"DocEntry={o.get('DocEntry')}, DocNum={o.get('DocNum')}, CardCode={o.get('CardCode')}, Status={o.get('DocumentStatus')}")
