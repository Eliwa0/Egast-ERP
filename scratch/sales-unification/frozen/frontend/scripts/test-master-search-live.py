"""Read-only authenticated verification against the user's running app, no API mocks."""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
import django
django.setup()
from django.contrib.auth import get_user_model, SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
from django.contrib.sessions.backends.db import SessionStore
from playwright.sync_api import sync_playwright, expect

user = get_user_model().objects.filter(is_active=True, is_superuser=True).first()
assert user, 'An existing active administrator is needed for authenticated verification.'
session = SessionStore()
session[SESSION_KEY] = str(user.pk)
session[BACKEND_SESSION_KEY] = 'django.contrib.auth.backends.ModelBackend'
session[HASH_SESSION_KEY] = user.get_session_auth_hash()
session.save()
reports = []
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
        context = browser.new_context(viewport={'width': 1400, 'height': 950})
        context.add_cookies([{'name': 'sessionid', 'value': session.session_key, 'domain': 'localhost', 'path': '/', 'httpOnly': True, 'sameSite': 'Lax'}])
        page = context.new_page()
        errors = []
        writes = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: writes.append(request.url) if ':8000/api/' in request.url and request.method != 'GET' else None)
        page.goto('http://localhost:5173/login')
        page.wait_for_timeout(1800)
        for route in ['/create-user', '/customization-delivery/quotations/new', '/grpo/manual/new', '/transfer/configuration']:
            responses = []
            def record(response):
                if ':8000/api/' not in response.url:
                    return
                try:
                    body = response.body()
                    payload = response.json()
                    arrays = {}
                    def scan(value, prefix=''):
                        if isinstance(value, list):
                            arrays[prefix] = len(value)
                        elif isinstance(value, dict):
                            for key, entry in value.items():
                                scan(entry, prefix + '.' + key)
                    scan(payload)
                    responses.append({'url': response.url.split('/api/')[-1], 'status': response.status, 'bytes': len(body), 'records': arrays})
                except Exception:
                    pass
            page.on('response', record)
            started = time.perf_counter()
            page.goto('http://localhost:5173' + route)
            page.wait_for_timeout(9000)
            page.remove_listener('response', record)
            row = {'route': route, 'observation_window_ms': round((time.perf_counter() - started) * 1000),
                   'dom_content_loaded_ms': page.evaluate('performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd'), 'requests': responses}
            reports.append(row)
            assert not any(record['url'].startswith('warehouses/') and 'lookup=' not in record['url'] for record in responses), route
            print(json.dumps(row), flush=True)

        page.goto('http://localhost:5173/create-user')
        field = page.get_by_role('combobox').first
        field.wait_for()
        lookup_requests = []
        page.on('request', lambda request: lookup_requests.append(request.url) if '/api/warehouses/' in request.url else None)
        field.fill('2')
        page.wait_for_timeout(400)
        assert not lookup_requests, 'Minimum length must prevent SAP requests.'
        field.fill('20')
        page.wait_for_timeout(40)
        field.fill('202')
        with page.expect_response(lambda response: '/api/warehouses/' in response.url and 'search=202' in response.url, timeout=65000) as result:
            pass
        response = result.value
        assert response.status == 200, response.text()
        warehouses = response.json()['data']['warehouses']
        assert 0 < len(warehouses) <= 25
        assert len(lookup_requests) == 1, lookup_requests
        field.press('ArrowDown')
        field.press('Enter')
        assert field.input_value(), 'Keyboard selection failed.'
        before = len(lookup_requests)
        clear = field.locator("xpath=ancestor::div[contains(@class, 'MuiAutocomplete-root')][1]").get_by_role('button', name='Clear')
        clear.click()
        field.fill('202')
        page.wait_for_timeout(600)
        assert len(lookup_requests) == before, 'The same query should reuse cached results.'

        page.locator('.lang-toggle-btn').click()
        page.locator('.theme-fab').click()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(400)
        assert page.evaluate('document.documentElement.dir') == 'rtl'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        field.fill('202')
        expect(page.get_by_role('option').first).to_be_visible()
        assert page.locator('.searchable-select__popper').evaluate('(node) => getComputedStyle(node).direction') == 'rtl'
        page.screenshot(path=str(ROOT / 'scratch/master-search-live-ar-dark-mobile.png'), full_page=True)

        policy_response = context.request.get('http://localhost:8000/api/transfer/policies/effective/')
        assert policy_response.status == 200
        page.goto('http://localhost:5173/transfer/configuration')
        expect(page.locator('.transfer-policy-stage')).to_have_count(3, timeout=65000)
        page.screenshot(path=str(ROOT / 'scratch/master-search-policy-live.png'), full_page=True)
        assert not errors, errors
        assert not writes, writes
        api_checks = []
        for endpoint, collection, search in [
            ('warehouses/', 'warehouses', '202'),
            ('transfer/warehouses/', 'warehouses', '202'),
            ('bin-locations/20201/', 'locations', '20201'),
            ('quality/items/', 'items', '27'),
            ('quality/farms/', 'farms', '27'),
            ('quality/contractors/', 'contractors', '27'),
            ('scale/master-data/items/', 'items', '27'),
            ('scale/master-data/farms/', 'farms', '27'),
            ('customization-delivery/customers/', 'customers', '10'),
            ('customization-delivery/items/', 'items', '27'),
            ('admin/users/', 'users', user.username[:2]),
        ]:
            lookup = context.request.get('http://localhost:8000/api/' + endpoint,
                                         params={'lookup': 1, 'search': search, 'limit': 2}, timeout=65000)
            assert lookup.status == 200, f'{endpoint}: {lookup.status}: {lookup.text()}'
            payload = lookup.json()
            rows = payload.get('data', payload)[collection]
            assert len(rows) <= 2, endpoint
            api_checks.append({'endpoint': endpoint, 'status': lookup.status, 'records': len(rows)})
            print(json.dumps(api_checks[-1]), flush=True)
        reports.append({'verification': 'actual Chrome, no mocks', 'search_status': response.status,
                        'search_records': len(warehouses), 'search_bytes': len(response.body()),
                        'debounced_requests': before, 'same_query_extra_requests': len(lookup_requests) - before,
                        'rtl_dark_mobile': True, 'javascript_errors': errors, 'api_writes': writes,
                        'authenticated_api_checks': api_checks})
        browser.close()
finally:
    session.delete()
    (ROOT / 'scratch/dropdown-performance-after.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
