"""Rendered UI tests with every API call intercepted; no operational/SAP writes.

Run Vite on 127.0.0.1:5189, then run with the workspace's Playwright-enabled Python.
"""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.update(DJANGO_SETTINGS_MODULE="receipt_project.settings", SAP_BASE_URL="https://test.invalid/b1s/v2",
                  SAP_COMPANY_DB="UI_TEST", TRANSFER_INTERMEDIATE_WAREHOUSES="INT", TRANSFER_FRIDGE_WAREHOUSES="COLD")
import django
django.setup()
from unittest.mock import patch, Mock
from django.contrib.auth.models import User
from rest_framework.test import APIRequestFactory, force_authenticate
from api.transfer_policy_views import effective_policy
from api.services.persisted_transfer_policy_service import normalize_configuration, effective_stage
from api.services.transfer_policy_service import VALID_STAGES
from playwright.sync_api import sync_playwright, expect

request = APIRequestFactory().get("/api/transfer/policies/effective/")
force_authenticate(request, user=User(username="fixture", is_superuser=True))
with patch("api.transfer_policy_views.SAPServiceLayer", return_value=Mock()), patch("api.models_transfer_policy.TransferPolicyRevision.objects.filter", return_value=[]):
    BASE = effective_policy(request).data
S1, S2, S3 = VALID_STAGES


