import os
import json
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.models_issue import PendingIssue
from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()

# Check pending issue #6
pi = PendingIssue.objects.get(id=6)
print(f"PendingIssue #6: doc_entry={pi.production_order_doc_entry}, doc_num={pi.production_order_doc_num}")

res = sap._request('GET', f"ProductionOrders({pi.production_order_doc_entry})")
print(f"SAP Order: DocEntry={res.get('AbsoluteEntry')}, DocNum={res.get('DocumentNumber')}, Status={res.get('ProductionOrderStatus')}")
for line in res.get('ProductionOrderLines', []):
    print(f"Line {line.get('LineNumber')}: Item={line.get('ItemNo')}, Planned={line.get('PlannedQuantity')}, Issued={line.get('IssuedQuantity')}, Whs={line.get('Warehouse')}")
