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

    # ----------------------------------------------------
    # FLOW 1: Test Sales Quotation Wizard: /customization-delivery/quotations/new
    # ----------------------------------------------------
    print("\n==================================================")
    print("FLOW 1: Sales Quotation Wizard - Stepping to Step 5 (Review & Create in SAP)")
    print("==================================================")
    page.goto("http://localhost:5173/customization-delivery/quotations/new")
    page.wait_for_selector(".page-header", timeout=15000)
    print("Quotations New Page loaded.")

    # Step 0: Select Customer
    # Click customer select and choose first customer
    cust_ctrl = page.locator(".searchable-select__control").first
    cust_ctrl.click()
    page.wait_for_timeout(1000)
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)

    # Click Next to Step 1 (Items)
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(1000)
    print("Step 1 (Items): Loaded.")

    # Add item line
    add_item_btn = page.locator("button:has-text('إضافة صنف'), button:has-text('Add Item')").first
    if add_item_btn.is_visible():
        add_item_btn.click()
        page.wait_for_timeout(500)
        # Select item
        item_ctrl = page.locator(".searchable-select__control").first
        item_ctrl.click()
        page.wait_for_timeout(1000)
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)

    # Next to Step 2 (Commercial)
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(500)
    print("Step 2 (Commercial): Loaded.")

    # Next to Step 3 (Specs)
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(500)
    print("Step 3 (Specs): Loaded.")

    # Next to Step 4 (Review)
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(500)
    print("Step 4 (Review): Loaded.")

    # Check the "Confirm & Create in SAP" button on Step 4
    sap_create_btn = page.locator("button:has-text('تأكيد وإنشاء في SAP'), button:has-text('Confirm & Create in SAP')").first
    print("Quotation Create Button visible:", sap_create_btn.is_visible(), "enabled:", sap_create_btn.is_enabled())

    # ----------------------------------------------------
    # FLOW 2: Test Delivery Wizard: /customization-delivery/deliveries/new/25800
    # ----------------------------------------------------
    print("\n==================================================")
    print("FLOW 2: Delivery Wizard - Stepping to Step 4 (Review & Post Delivery)")
    print("==================================================")
    page.goto("http://localhost:5173/customization-delivery/deliveries/new/25800")
    page.wait_for_selector(".page-header", timeout=15000)
    print("Delivery Create Wizard Page loaded.")

    # Step 0 (Order summary) -> Next
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(1000)
    print("Step 1 (Quantities): Loaded.")

    # Step 1 (Quantities) -> Next
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(1000)
    print("Step 2 (Batches): Loaded.")

    # In Step 2: Auto-fill batches
    autofill_btn = page.locator("button:has-text('تخصيص تلقائي للتشغيلات'), button:has-text('Auto-fill batches')").first
    if autofill_btn.is_visible():
        print("Clicking Auto-fill batches button...")
        autofill_btn.click()
        page.wait_for_timeout(1000)

    # Step 2 -> Step 3 (Bins)
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(1000)
    print("Step 3 (Bins): Loaded.")

    # Step 3 -> Step 4 (Dimensions & Review)
    page.locator("button:has-text('التالي'), button:has-text('Next')").first.click()
    page.wait_for_timeout(1000)
    print("Step 4 (Dimensions & Review): Loaded.")

    # Check the final Post button
    post_btn = page.locator("button:has-text('ترحيل إذن التسليم إلى SAP'), button:has-text('Post Delivery Note to SAP')").first
    print("Delivery Post Button visible:", post_btn.is_visible(), "enabled:", post_btn.is_enabled())
    disabled_attr = post_btn.get_attribute("disabled")
    print("Delivery Post Button disabled attr:", disabled_attr)

    browser.close()
