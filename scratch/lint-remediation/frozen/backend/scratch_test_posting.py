import os
import sys
import json
import django
from datetime import date

sys.path.insert(0, r'c:\Users\hp\Desktop\receipt_from_production\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from django.contrib.auth import get_user_model
from api.models_customization import CustomizationDraft
from api.models_delivery import DeliveryDraft, DeliveryDraftLine, DeliveryDraftBatch
from api.services.customization_service import CustomizationService
from api.services.delivery_posting_service import DeliveryPostingService
from api.services.sap_service import SAPServiceLayer

User = get_user_model()
user = User.objects.filter(is_superuser=True).first() or User.objects.first()

print(f"Testing with user: {user.username}")

# 1. Test Quotation creation payload validation / dry-run test
print("\n--- Testing Quotation Creation Logic ---")
cust_service = CustomizationService()
# Let's inspect what payload it builds for Quotation creation
test_quotation_payload = {
    "CardCode": "CXCRU004",
    "DocDate": date.today().strftime("%Y-%m-%d"),
    "DocDueDate": date.today().strftime("%Y-%m-%d"),
    "Comments": "Dry run verification test",
    "DocumentLines": [
        {
            "ItemCode": "2720100001",
            "Quantity": 1.0,
            "UnitPrice": 10.0,
            "WarehouseCode": "10102"
        }
    ]
}
print("Sample Quotation Payload:", json.dumps(test_quotation_payload, indent=2))

# 2. Test Delivery posting on existing draft (draft 1 or draft for 25800)
print("\n--- Testing Delivery Drafts in DB ---")
drafts = DeliveryDraft.objects.all().order_by('-id')[:5]
for d in drafts:
    print(f"Draft ID={d.id}, OrderDocEntry={d.sales_order_doc_entry}, Status={d.status}, SapError={d.sap_error}")

# Let's inspect draft 1
d1 = DeliveryDraft.objects.first()
if d1:
    print(f"\nInspecting Draft ID {d1.id}:")
    for l in d1.lines.all():
        batches = list(l.batches.all())
        print(f" Line {l.line_number}: item={l.item_code}, deliv_qty={l.delivery_quantity}, whs={l.warehouse_code}, batches={len(batches)}")
        for b in batches:
            print(f"   Batch: {b.batch_number}, qty={b.quantity}, bin_abs={b.bin_abs_entry}, bin_code={b.bin_code}")

    post_service = DeliveryPostingService()
    try:
        payload = post_service.payload_builder.build(d1)
        print("\nBuilt Delivery Note Payload:")
        print(json.dumps(payload, indent=2))
    except Exception as e:
        print("Payload build error:", e)
