"""Isolated Playwright checks against local Vite and an existing CDP browser.

All business HTTP requests are fulfilled locally. No save/approve/post buttons
are clicked. The existing application and its event handlers are used as-is.
"""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scratch" / "readiness-pdf-tools"))
import pymupdf

ORIGIN = os.environ.get("VERIFY_ORIGIN", "http://127.0.0.1:5173")
OUT = Path(__file__).resolve().parents[1] / "responsive-screenshots" / "audit"
OUT.mkdir(parents=True, exist_ok=True)
OUTPUT_NAME = os.environ.get("VERIFY_OUTPUT", "verification-interactions")
RESULTS = []
FAILURES = []
NAME = "مورد المنتجات الزراعية والتعبئة والشحن الدولي — Agricultural Packaging Supplier"
LINE = {"line_number": 0, "item_code": "ITEM", "item_name": NAME,
        "open_quantity": 1000, "quantity": 1000, "uom": "KG", "unit_price": 10}
ORDER = {"doc_entry": 10, "doc_num": 10001, "document_entry": 10,
         "document_number": 10001, "sales_order_doc_entry": 10,
         "sales_order_doc_num": 10001, "customer_name": NAME, "customer_code": "C001",
         "lines": [LINE], "currency": "EGP", "total_amount": 10000,
         "ordered_quantity": 1000, "delivered_quantity": 100,
         "remaining_open_quantity": 900, "has_remaining": True,
         "document_date": "2026-10-19", "due_date": "2026-10-20"}
OPERATION = {"id": 1, "revision": 0, "status": "WAITING", "vehicle_number": "TEST-TRUCK",
             "container_number": "TEST-CONTAINER", "containers": ["TEST-CONTAINER"],
             "pallets": [], "first_weight": 10000, "pallet_count": 0, "box_count": 0,
             "ticket_number": "TEST-TICKET", "order": ORDER, "sales_order_doc_entry": 10}
DRAFT = {"id": 1, "draft_number": "AUDIT-001", "status": "COMPLETED",
         "vendor_name": NAME, "item_name": NAME, "effective_driver_name": NAME,
         "vehicle_number": "TEST-TRUCK", "effective_vehicle_number": "TEST-TRUCK",
         "created_at": "2026-10-19T10:00:00Z", "net_weight_loaded": 22345,
         "net_weight_empty": 10000, "product_weight": 12345, "allocations": [],
         "draft_elements": [], "lines": [], "is_closed": True}


def fixture(path):
    path = path.removeprefix("/api")
    if path.endswith("/me/"):
        return {"success": True, "data": {"username": "UI Verification", "role": "admin", "is_superuser": True}}
    if path == "/shipping/orders/10/":
        return {"order": ORDER}
    if path == "/shipping/operations/1/":
        return {"operation": OPERATION}
    if path == "/shipping/sources/PALLET-A/":
        return {"source": {"batch_number": "PALLET-A", "item_code": "ITEM", "quantity": 100, "source_warehouse": "WH01"}}
    if path.startswith("/shipping/"):
        return {"orders": [ORDER], "operations": [OPERATION], "next_offset": None,
                "elements": [{"id": 1, "name": "PALLET", "weight": "25"}, {"id": 2, "name": "BOX", "weight": "0.5"}]}
    if path == "/scale/devices/":
        return {"success": True, "data": {"devices": []}}
    if path == "/scale/drafts/":
        return {"success": True, "data": [DRAFT, {**DRAFT, "id": 2, "draft_number": "AUDIT-002", "status": "SECOND_WEIGHT_PENDING", "is_closed": False}]}
    if path.startswith("/scale/drafts/"):
        return {"success": True, "data": DRAFT}
    if path.startswith("/scale/"):
        return {"success": True, "data": [], "devices": [], "results": []}
    if "documents/10/" in path:
        return {"success": True, "document": ORDER}
    return {"success": True, "orders": [ORDER], "drafts": [], "documents": [],
            "data": {"orders": [ORDER], "drafts": [], "items": [], "records": []},
            "pagination": {"total": 1, "has_next": False}, "counts": {"all": 1, "total": 1, "active": 1, "completed": 0}}


