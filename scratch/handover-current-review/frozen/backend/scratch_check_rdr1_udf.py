import os, sys, django
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer

sap = SAPServiceLayer()
order_res = sap._request('GET', 'Orders?$top=1')
lines = order_res.get('value', [{}])[0].get('DocumentLines', [])
if lines:
    print("RDR1 UDFs:")
    for k in sorted(lines[0].keys()):
        if k.startswith('U_') or k.startswith('u_'):
            print(k, '=', lines[0].get(k))
