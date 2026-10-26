import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

res = sap._request('GET', "BusinessPartners('CXENL012')?$select=CardCode,CardName,PayTermsGrpCode,PriceListNum,Currency,ContactPerson,ContactEmployees")
print('Card:', res.get('CardCode'), res.get('CardName'))
print('PayTermsGrpCode:', res.get('PayTermsGrpCode'))
print('PriceListNum:', res.get('PriceListNum'))
print('Currency:', res.get('Currency'))
print('ContactPerson:', res.get('ContactPerson'))
print('ContactEmployees:', len(res.get('ContactEmployees', [])))
