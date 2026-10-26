import os
import sys
import json
import django

sys.path.insert(0, r'c:\Users\hp\Desktop\receipt_from_production\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from django.test import RequestFactory
from django.contrib.auth import get_user_model
from api.customization_views import create_sales_quotation_and_draft
from api.delivery_views import delivery_draft_detail, submit_delivery_draft, approve_delivery_draft, post_delivery_to_sap
from api.models_delivery import DeliveryDraft
from api.services.sap_service import SAPServiceLayer

User = get_user_model()
user = User.objects.filter(is_superuser=True).first() or User.objects.first()
factory = RequestFactory()

print("==================================================")
print("TEST 1: Sales Quotation Creation Button Trace")
print("==================================================")
# In SalesQuotationCreatePage.jsx:
# payload = {
#   customer_code: selectedCustomer.card_code,
#   customer_name: selectedCustomer.card_name,
#   doc_date: docDate,
#   doc_due_date: docDueDate,
#   comments,
#   lines: lines.map(...)
# }
quotation_payload = {
    "customer_code": "CXCRU004",
    "customer_name": "Lenta",
    "doc_date": "2026-09-30",
    "doc_due_date": "2026-09-30",
    "comments": "Test from trace inspection",
    "lines": [
        {
            "item_code": "2720100001",
            "item_description": "Egyptian Fresh Orange - Baladi - Class 1",
            "quantity": 10.0,
            "unit_price": 5.5,
            "warehouse_code": "10102",
            "free_text": "Sample line",
            "u_brand": "BALADI",
            "u_specification": "Class 1",
            "u_packing": "Standard"
        }
    ]
}

# Let's inspect the payload that WOULD be sent to SAP:
sap_lines = []
for line in quotation_payload["lines"]:
    sap_line = {
        "ItemCode": line["item_code"],
        "Quantity": line["quantity"],
        "UnitPrice": line["unit_price"],
        "WarehouseCode": line["warehouse_code"],
        "FreeText": line["free_text"],
        "U_Brand": line["u_brand"],
    }
    sap_lines.append(sap_line)
quotation_sap_payload = {
    "CardCode": quotation_payload["customer_code"],
    "DocDate": quotation_payload["doc_date"],
    "DocDueDate": quotation_payload["doc_due_date"],
    "Comments": quotation_payload["comments"],
    "DocumentLines": sap_lines,
}
print("Constructed SAP Quotations Payload:")
print(json.dumps(quotation_sap_payload, indent=2))

print("\n==================================================")
print("TEST 2: Delivery Post Button Trace")
print("==================================================")
# Check the latest draft for Order 25800
draft = DeliveryDraft.objects.filter(sales_order_doc_entry=25800).order_by('-id').first()
print(f"Target Delivery Draft: ID={draft.id if draft else 'None'}, Status={draft.status if draft else 'None'}")

if draft:
    print(f"Lines count: {draft.lines.count()}")
    for l in draft.lines.all():
        print(f"  Line {l.line_number}: item={l.item_code}, qty={l.delivery_quantity}, whs={l.warehouse_code}, batches={l.batches.count()}")

    # What happens when DeliveryCreateWizardPage.jsx calls:
    # 1. updateDeliveryDraft
    # 2. submitDeliveryDraft
    # 3. approveDeliveryDraft
    # 4. postDeliveryToSap
    print("\nSimulating Delivery Create Wizard payload update from UI state:")
    update_data = {
        "lines": [
            {
                "line_number": 0,
                "delivery_quantity": 500.0,
                "warehouse_code": "10102",
                "batches": [
                    {
                        "batch_number": "206",
                        "quantity": 500.0,
                        "bin_abs_entry": 2,
                        "bin_code": "10102-SYSTEM-BIN-LOCATION"
                    }
                ]
            }
        ],
        "comments": "Testing full Delivery Post trace",
        "doc_date": "2026-09-30",
        "doc_due_date": "2026-09-30",
    }
    req_update = factory.put(f"/api/customization-delivery/delivery/drafts/{draft.id}/", data=json.dumps(update_data), content_type="application/json")
    req_update.user = user
    resp_update = delivery_draft_detail(req_update, draft.id)
    print("1. Update status:", resp_update.status_code, resp_update.data.get("success"), resp_update.data.get("error"))

    draft.refresh_from_db()
    print(f"Draft status after update: {draft.status}")

    req_sub = factory.post(f"/api/customization-delivery/delivery/drafts/{draft.id}/submit/")
    req_sub.user = user
    resp_sub = submit_delivery_draft(req_sub, draft.id)
    print("2. Submit status:", resp_sub.status_code, resp_sub.data.get("success"), resp_sub.data.get("error"))

    draft.refresh_from_db()
    print(f"Draft status after submit: {draft.status}")

    req_app = factory.post(f"/api/customization-delivery/delivery/drafts/{draft.id}/approve/")
    req_app.user = user
    resp_app = approve_delivery_draft(req_app, draft.id)
    print("3. Approve status:", resp_app.status_code, resp_app.data.get("success"), resp_app.data.get("error"))

    draft.refresh_from_db()
    print(f"Draft status after approve: {draft.status}")

    from api.services.delivery_posting_service import DeliveryPostingService
    dps = DeliveryPostingService()
    try:
        sap_payload = dps.payload_builder.build(draft)
        print("\nBuilt Delivery Note SAP Payload:")
        print(json.dumps(sap_payload, indent=2))
    except Exception as e:
        print("Payload build exception:", e)
