import os
import sys
import django
import json

sys.path.append(os.getcwd())
sys.stdout.reconfigure(encoding='utf-8')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

# Test searching customers with search term 'CX'
ep = "BusinessPartners?$select=CardCode,CardName,CardType,Currency,PriceListNum,PaymentGroupCode,ContactPerson&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO' and (contains(CardCode, 'CX') or contains(CardName, 'CX'))&$top=20"
res = sap._request('GET', ep)
print('CX search count:', len(res.get('value', [])))
for c in res.get('value', [])[:5]:
    print(' ', c.get('CardCode'), '|', c.get('CardName'), '|', c.get('Currency'), '| PriceList:', c.get('PriceListNum'), '| PayTerms:', c.get('PaymentGroupCode'), '| Contact:', c.get('ContactPerson'))

# Test searching with 'Wilko'
ep2 = "BusinessPartners?$select=CardCode,CardName,CardType,Currency,PriceListNum,PaymentGroupCode,ContactPerson&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and Frozen eq 'tNO' and (contains(CardCode, 'Wilko') or contains(CardName, 'Wilko'))&$top=20"
res2 = sap._request('GET', ep2)
print('Wilko search count:', len(res2.get('value', [])))
for c in res2.get('value', []):
    print(' ', c.get('CardCode'), '|', c.get('CardName'))

# Test fetching ContactEmployees for Wilko (CXENL012)
ep_ce = "BusinessPartners('CXENL012')?$select=CardCode,CardName,ContactEmployees,ContactPerson"
res_ce = sap._request('GET', ep_ce)
print('ContactPerson:', res_ce.get('ContactPerson'))
for ce in res_ce.get('ContactEmployees', []):
    print('  ContactEmployee:', ce.get('InternalCode'), '|', ce.get('Name'), '|', ce.get('FirstName'), '|', ce.get('E_Mail'))

# Test Item search: 'Carozo' and '11101'
ep_it = "Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO' and (contains(ItemCode, 'Carozo') or contains(ItemName, 'Carozo'))&$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,ItemPrices&$top=20"
res_it = sap._request('GET', ep_it)
print('\nCarozo search count:', len(res_it.get('value', [])))
for it in res_it.get('value', []):
    print(' ', it.get('ItemCode'), '|', it.get('ItemName'), '| SalesUnit:', it.get('SalesUnit'), '| InvUOM:', it.get('InventoryUOM'))

ep_it2 = "Items?$filter=SalesItem eq 'tYES' and Valid eq 'tYES' and Frozen eq 'tNO' and (contains(ItemCode, '1110119001') or contains(ItemName, '1110119001'))&$select=ItemCode,ItemName,SalesUnit,InventoryUOM,ItemsGroupCode,ItemPrices&$top=20"
res_it2 = sap._request('GET', ep_it2)
print('\n1110119001 search count:', len(res_it2.get('value', [])))
for it in res_it2.get('value', []):
    print(' ', it.get('ItemCode'), '|', it.get('ItemName'), '| SalesUnit:', it.get('SalesUnit'), '| InvUOM:', it.get('InventoryUOM'))
