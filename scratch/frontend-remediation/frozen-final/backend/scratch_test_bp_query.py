import os
import sys
import django

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

endpoint = "BusinessPartners?$select=CardCode,CardName,CardType,Currency,PriceListNum,PayTermsGrpCode,ContactPerson,ContactEmployees&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO'&$top=50"
res = sap._request('GET', endpoint)
print('Count returned:', len(res.get('value', [])))
for c in res.get('value', [])[:10]:
    ces = c.get('ContactEmployees', [])
    print(c.get('CardCode'), '|', c.get('CardName'), '| Cur:', c.get('Currency'), '| PList:', c.get('PriceListNum'), '| PayTerms:', c.get('PayTermsGrpCode'), '| CEs:', len(ces))
