import os
import sys
import django

sys.path.insert(0, r'c:\Users\hp\Desktop\receipt_from_production\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

orders = [25449, 24160, 25483, 24322, 24337, 25800]
for doc in orders:
    o = sap._request('GET', f'Orders({doc})')
    lines = o.get('DocumentLines', [])
    for l in lines:
        item = l.get('ItemCode')
        whs = l.get('WarehouseCode')
        openQty = l.get('RemainingOpenQuantity')
        endpoint = f"SQLQueries('CD_BATCHES_BY_ITEM')/List?itemCode='{item}'"
        b_res = sap._request('GET', endpoint)
        b_list = b_res.get('value', []) if isinstance(b_res, dict) else []
        print(f"Order {doc}: Line={l.get('LineNum')}, Item={item}, Whs={whs}, OpenQty={openQty}, Batches in SAP={len(b_list)}")
        if b_list:
            for b in b_list[:2]:
                print(f"   Sample Batch: {b.get('BatchNumber')}, OnHand={b.get('OnHandQty')}, Bin={b.get('BinCode')}")
