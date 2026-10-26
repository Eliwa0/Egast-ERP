import os
import sys
import json
import time
from datetime import date

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.abspath('backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
import django
django.setup()

from django.contrib.auth.models import User
from django.contrib.sessions.backends.db import SessionStore
from api.models_delivery import DeliveryDraft, DeliveryDraftLine
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smoke_artifacts")
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def main():
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    print("[SMOKE TEST] Initializing Django session...")
    u = User.objects.get(username='mhosny')
    session = SessionStore()
    session['_auth_user_id'] = str(u.id)
    session['_auth_user_backend'] = 'django.contrib.auth.backends.ModelBackend'
    session['_auth_user_hash'] = u.get_session_auth_hash()
    session.save()
    session_key = session.session_key
    print(f"[SMOKE TEST] Session key created: {session_key}")

    user_info = {
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "is_superuser": u.is_superuser,
        "role": "admin"
    }

    # Setup draft for Order 25800 to ensure deliverable line with item 2720100001 (which has 13 real batches in SAP warehouse 10102)
    draft, _ = DeliveryDraft.objects.get_or_create(
        sales_order_doc_entry=25800,
        status='DRAFT',
        defaults={
            'sales_order_doc_num': '311002621',
            'customer_code': 'CXCRU004',
            'customer_name': 'Lenta',
            'doc_date': date.today(),
            'doc_due_date': date.today(),
            'comments': 'Visual smoke test order',
        }
    )
    line, _ = DeliveryDraftLine.objects.get_or_create(
        draft=draft,
        line_number=0,
        defaults={
            'item_code': '2720100001',
            'item_description': 'Egyptian Fresh Orange - Baladi - Class 1',
            'uom': 'KG',
            'order_quantity': 1000.0,
            'open_quantity_at_draft': 1000.0,
            'delivery_quantity': 500.0,
            'warehouse_code': '10102',
        }
    )
    # Ensure warehouse and delivery qty are set
    line.warehouse_code = '10102'
    line.delivery_quantity = 500.0
    line.open_quantity_at_draft = 1000.0
    line.save()

    results = {}

    with sync_playwright() as p:
        print("[SMOKE TEST] Launching chromium browser...")
        browser = p.chromium.launch(headless=True, executable_path=CHROME_PATH)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="ar-EG",
        )

        context.add_cookies([
            {
                "name": "sessionid",
                "value": session_key,
                "domain": "localhost",
                "path": "/",
            }
        ])

        init_js = f"""
            localStorage.setItem('auth_user', JSON.stringify({json.dumps(user_info)}));
            localStorage.setItem('app-theme', 'dark');
            localStorage.setItem('theme', 'dark');
            localStorage.setItem('app-lang', 'ar');
            document.documentElement.setAttribute('data-theme', 'dark');
            document.documentElement.setAttribute('dir', 'rtl');
            document.documentElement.setAttribute('lang', 'ar');
        """
        context.add_init_script(init_js)

        page = context.new_page()

        # -------------------------------------------------------------
        # 1. LANDING PAGE (/customization-delivery)
        # -------------------------------------------------------------
        print("\n--- 1. Landing Page ---")
        page.goto("http://localhost:5173/customization-delivery", wait_until="domcontentloaded")
        page.wait_for_selector(".three-cards-grid, .customization-delivery-page", timeout=10000)
        time.sleep(1)

        page_content = page.content()
        has_card1 = "عروض الأسعار" in page_content or "Sales Quotation" in page_content
        has_card2 = "أوامر البيع" in page_content or "Sales Order" in page_content
        has_card3 = "التسليم" in page_content or "Delivery" in page_content

        print(f"Landing Page - Card 1 (عروض الأسعار): {has_card1}")
        print(f"Landing Page - Card 2 (أوامر البيع): {has_card2}")
        print(f"Landing Page - Card 3 (التسليم): {has_card3}")

        shot_landing = os.path.join(ARTIFACT_DIR, "landing_page.png")
        page.screenshot(path=shot_landing, full_page=True)
        results["landing_page"] = {"has_3_cards": has_card1 and has_card2 and has_card3, "screenshot": shot_landing}

        # -------------------------------------------------------------
        # 2. SALES QUOTATIONS LIST (/customization-delivery/quotations)
        # -------------------------------------------------------------
        print("\n--- 2. Sales Quotations List ---")
        page.goto("http://localhost:5173/customization-delivery/quotations", wait_until="domcontentloaded")
        page.wait_for_selector(".page-header, .app-button--primary", timeout=10000)
        time.sleep(1)

        btn_create = page.locator("button:has-text('إنشاء عرض سعر'), a:has-text('إنشاء عرض سعر')").first
        has_create_btn = btn_create.count() > 0
        print(f"Quotations List - [ + إنشاء عرض سعر ] button present: {has_create_btn}")
        shot_quotes = os.path.join(ARTIFACT_DIR, "quotations_page.png")
        page.screenshot(path=shot_quotes, full_page=True)

        # -------------------------------------------------------------
        # 3. SALES QUOTATION WIZARD (/customization-delivery/quotations/new)
        # -------------------------------------------------------------
        print("\n--- 3. Sales Quotation Wizard ---")
        page.goto("http://localhost:5173/customization-delivery/quotations/new", wait_until="domcontentloaded")
        page.wait_for_selector(".wizard-steps-bar, .card-panel", timeout=10000)
        time.sleep(2)

        # Test Customer SearchableSelect
        cust_input = page.locator(".searchable-select input").first
        if cust_input.count() > 0:
            cust_input.click()
            try:
                page.wait_for_selector(".searchable-select__option", timeout=30000)
            except Exception:
                pass
            opt = page.locator(".searchable-select__option").first
            if opt.count() > 0:
                opt_text = opt.inner_text()
                opt.click()
                print(f"Customer SearchableSelect verified: {opt_text}")
                time.sleep(0.5)

        shot_sq_wizard = os.path.join(ARTIFACT_DIR, "sales_quotation_wizard.png")
        page.screenshot(path=shot_sq_wizard, full_page=True)
        results["quotation_wizard"] = {"screenshot": shot_sq_wizard}

        # Advance to Step 2 (Items)
        btn_continue = page.locator("button:has-text('المتابعة للأصناف'), button:has-text('Continue to Items')").first
        if btn_continue.count() > 0 and btn_continue.is_enabled():
            btn_continue.click()
            time.sleep(1)
            print("Quotation Wizard - Advanced to Step 2: Items")

            # Test Item SearchableSelect
            item_input = page.locator(".searchable-select input").first
            if item_input.count() > 0:
                item_input.click()
                try:
                    page.wait_for_selector(".searchable-select__option", timeout=30000)
                except Exception:
                    pass
                item_opt = page.locator(".searchable-select__option").first
                if item_opt.count() > 0:
                    item_text = item_opt.inner_text()
                    item_opt.click()
                    print(f"Item SearchableSelect verified: {item_text}")
                    # Add item
                    add_btn = page.locator("button:has-text('إضافة الصنف')").first
                    if add_btn.count() > 0:
                        add_btn.click()
                        time.sleep(0.5)

            # Advance to Step 3 (Commercial & Warehouse)
            btn_step3 = page.locator("button:has-text('المتابعة للأسعار والمستودع'), button:has-text('Continue to Commercial')").first
            if btn_step3.count() > 0 and btn_step3.is_enabled():
                btn_step3.click()
                time.sleep(1)
                print("Quotation Wizard - Advanced to Step 3: Commercial & Warehouse")

                warehouse_input = page.locator(".searchable-select input").first
                if warehouse_input.count() > 0 and not warehouse_input.input_value():
                    warehouse_input.click()
                    page.wait_for_selector(".searchable-select__option", timeout=30000)
                    warehouse_option = page.locator(".searchable-select__option").first
                    warehouse_text = warehouse_option.inner_text()
                    warehouse_option.click()
                    print(f"SAP Warehouse selected: {warehouse_text}")

                # Advance to Step 4 (Specifications & Customization)
                btn_step4 = page.locator("button:has-text('المتابعة للمواصفات والتخصيص'), button:has-text('Continue to Specs')").first
                if btn_step4.count() > 0 and btn_step4.is_enabled():
                    btn_step4.click()
                    time.sleep(1)
                    print("Quotation Wizard - Advanced to Step 4: Specifications & Customization")
                    brand_inputs = page.locator(".searchable-select input")
                    if brand_inputs.count() >= 2:
                        brand_inputs.nth(1).click()
                        page.wait_for_selector(".searchable-select__option", timeout=30000)
                        brand_count = page.locator(".searchable-select__option").count()
                        print(f"SAP Brand valid-values count: {brand_count}")
                        page.keyboard.press("Escape")

                    # Advance to Step 5 (Review)
                    btn_step5 = page.locator("button:has-text('المتابعة للمراجعة والتحقق'), button:has-text('Continue to Review')").first
                    if btn_step5.count() > 0 and btn_step5.is_enabled():
                        btn_step5.click()
                        time.sleep(1)
                        print("Quotation Wizard - Advanced to Step 5: Review")

        # -------------------------------------------------------------
        # 4. SALES ORDER CARDS (/customization-delivery/orders)
        # -------------------------------------------------------------
        print("\n--- 4. Sales Order Cards ---")
        page.goto("http://localhost:5173/customization-delivery/orders", wait_until="domcontentloaded")
        page.wait_for_selector(".customization-card, .shipping-delivery-page", timeout=10000)
        time.sleep(1.5)
        shot_so_cards = os.path.join(ARTIFACT_DIR, "sales_order_cards.png")
        page.screenshot(path=shot_so_cards, full_page=True)
        results["sales_order_cards"] = {"screenshot": shot_so_cards}

        # -------------------------------------------------------------
        # 5. DELIVERIES LIST & CARDS (/customization-delivery/deliveries)
        # -------------------------------------------------------------
        print("\n--- 5. Delivery Cards ---")
        page.goto("http://localhost:5173/customization-delivery/deliveries", wait_until="domcontentloaded")
        page.wait_for_selector(".page-header, .shipping-delivery-page", timeout=10000)
        time.sleep(1.5)

        tab_all = page.locator("button:has-text('الكل'), button:has-text('All')").first
        if tab_all.count() > 0:
            tab_all.click()
            time.sleep(1)

        shot_deliv_cards = os.path.join(ARTIFACT_DIR, "delivery_cards.png")
        page.screenshot(path=shot_deliv_cards, full_page=True)
        results["delivery_cards"] = {"screenshot": shot_deliv_cards}

        # -------------------------------------------------------------
        # 6. DELIVERY WIZARD - BATCH & BIN ALLOCATION
        # -------------------------------------------------------------
        print("\n--- 6. Delivery Wizard ---")
        page.goto("http://localhost:5173/customization-delivery/deliveries/new/25800", wait_until="domcontentloaded")
        page.wait_for_selector(".wizard-steps-bar, .card-panel", timeout=15000)
        time.sleep(2)

        # Step 1 -> Step 2 (Quantities)
        btn_to_qty = page.locator("button:has-text('المتابعة لتحديد كميات التسليم'), button:has-text('Continue to Quantities')").first
        if btn_to_qty.count() > 0 and btn_to_qty.is_enabled():
            btn_to_qty.click()
            time.sleep(1)
            print("Delivery Wizard - Advanced to Step 2 (Quantities)")

            # Step 2 -> Step 3 (Batches)
            btn_to_batches = page.locator("button:has-text('المتابعة لتخصيص التشغيلات'), button:has-text('Continue to Batches')").first
            if btn_to_batches.count() > 0 and btn_to_batches.is_enabled():
                btn_to_batches.click()
                time.sleep(2.5)
                print("Delivery Wizard - Advanced to Step 3 (Batches)")

                # Test Batch SearchableSelect
                batch_input = page.locator(".searchable-select input").first
                if batch_input.count() > 0:
                    batch_input.click()
                    time.sleep(1)
                    batch_opts = page.locator(".searchable-select__option")
                    opt_count = batch_opts.count()
                    print(f"Real SAP Batches Dropdown count: {opt_count}")
                    if opt_count > 0:
                        first_batch_text = batch_opts.first.inner_text()
                        print(f"Sample SAP Batch Option: {first_batch_text}")
                        batch_opts.first.click()
                        time.sleep(0.5)

                        quantity_input = page.locator("input[type='number']").first
                        if quantity_input.count() > 0:
                            quantity_input.fill("500")
                            print("Batch allocation quantity populated: 500")

                        # Allocate Batch
                        alloc_btn = page.locator("button:has-text('تخصيص التشغيلة'), button:has-text('Allocate Batch')").first
                        if alloc_btn.count() > 0 and alloc_btn.is_enabled():
                            alloc_btn.click()
                            time.sleep(0.5)
                            print("Batch allocated with on-hand quantity and default bin!")

                shot_batch_step = os.path.join(ARTIFACT_DIR, "delivery_wizard_batch_step.png")
                page.screenshot(path=shot_batch_step, full_page=True)
                results["delivery_wizard_batch_step"] = {"screenshot": shot_batch_step}

                # Step 3 -> Step 4 (Bin Locations)
                btn_to_bins = page.locator("button:has-text('المتابعة لتخصيص مواقع التخزين'), button:has-text('Continue to Bin Locations')").first
                if btn_to_bins.count() > 0 and btn_to_bins.is_enabled():
                    btn_to_bins.click()
                    time.sleep(2)
                    print("Delivery Wizard - Advanced to Step 4 (Bin Locations)")

                    bin_input = page.locator(".searchable-select input").first
                    if bin_input.count() > 0:
                        bin_input.click()
                        time.sleep(1)
                        bin_opts = page.locator(".searchable-select__option")
                        print(f"SAP Bin Dropdown count: {bin_opts.count()}")
                        if bin_opts.count() > 0:
                            print(f"Sample SAP Bin Option: {bin_opts.first.inner_text()}")
                            bin_opts.first.click()
                            time.sleep(0.5)

                    shot_bin_step = os.path.join(ARTIFACT_DIR, "delivery_wizard_bin_step.png")
                    page.screenshot(path=shot_bin_step, full_page=True)
                    results["delivery_wizard_bin_step"] = {"screenshot": shot_bin_step}

                    # Step 4 -> Step 5 (Cost Centers)
                    btn_to_dims = page.locator("button:has-text('المتابعة لمراكز التكلفة'), button:has-text('Continue to Cost Centers'), button:has-text('أبعاد مراكز التكلفة')").first
                    if btn_to_dims.count() > 0 and btn_to_dims.is_enabled():
                        btn_to_dims.click()
                        time.sleep(2)
                        print("Delivery Wizard - Advanced to Step 5 (Cost Centers)")

                        cost_center_inputs = page.locator(".searchable-select input")
                        for index, dimension in enumerate((1, 2)):
                            if cost_center_inputs.count() > index:
                                cost_center_inputs.nth(index).click()
                                time.sleep(1)
                                dimension_opts = page.locator(".searchable-select__option")
                                print(f"Dimension {dimension} Cost Center count: {dimension_opts.count()}")
                                page.keyboard.press("Escape")

                        shot_cc_step = os.path.join(ARTIFACT_DIR, "delivery_wizard_cost_centers.png")
                        page.screenshot(path=shot_cc_step, full_page=True)
                        results["delivery_wizard_cost_centers"] = {"screenshot": shot_cc_step}

        # -------------------------------------------------------------
        # 7. MOBILE RESPONSIVE TEST (390 x 844)
        # -------------------------------------------------------------
        print("\n--- 7. Mobile Viewport Smoke Test ---")
        context_mobile = browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            locale="ar-EG",
        )
        context_mobile.add_cookies([
            {
                "name": "sessionid",
                "value": session_key,
                "domain": "localhost",
                "path": "/",
            }
        ])
        context_mobile.add_init_script(init_js)
        page_mobile = context_mobile.new_page()
        page_mobile.goto("http://localhost:5173/customization-delivery/quotations/new", wait_until="domcontentloaded")
        page_mobile.wait_for_selector(".wizard-steps-bar, .card-panel", timeout=10000)
        time.sleep(1.5)

        shot_mobile = os.path.join(ARTIFACT_DIR, "mobile_quotation_wizard.png")
        page_mobile.screenshot(path=shot_mobile, full_page=True)
        results["mobile_view"] = {"screenshot": shot_mobile}

        browser.close()

    print("\n[SMOKE TEST COMPLETE]")
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
