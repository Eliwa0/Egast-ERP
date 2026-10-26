import os
import sys
import django

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

endpoint = "BusinessPartners?$select=CardCode,CardName,CardType,Currency,PriceListNum,PayTermsGrpCode,ContactPerson,ContactEmployees&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO'&$orderby=CardCode asc&$top=20"
res = sap._request('GET', endpoint)
custs = res.get('value', [])
print('Count returned with orderby CardCode:', len(custs))
for c in custs[:10]:
    print(' ', c.get('CardCode'), '|', c.get('CardName'), '| Cur:', c.get('Currency'))
