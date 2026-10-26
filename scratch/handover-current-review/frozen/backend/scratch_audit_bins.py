import os
import json
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()

res = sap._request('GET', "BinLocations?$filter=Warehouse eq '20204'")
print("BinLocations in 20204:")
for b in res.get('value', []):
    print(f"AbsEntry: {b.get('AbsEntry')}, BinCode: {b.get('BinCode')}, Disabled: {b.get('Disabled')}, SysBin: {b.get('SystemBinLocation') or b.get('SysBin')}")
