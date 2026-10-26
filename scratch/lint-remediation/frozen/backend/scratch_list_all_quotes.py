import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
quotes = sap.get_sales_quotations(document_status='bost_Open', top=30)
print('Total open quotes found:', len(quotes.get('value', [])))
for q in quotes.get('value', []):
    de = q.get('DocEntry')
    dn = q.get('DocNum')
    card = q.get('CardCode')
    detail = sap.get_sales_quotation(de)
    lines = detail.get('DocumentLines', [])
    items = [f"{l.get('ItemCode')} (Qty:{l.get('Quantity')}, Whs:{l.get('WarehouseCode')})" for l in lines]
    print(f"DocEntry: {de}, DocNum: {dn}, Card: {card}, Lines: {', '.join(items)}")