class FixtureAPI:
    def __init__(self, user):
        self.user = user
        self.calls = []
        self.next_error = None
        self.runtime_disabled = False
        configs = [
            normalize_configuration(S1, {"label": "Configured production route", "route_pairs": [{"from_warehouse": "PROD", "to_warehouse": "INT"}]}),
            normalize_configuration(S2, {"route_pairs": [{"from_warehouse": "INT", "to_warehouse": "COLD", "destination_type": "fridge"}],
                                         "destination_physical_purpose": "cold_storage", "allowed_destination_bins": {"COLD": [{"bin_code": "COLD-P01", "abs_entry": 11}]}}),
            normalize_configuration(S3, {"route_pairs": [{"from_warehouse": "COLD", "to_warehouse": "SHIP"}],
                                         "destination_bin_policy": "required", "source_physical_purpose": "cold_storage",
                                         "allowed_source_bins": {"COLD": [{"bin_code": "COLD-P01", "abs_entry": 11}]}}),
        ]
        self.rows = [dict(id=i + 1, stage_key=stage, configuration=config, state="ACTIVE" if i == 0 else "DRAFT",
                          revision=1, company_scope=BASE["company_scope"], created_at="2026-10-04T08:00:00Z",
                          updated_at="2026-10-04T08:00:00Z", created_by=1, updated_by=1)
                     for i, (stage, config) in enumerate(zip(VALID_STAGES, configs))]

    def normalized(self, stage, config):
        result = normalize_configuration(stage, config)
        if stage == S2:
            for route in result['route_pairs']:
                route.setdefault('destination_type', 'fridge' if route['to_warehouse'] == 'COLD' else 'intermediate')
            result['destination_physical_purpose'] = 'cold_storage' if any(r['destination_type'] == 'fridge' for r in result['route_pairs']) else 'none'
        return result

    def detail(self, row):
        result = copy.deepcopy(row)
        incomplete = row["stage_key"] == S3
        result["validation"] = dict(status="INCOMPLETE" if incomplete else "VALID", can_activate=not incomplete,
                                    issues=[dict(code="bins_required", message="Explicit bins are required."),
                                            dict(code="shipping_arrival_unavailable", message="Physical arrival is unavailable.")] if incomplete else [])
        return result

    def handle(self, route):
        req = route.request
        path = urlparse(req.url).path
        query = parse_qs(urlparse(req.url).query)
        search = query.get('search', [''])[0].casefold()
        def searched(rows):
            if query.get('lookup') != ['1']:
                return rows
            if len(search) < 2 and query.get('initial') != ['1']:
                return []
            return [row for row in rows if search in ' '.join(str(value) for value in row.values()).casefold()][:int(query.get('limit', ['25'])[0])]
        headers = {"Access-Control-Allow-Origin": "http://127.0.0.1:5189", "Access-Control-Allow-Credentials": "true",
                   "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"}
        def respond(data, status=200):
            route.fulfill(status=status, content_type="application/json", headers=headers, body=json.dumps(data))
        if req.method == "OPTIONS":
            respond({}); return
        self.calls.append((req.method, path, req.post_data))
        if path.endswith("/transfer/warehouse-access/me/"):
            respond({"data": {"access": {"allow_all": True, "has_rules": False, "rules": []}}}); return
        if path.endswith("/me/"):
            respond({"data": self.user}); return
        if self.next_error and req.method in {"POST", "PATCH"}:
            status = self.next_error
            self.next_error = None
            respond({"error": "Fixture rejection", "issues": [{"code": "validation", "message": "Fixture validation reason"}]}, status)
            return
        if path.endswith("/transfer/intermediate-warehouses/"):
            respond([dict(code="INT", name="Intermediate")]); return
        if path.endswith("/transfer/policies/effective/") or path.endswith("/transfer/config/"):
            result = copy.deepcopy(BASE)
            for row in self.rows:
                if row["state"] == "ACTIVE":
                    result["stages"][row["stage_key"]] = effective_stage(SimpleNamespace(pk=row["id"], stage_key=row["stage_key"], revision=row["revision"], configuration=row["configuration"]), result["stages"][row["stage_key"]])
            if self.runtime_disabled:
                result["stages"][S1]["enabled"] = False
            respond(result); return
        if path.endswith("/warehouses/"):
            respond({"data": {"warehouses": searched([dict(code=code, name=f"Warehouse {code}", inactive=code == "INACTIVE") for code in ["PROD", "INT", "COLD", "SHIP", "EMPTY", "INACTIVE"]])}}); return
        if "/bin-locations/" in path:
            code = path.rstrip("/").split("/")[-1]
            respond({"data": {"warehouse_code": code, "locations": searched([] if code == "EMPTY" else [
                dict(code=f"{code}-P01", warehouse=code, description="Physical channel", absEntry=11, inactive=False, is_system_bin=False),
                dict(code=f"{code}-INACTIVE", warehouse=code, description="Inactive channel", absEntry=12, inactive=True, is_system_bin=False),
                dict(code=f"{code}-SYSTEM", warehouse=code, description="System location", absEntry=13, inactive=False, is_system_bin=True),
            ])}}); return
        if path.endswith("/transfer/policies/"):
            if req.method == "GET":
                respond(dict(company_scope=BASE["company_scope"], revisions=self.rows)); return
            body = req.post_data_json
            row = dict(self.rows[0], id=max(r["id"] for r in self.rows) + 1, stage_key=body["stage_key"], configuration=self.normalized(body["stage_key"], body["configuration"]),
                       state="DRAFT", revision=max(r["revision"] for r in self.rows if r["stage_key"] == body["stage_key"]) + 1)
            self.rows.append(row); respond(self.detail(row), 201); return
        if "/transfer/policies/" in path:
            parts = path.rstrip("/").split("/")
            identifier = int(parts[-2] if parts[-1] in {"activate", "disable"} else parts[-1])
            row = next(r for r in self.rows if r["id"] == identifier)
            if req.method == "PATCH":
                assert row["state"] == "DRAFT", "UI attempted to update an immutable revision"
                row["configuration"] = self.normalized(row["stage_key"], req.post_data_json["configuration"])
            elif req.method == "POST":
                if parts[-1] == "activate":
                    assert row["stage_key"] != S3, "UI attempted incomplete Stage 3 activation"
                    for other in self.rows:
                        if other["stage_key"] == row["stage_key"] and other["state"] == "ACTIVE": other["state"] = "DISABLED"
                    row["state"] = "ACTIVE"
                else: row["state"] = "DISABLED"
            respond(self.detail(row)); return
        # Other shell requests receive inert fixtures; no network request reaches a server.
        respond({"data": {}})


