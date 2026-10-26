import os
import sys
import json
import django
from playwright.sync_api import sync_playwright

sys.path.insert(0, r'c:\Users\hp\Desktop\receipt_from_production\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from api.models_delivery import DeliveryDraft
from api.services.delivery_posting_service import DeliveryPostingService

# Clean any existing drafts for Order 25483 so test runs with fresh SAP data
DeliveryDraft.objects.filter(sales_order_doc_entry=25483).delete()

User = get_user_model()
u = User.objects.filter(is_superuser=True).first() or User.objects.first()
session = SessionStore()
session['_auth_user_id'] = str(u.id)
session['_auth_user_backend'] = 'django.contrib.auth.backends.ModelBackend'
session['_auth_user_hash'] = u.get_session_auth_hash()
session.save()
session_key = session.session_key

user_info = {
    "id": u.id,
    "username": u.username,
    "email": u.email,
    "is_superuser": u.is_superuser,
    "role": "admin"
}

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(CHROME_PATH):
    CHROME_PATH = None

print("=== STARTING PLAYWRIGHT BATCH ALLOCATION UX TEST ===")

with sync_playwright() as p:
    launch_args = {"headless": True}
    if CHROME_PATH:
        launch_args["executable_path"] = CHROME_PATH
    browser = p.chromium.launch(**launch_args)
    context = browser.new_context(viewport={"width": 1440, "height": 900})

    context.add_cookies([
        {"name": "sessionid", "value": session_key, "domain": "localhost", "path": "/"},
        {"name": "sessionid", "value": session_key, "domain": "127.0.0.1", "path": "/"},
    ])
    page = context.new_page()

    page.on("console", lambda msg: print(f"[CONSOLE {msg.type}] {msg.text}"))
    page.on("pageerror", lambda err: print(f"[PAGE ERROR] {err}"))

    # Initial load & set localstorage
    page.goto("http://localhost:5173/customization-delivery")
    page.evaluate(f"""() => {{
        localStorage.setItem('user', JSON.stringify({json.dumps(user_info)}));
        localStorage.setItem('role', 'admin');
    }}""")

    # Open wizard for real Sales Order 25483
    print("\nNavigating to /customization-delivery/deliveries/new/25483...")
    page.goto("http://localhost:5173/customization-delivery/deliveries/new/25483")
    page.wait_for_selector(".page-header", timeout=25000)
    print("Wizard loaded.")

    # 1. Step 0 (Order Summary): Wait for next button
    step0_btn = page.locator("button:has-text('المتابعة لتحديد كميات التسليم'), button:has-text('Continue to Quantities')").first
    step0_btn.wait_for(state="visible", timeout=25000)
    print("Step 0 (Order Summary): Clicking Continue to Quantities...")
    step0_btn.click()
    page.wait_for_timeout(1500)

    # 2. Step 1 (Quantities): Set delivery quantity to 100
    print("Step 1 (Quantities): Setting delivery quantity to 100...")
    qty_input = page.locator("input[type='number']").first
    qty_input.wait_for(state="visible", timeout=15000)
    qty_input.fill("100")
    page.wait_for_timeout(500)

    print("Clicking Continue to Batches...")
    step1_btn = page.locator("button:has-text('المتابعة لتخصيص التشغيلات'), button:has-text('Continue to Batches')").first
    step1_btn.click()
    page.wait_for_timeout(2000)

    # 3. Step 2 (Batches): Real Batch Selection
    print("Step 2 (Batches): Selecting real batch from SAP inventory...")
    batch_input = page.locator(".searchable-select input, input.MuiInputBase-input").first
    batch_input.wait_for(state="visible", timeout=15000)
    batch_input.click()
    page.wait_for_timeout(1500)

    # Choose available batch using keyboard down & enter
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)

    # 4. CRITICAL: WITHOUT clicking "Allocate Batch" / "تأكيد التخصيص"!
    print("CRITICAL: Clicking Next to Bins directly WITHOUT clicking 'Allocate Batch'...")
    step2_btn = page.locator("button:has-text('المتابعة لتخصيص مواقع التخزين'), button:has-text('Continue to Bin Locations')").first
    step2_btn.click()
    page.wait_for_timeout(2000)

    # 5. Step 3 (Bins): Check if bin step loaded
    print("Step 3 (Bins): Successfully navigated to Bins!")
    step3_btn = page.locator("button:has-text('المتابعة لمراكز التكلفة'), button:has-text('Continue to Cost Centers')").first
    step3_btn.wait_for(state="visible", timeout=15000)
    step3_btn.click()
    page.wait_for_timeout(2000)

    # 6. Step 4 (Dimensions & Review): Reach review step
    print("Step 4 (Dimensions & Review): Reached Review step!")
    page.wait_for_timeout(1500)

    # Verify that the Post button is visible on the review step
    post_btn = page.locator("button:has-text('ترحيل إذن التسليم إلى SAP'), button:has-text('Post Delivery Note to SAP')").first
    print("Post button visible on Review step:", post_btn.is_visible())

    browser.close()

# 7. Check backend draft and built SAP payload
print("\n=== VERIFYING RESULTING DRAFT & SAP PAYLOAD ===")
draft = DeliveryDraft.objects.filter(sales_order_doc_entry=25483).order_by('-id').first()
if not draft:
    print("ERROR: No draft found for 25483!")
    sys.exit(1)

print(f"Draft ID: {draft.id}, Status: {draft.status}")
lines = list(draft.lines.all())
print(f"Total lines: {len(lines)}")
for l in lines:
    batches = list(l.batches.all())
    print(f"Line {l.line_number}: item={l.item_code}, deliv_qty={l.delivery_quantity}, whs={l.warehouse_code}, batches_count={len(batches)}")
    for b in batches:
        print(f"  Batch: {b.batch_number}, qty={b.quantity}, bin_abs={b.bin_abs_entry}, bin_code={b.bin_code}")

dps = DeliveryPostingService()
payload = dps.payload_builder.build(draft)
print("\nGenerated SAP Service Layer Payload (PREVIEW ONLY - NOT POSTED):")
print(json.dumps(payload, indent=2))

# Verify assertions
doc_lines = payload.get("DocumentLines", [])
assert len(doc_lines) > 0, "No document lines in payload"
line0 = doc_lines[0]
assert line0.get("BaseType") == 17, f"BaseType must be 17, got {line0.get('BaseType')}"
assert line0.get("BaseEntry") == 25483, f"BaseEntry must be 25483, got {line0.get('BaseEntry')}"
assert line0.get("BaseLine") == 0, f"BaseLine must be 0, got {line0.get('BaseLine')}"
assert "BatchNumbers" in line0 and len(line0["BatchNumbers"]) > 0, "BatchNumbers missing or empty"
assert "DocumentLinesBinAllocations" in line0 and len(line0["DocumentLinesBinAllocations"]) > 0, "DocumentLinesBinAllocations missing or empty"

print("\n>>> ALL ASSERTIONS PASSED! FLOW A (SELECT BATCH -> NEXT) FULLY VERIFIED! <<<")
