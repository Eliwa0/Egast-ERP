import os
import sys
import json
import django

sys.path.insert(0, r'c:\Users\hp\Desktop\receipt_from_production\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

print('=== 1. BusinessPartners (Customer) ===')
r = sap._request("GET", "BusinessPartners?$filter=CardType eq 'cCustomer'&$top=2&$select=CardCode,CardName,Currency")
print("Response:", json.dumps(r, indent=2))

print('\n=== 2. Items ===')
r = sap._request("GET", "Items?$top=2&$select=ItemCode,ItemName,InventoryUOM")
print("Response:", json.dumps(r, indent=2))

print('\n=== 3. Warehouses ===')
r = sap._request("GET", "Warehouses?$top=3&$select=WarehouseCode,WarehouseName")
print("Response:", json.dumps(r, indent=2))

print('\n=== 4. ProfitCenters Dim 1 (Location) ===')
r1 = sap._request("GET", "ProfitCenters?$filter=InWhichDimension eq 1&$top=2&$select=CenterCode,CenterName,InWhichDimension")
print("Response:", json.dumps(r1, indent=2))

print('\n=== 5. ProfitCenters Dim 2 (General) ===')
r2 = sap._request("GET", "ProfitCenters?$filter=InWhichDimension eq 2&$top=2&$select=CenterCode,CenterName,InWhichDimension")
print("Response:", json.dumps(r2, indent=2))

print('\n=== 6 & 7. Batch & Bin (Item 2720100001, Whs 10102, Batch 206) ===')
r_batch = sap._request("GET", "SQLQueries('CD_BATCHES_BY_ITEM')/List?itemCode='2720100001'")
val = r_batch.get('value', [])
print(f"Total batches returned for item 2720100001: {len(val)}")
match_206 = [b for b in val if str(b.get('BatchNumber')) == '206']
print("Filtered Batch 206 details from SAP:")
print(json.dumps(match_206, indent=2))

print('\n=== Direct Bin Check in Warehouses / BinLocations ===')
r_bin = sap._request("GET", "BinLocations?$filter=Warehouse eq '10102'&$top=3&$select=AbsEntry,BinCode,Warehouse")
print("Bin details for Whs 10102 from SAP:")
print(json.dumps(r_bin, indent=2))
