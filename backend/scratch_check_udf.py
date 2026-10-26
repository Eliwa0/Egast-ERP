import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
q = sap.get_sales_quotation(11110)
line = q.get('DocumentLines', [])[0]
print("All keys on Quotation DocumentLine:")
for k in sorted(line.keys()):
    if k.startswith('U_') or k.startswith('u_'):
        print(f"UDF: {k} = {line.get(k)}")
