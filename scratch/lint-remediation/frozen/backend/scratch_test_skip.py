import os
import sys
import django

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

res = sap._request('GET', "BusinessPartners?$select=CardCode,CardName&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO'&$orderby=CardCode asc&$skip=10&$top=5")
print('Skip 10, top 5 count:', len(res.get('value', [])))
for c in res.get('value', []):
    print(' ', c.get('CardCode'), c.get('CardName'))