def write_results():
    (OUT / (OUTPUT_NAME + ".json")).write_text(
        json.dumps({"completed": False, "results": RESULTS, "failures": FAILURES}, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{os.environ.get('AUDIT_CHROME_PORT', '9777')}")
        sizes = [tuple(map(int, item.split("x"))) for item in os.environ.get("VERIFY_SIZES", "280x740,390x320,768x480,1440x900").split(",")]
        for theme in os.environ.get("VERIFY_THEMES", "light,dark").split(","):
            for lang in os.environ.get("VERIFY_LANGS", "en,ar").split(","):
                for width, height in sizes:
                    context = browser.new_context(viewport={"width": width, "height": height},
                                                  is_mobile=width <= 768, has_touch=width <= 768 or os.environ.get("VERIFY_TOUCH_LARGE") == "1")
                    context.set_default_timeout(10000)
                    writes = []
                    exceptions = []

                    def intercept(route):
                        request = route.request
                        u = urlparse(request.url)
                        if f"{u.scheme}://{u.netloc}" == ORIGIN and not u.path.startswith("/api/"):
                            route.continue_()
                            return
                        discovery = request.method == "POST" and u.path.endswith("/shipping/operations/discover/")
                        mutation = request.method not in ["GET", "OPTIONS"]
                        if mutation:
                            writes.append({"method": request.method, "path": u.path, "fixtureOnly": discovery})
                        route.fulfill(status=200 if not mutation or discovery else 405,
                                      headers={"Access-Control-Allow-Origin": ORIGIN,
                                               "Access-Control-Allow-Credentials": "true",
                                               "Access-Control-Allow-Headers": "Content-Type, X-CSRFToken, X-Requested-With, Authorization, X-Request-ID",
                                               "Access-Control-Allow-Methods": "GET, OPTIONS, POST, PUT, PATCH, DELETE"},
                                      content_type="application/json", body=json.dumps(fixture(u.path)))

                    context.route("**/*", intercept)
                    context.add_init_script("window.close=()=>{};window.print=()=>{window.__verificationPrint=true};localStorage.setItem('auth_user'," + json.dumps(json.dumps({"username": "UI Verification", "role": "admin", "is_superuser": True})) + ");localStorage.setItem('app-theme'," + json.dumps(theme) + ");localStorage.setItem('app-lang'," + json.dumps(lang) + ");")
                    page = context.new_page()
                    page.on("pageerror", lambda error: exceptions.append(str(error)))

                    def check(state, screenshot=True):
                        page.evaluate("document.fonts.ready")
                        metrics = page.evaluate("""() => ({width:document.documentElement.clientWidth,
                          scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,
                          lang:document.documentElement.lang,coarse:matchMedia('(pointer: coarse)').matches,
                          h1:[...document.querySelectorAll('h1')].map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize})),
                          fields:[...document.querySelectorAll('.MuiDialog-root input')].map(e=>({placeholder:e.placeholder,font:getComputedStyle(e).fontSize,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width}))})""")
                        assert metrics["scroll"] <= metrics["width"] + 1, metrics
                        assert metrics["theme"] == theme and metrics["lang"] == lang, metrics
                        if os.environ.get("VERIFY_TOUCH_LARGE") == "1":
                            assert metrics["coarse"], metrics
                        assert not exceptions, exceptions
                        assert not [w for w in writes if not w["fixtureOnly"]], writes
                        item = {"state": state, "route": urlparse(page.url).path, "width": width, "height": height,
                                "lang": lang, "theme": theme, "metrics": metrics}
                        if screenshot:
                            filename = f"verification-focus-{lang}-{theme}-{width}-{state}.png"
                            page.screenshot(path=str(OUT / filename), full_page=True)
                            item["screenshot"] = filename
                        RESULTS.append(item)
                        write_results()

                    try:
                        page.goto(ORIGIN + "/scale/devices")
                        page.evaluate("document.fonts.ready")
                        if width <= 768:
                            page.locator(".mobile-nav-toggle").click()
                            page.evaluate("Promise.all(document.querySelector('.app-toolbar__actions').getAnimations().map(a=>a.finished))")
                            assert page.evaluate("innerWidth") == width, page.evaluate("({inner:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})")
                            check("mobile-navigation")
                            page.locator(".toolbar-review-menu--review > button").tap()
                            expect(page.locator(".toolbar-review-menu--review > .toolbar-review-menu__list")).to_be_visible()
                            check("mobile-review-menu")
                            # The rules trigger is the other top-level toolbar menu.
                            rules_trigger = page.locator(".app-toolbar__actions > .toolbar-review-menu:not(.toolbar-review-menu--review) > button").first
                            rules_trigger.tap()
                            expect(rules_trigger.locator("..").locator(":scope > .toolbar-review-menu__list")).to_be_visible()
                            check("mobile-rules-menu")
                            page.locator(".mobile-drawer__close").click()
                            expect(page.locator(".mobile-nav-toggle")).to_be_visible()
                        page.locator(".page-header__actions button").nth(1).click()
                        page.locator(".MuiDialog-root select").select_option("remote")
                        ip = page.locator('input[placeholder="e.g. 192.168.1.150"]')
                        port = page.locator('input[placeholder="8000"]')
                        ip.fill("192.168.1.150")
                        ip.scroll_into_view_if_needed()
                        check("device-ip")
                        port.fill("8000")
                        port.scroll_into_view_if_needed()
                        check("device-port")
                        ip_box, port_box = ip.bounding_box(), port.bounding_box()
                        assert ip_box and port_box
                        assert (port_box["y"] > ip_box["y"] + 20) if width < 600 else (abs(port_box["y"] - ip_box["y"]) < 2)
                        page.locator(".MuiDialogActions-root button").first.click()
                        expect(page.locator(".MuiDialog-root")).not_to_be_visible()

                        page.goto(ORIGIN + "/scale/drafts")
                        expect(page.locator("tbody tr")).to_have_count(2)
                        assert page.locator("tbody tr").first.locator("td").count() == 11
                        assert all(cell.is_visible() for cell in page.locator("tbody tr").first.locator("td").all())
                        display = page.locator("table").evaluate("e=>getComputedStyle(e).display")
                        assert display == ("block" if width <= 768 else "table"), display
                        page.locator("tbody").scroll_into_view_if_needed()
                        check("scale-draft-cards")

                        page.goto(ORIGIN + "/customization-delivery/orders")
                        expect(page.get_by_text("TEST-TRUCK")).to_have_count(0)
                        print_button = page.locator("button").filter(has=page.locator("svg.lucide-printer")).first
                        expect(print_button).to_be_visible()
                        check("sales-orders")
                        if width >= 1101:
                            trigger = page.locator(".toolbar-review-menu--review > button")
                            if os.environ.get("VERIFY_TOUCH_LARGE") == "1":
                                trigger.tap()
                            else:
                                trigger.hover()
                            expect(page.locator(".toolbar-review-menu--review > .toolbar-review-menu__list")).to_be_visible()
                            check("sales-review-menu")
                            page.goto(ORIGIN + "/customization-delivery/orders")
                            expect(print_button).to_be_visible()
                            page.mouse.move(width - 1, height - 1)
                            keyboard_trigger = page.locator(".toolbar-review-menu--review > button")
                            keyboard_trigger.focus()
                            keyboard_trigger.press("Enter")
                            expect(page.locator(".toolbar-review-menu--review > .toolbar-review-menu__list")).to_be_visible()
                            check("keyboard-review-menu")
                            page.goto(ORIGIN + "/customization-delivery/orders")
                            expect(print_button).to_be_visible()
                        with page.expect_popup() as popup_info:
                            print_button.click()
                        popup = popup_info.value
                        popup.on("pageerror", lambda error: exceptions.append(str(error)))
                        expect(popup.locator(".quality-print-document .a4-print-sheet").first).to_be_visible(timeout=15000)
                        popup.wait_for_function("window.__printReady === true")
                        popup.emulate_media(media="print")
                        assert NAME in popup.locator("body").inner_text()
                        pdf_bytes = popup.pdf(prefer_css_page_size=True, print_background=True)
                        pdf_dir = ROOT / "tmp" / "pdfs"
                        pdf_dir.mkdir(parents=True, exist_ok=True)
                        (pdf_dir / f"verification-sales-{lang}-{theme}-{width}.pdf").write_bytes(pdf_bytes)
                        pdf_doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
                        paper = {"pages": len(pdf_doc), "widthPt": pdf_doc[0].rect.width, "heightPt": pdf_doc[0].rect.height}
                        assert all(840 <= pg.rect.width <= 844 and 593 <= pg.rect.height <= 597 for pg in pdf_doc), paper
                        pdf_text = "\n".join(pg.get_text() for pg in pdf_doc)
                        assert "Agricultural" in pdf_text and "10001" in pdf_text and "ITEM" in pdf_text
                        print_file = f"verification-sales-print-{lang}-{theme}-{width}.png"
                        pdf_doc[0].get_pixmap(matrix=pymupdf.Matrix(1.25, 1.25)).save(str(OUT / print_file))
                        pdf_doc.close()
                        RESULTS.append({"state": "sales-order-print", "route": "/customization-delivery/orders",
                                        "width": width, "height": height, "lang": lang, "theme": theme,
                                        "paper": paper, "screenshot": print_file})
                        popup.close()

                        page.goto(ORIGIN + "/customization-delivery/deliveries")
                        expect(page.locator(".page-header")).to_be_visible()
                        check("deliveries")

                        page.goto(ORIGIN + "/shipping-loading")
                        page.locator(".shipping-card").first.click()
                        expect(page.locator(".shipping-card").first).to_contain_text("TEST-TRUCK")
                        check("shipping-truck")
                        page.locator(".shipping-card").first.click()
                        expect(page.locator(".shipping-scan input")).to_be_visible()
                        check("shipping-scan")
                        page.locator(".shipping-scan input").fill("PALLET-A")
                        page.locator(".shipping-scan button").click()
                        expect(page.locator(".shipping-pallet")).to_have_count(1)
                        page.locator(".shipping-wizard-navigation .shipping-primary").click()
                        expect(page.locator(".shipping-element-row")).to_have_count(2)
                        check("shipping-packaging")
                        for index, option in [(0, "PALLET"), (1, "BOX")]:
                            combo = page.locator(".shipping-element-row").nth(index).get_by_role("combobox")
                            combo.click()
                            page.get_by_role("option").filter(has_text=option).first.click()
                        page.locator('.shipping-element-row input[type="number"]').last.fill("10")
                        expect(page.locator(".shipping-wizard-navigation .shipping-primary")).to_be_enabled()
                        page.locator(".shipping-wizard-navigation .shipping-primary").click()
                        expect(page.locator(".shipping-actions--sticky")).to_be_visible()
                        check("shipping-review-no-save")
                    except Exception as exc:
                        FAILURES.append({"lang": lang, "theme": theme, "width": width, "height": height,
                                         "route": page.url, "error": str(exc), "exceptions": exceptions, "writes": writes})
                        page.screenshot(path=str(OUT / f"verification-failure-{lang}-{theme}-{width}.png"), full_page=True)
                        write_results()
                    finally:
                        context.close()
        (OUT / (OUTPUT_NAME + ".json")).write_text(
            json.dumps({"completed": True, "results": RESULTS, "failures": FAILURES}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"passedStates": len(RESULTS), "failedScenarios": len(FAILURES)}))
        if FAILURES:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
