import os
import sys
import django

sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.services.sap_service import SAPServiceLayer
sap = SAPServiceLayer()

bp = sap._request('GET', "BusinessPartners('CXENL012')")
for k in ['CardCode', 'CardName', 'CardType', 'Valid', 'Frozen', 'Currency', 'GroupCode', 'PriceListNum', 'PaymentGroupCode', 'ContactPerson']:
    print(k, ':', bp.get(k))

# Now test what filter matches CXENL012
for filter_str in [
    "CardCode eq 'CXENL012'",
    "CardType eq 'cCustomer' and CardCode eq 'CXENL012'",
    "Valid eq 'tYES' and CardCode eq 'CXENL012'",
    "Frozen eq 'tNO' and CardCode eq 'CXENL012'",
    "contains(CardName, 'Wilko')",
    "contains(CardCode, 'CXENL012')",
]:
    res = sap._request('GET', f"BusinessPartners?$filter={filter_str}&$select=CardCode,CardName")
    print(f"Filter [{filter_str}] -> count={len(res.get('value', []))}")