ADMIN = dict(id=1, username="fixture-admin", role="transfer_admin", module_permissions={"transfer": "ADMIN"})
checks = 0
artifact_dir = Path(tempfile.mkdtemp(prefix="transfer-policy-ui-"))
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    def open_page(user, language="en", theme="light", width=1440):
        fixture = FixtureAPI(user)
        context = browser.new_context(viewport={"width": width, "height": 900}, reduced_motion="reduce")
        context.add_init_script("localStorage.setItem('auth_user', " + json.dumps(json.dumps(user)) + ");localStorage.setItem('app-lang', " + json.dumps(language) + ");localStorage.setItem('app-theme', " + json.dumps(theme) + ");")
        context.route("**/api/**", fixture.handle)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto("http://127.0.0.1:5189/transfer/configuration", wait_until="domcontentloaded")
        return page, context, fixture
    page, context, fixture = open_page(ADMIN)
    expect(page.get_by_role("heading", name="Transfer Configuration", exact=True)).to_be_visible()
    cards = page.locator(".transfer-policy-stage")
    expect(cards).to_have_count(3)
    for key in (S1, S2, S3):
        expect(page.locator(f'[data-stage="{key}"]').get_by_text("Configuration source: Persisted company policy", exact=True)).to_be_visible()
    checks += 3
    for key in (S1, S2, S3):
        expect(page.locator(f'[data-stage="{key}"]')).to_be_visible()
    card = page.locator(f'[data-stage="{S1}"]')
    expect(card.get_by_label("Display label", exact=True)).not_to_be_visible()
    expect(page.get_by_role("listbox")).to_have_count(0)
    assert "UI_TEST" not in page.locator("body").inner_text()
    checks += 7
    expect(card.get_by_role("button", name="Save as Draft", exact=True)).to_be_disabled()
    card.locator("summary").filter(has_text="Advanced configuration").click()
    expect(card.get_by_label("Display label", exact=True)).to_be_disabled()
    checks += 3
    card.get_by_role("button", name="Create replacement draft").click()
    card.get_by_label("Display label", exact=True).fill("Replacement from UI")
    card.get_by_role("button", name="Save as Draft", exact=True).click()
    expect(page.get_by_text("Draft saved. It has not been activated.")).to_be_visible()
    expect(card.get_by_role("button", name="Activate revision", exact=True)).to_be_enabled()
    assert sum(method == "POST" and path.endswith("/policies/") for method, path, _ in fixture.calls) == 1
    checks += 3
    card.get_by_role("button", name="Activate revision", exact=True).click()
    expect(page.get_by_text("Revision activated.", exact=True)).to_be_visible()
    expect(card.get_by_label("Display label", exact=True)).to_be_disabled()
    card.locator("summary").filter(has_text="Revision history (read-only)").click()
    card.get_by_role("button", name="Disable revision", exact=True).click()
    expect(page.get_by_text("Revision disabled.", exact=True)).to_be_visible()
    expect(card.get_by_role("button", name="Activate revision", exact=True)).to_be_disabled()
    checks += 4
    card = page.locator(f'[data-stage="{S2}"]')
    expect(card.get_by_role("combobox", name="Destination bin", exact=True)).to_have_count(0)
    expect(card.get_by_text("Required \u2014 selected during transfer", exact=True)).to_be_visible()
    expect(card.get_by_text("COLD-P01", exact=False)).to_have_count(0)
    warehouse = card.get_by_role("combobox", name="To warehouse", exact=True)
    expect(warehouse).to_have_value("COLD")
    checks += 4
    card.get_by_role("button", name="Save as Draft", exact=True).click()
    expect(card.get_by_role("button", name="Activate revision", exact=True)).to_be_enabled()
    card.locator("summary").filter(has_text="Advanced configuration").click()
    expect(card.get_by_role("combobox", name="Destination SAP bin requirement", exact=True)).to_be_disabled()
    expect(card.get_by_role("combobox", name="Destination physical purpose", exact=True)).to_be_disabled()
    card.locator("summary").filter(has_text="Advanced configuration").click()
    checks += 3
    fixture.next_error = 409
    card.get_by_role("button", name="Save as Draft", exact=True).click()
    expect(page.get_by_text("The revision or lifecycle changed. Refresh and review before retrying.", exact=False).first).to_be_visible()
    expect(card.get_by_role("button", name="Activate revision", exact=True)).to_be_disabled()
    expect(card.get_by_role("button", name="Save as Draft", exact=True)).to_be_disabled()
    card.get_by_role("button", name="Refresh", exact=True).click()
    expect(card.get_by_role("button", name="Save as Draft", exact=True)).to_be_enabled()
    checks += 4
    card = page.locator(f'[data-stage="{S3}"]')
    expect(card.get_by_role("button", name="Activate revision", exact=True)).to_be_disabled()
    expect(page.get_by_text("Verified, explicitly selected SAP bins are required. No default or system bin will be substituted.")).to_be_visible()
    assert fixture.rows[2]["configuration"]["allowed_destination_bins"] == {}
    expect(card.get_by_text("Incomplete", exact=True)).to_be_visible()
    expect(card.get_by_text("Shipping Dock destination bin has not been configured.", exact=True)).to_be_visible()
    expect(card.get_by_role("combobox", name="Destination Shipping Dock bin", exact=True)).to_have_value("")
    checks += 3
    checks += 3
    fixture.next_error = 422
    card.get_by_role("button", name="Save as Draft", exact=True).click()
    expect(page.get_by_text("Backend validation rejected the configuration.", exact=False).first).to_be_visible()
    fixture.next_error = 503
    card.get_by_role("button", name="Save as Draft", exact=True).click()
    expect(page.get_by_text("SAP master data is unavailable. Retry when the service is available.", exact=False).first).to_be_visible()
    checks += 2
    shipping = card.get_by_role("combobox", name="Destination Shipping Dock bin", exact=True)
    expect(shipping).to_have_attribute("placeholder", "Select Shipping Dock bin")
    shipping.click()
    expect(shipping).to_have_value("")
    expect(page.get_by_role("option", name="SHIP-SYSTEM", exact=False)).to_have_attribute("aria-disabled", "true")
    page.get_by_role("option", name="SHIP-P01", exact=False).click()
    page.keyboard.press("Escape")
    assert fixture.rows[2]["configuration"]["allowed_destination_bins"] == {}
    card.get_by_role("button", name="Save as Draft", exact=True).click()
    expect(card.get_by_text("Draft saved. It has not been activated.", exact=True)).to_be_visible()
    assert fixture.rows[2]["configuration"]["allowed_destination_bins"] == {"SHIP": [{"bin_code": "SHIP-P01", "abs_entry": 11}]}
    assert fixture.rows[2]["state"] == "DRAFT"
    card.locator("summary").filter(has_text="Revision history (read-only)").click()
    card.get_by_role("button", name="Start new draft", exact=True).click()
    for label in ("From warehouse", "To warehouse"):
        expect(card.get_by_role("combobox", name=label, exact=True)).to_have_value("")
    expect(shipping).to_have_value("")
    expect(shipping).to_be_disabled()
    checks += 10
    page.screenshot(path=str(artifact_dir / "desktop.png"), full_page=True)
    fixture.runtime_disabled = True
    page.goto("http://127.0.0.1:5189/transfer", wait_until="domcontentloaded")
    expect(page.locator(".transfer-stage-btn").first).to_be_disabled()
    expect(page.locator(".transfer-stage-btn").nth(1)).to_be_enabled()
    checks += 2
    page.goto("http://127.0.0.1:5189/order-rules/transfer", wait_until="domcontentloaded")
    expect(page.get_by_role("heading").filter(has_text="Transfer").first).to_be_visible()
    checks += 1
    context.close()
    page, context, fixture = open_page(ADMIN, "ar", "dark", 390)
    expect(page.get_by_role("heading", name="إعدادات النقل", exact=True)).to_be_visible()
    assert page.locator("html").get_attribute("dir") == "rtl"
    assert page.locator("html").get_attribute("data-theme") == "dark"
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "Page overflows handheld viewport"
    save_button = page.get_by_role("button", name="حفظ كمسودة", exact=True)
    expect(save_button.first).to_have_css("min-height", "44px")
    page.screenshot(path=str(artifact_dir / "arabic-dark-mobile.png"), full_page=True)
    checks += 5
    context.close()
    page, context, fixture = open_page(dict(id=2, username="operator", role="transfer_user", module_permissions={"transfer": "USER"}))
    expect(page.get_by_text("You do not have permission", exact=False).or_(page.get_by_text("Access denied", exact=False)).first).to_be_visible()
    assert not any("/transfer/policies/" in path for _, path, _ in fixture.calls)
    checks += 2
    context.close()
    page, context, fixture = open_page(dict(id=3, username="super", role="production_user", is_superuser=True, module_permissions={}))
    expect(page.get_by_role("heading", name="Transfer Configuration", exact=True)).to_be_visible()
    checks += 1
    context.close()
    browser.close()
print(f"Rendered Transfer Policy UI: {checks} checks passed; all APIs intercepted.")
print(f"Screenshots: {artifact_dir}")
