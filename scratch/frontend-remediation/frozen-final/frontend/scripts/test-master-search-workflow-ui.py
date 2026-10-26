"""Chrome workflow fixtures: selection metadata, bounded search, error/empty states.

All API requests are intercepted. No operational database or SAP writes occur.
Run Vite on 127.0.0.1:5189 before this script.
"""
import json
import os
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ORIGIN = os.environ.get('TEST_FRONTEND_ORIGIN', 'http://127.0.0.1:5189').rstrip('/')

USER = {'id': 1, 'username': 'search-fixture', 'role': 'admin', 'is_superuser': True}
calls, errors = [], []

def handle(route):
    request = route.request
    parsed = urlparse(request.url)
    params = parse_qs(parsed.query)
    headers = {'Access-Control-Allow-Origin': ORIGIN,
               'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*'}
    def respond(payload, status=200):
        route.fulfill(status=status, content_type='application/json', headers=headers, body=json.dumps(payload))
    if request.method == 'OPTIONS':
        respond({}); return
    assert request.method == 'GET', 'This test must not save or post a document.'
    calls.append((parsed.path, params))
    if parsed.path.endswith('/me/'):
        respond({'data': USER}); return
    if parsed.path.endswith('/customers/'):
        assert params.get('lookup') == ['1']
        assert len(params['search'][0]) >= 2
        respond({'success': True, 'customers': [{'card_code': 'C001', 'card_name': 'Fixture Buyer',
            'currency': 'USD', 'price_list_num': 2, 'payment_group_code': 1,
            'payment_terms_additional_days': 3, 'addresses': []}]}); return
    if parsed.path.endswith('/items/'):
        assert params.get('lookup') == ['1']
        assert params.get('price_list') == ['2']
        query = params['search'][0]
        if query == 'FAIL':
            respond({'success': False, 'error': 'SAP unavailable'}, 503); return
        respond({'success': True, 'items': [] if query == 'EMPTY' else [
            {'item_code': '270001', 'item_name': 'Fixture Fruit', 'sales_unit': 'KG',
             'default_price': 12.5, 'price_currency': 'USD', 'uom_entry': 7, 'sales_vat_group': 'T1'}]}); return
    if parsed.path.endswith('/quotation-metadata/'):
        respond({'line_fields': {}, 'header_fields': {}, 'system_fields': {}}); return
    if parsed.path.endswith('/tax-codes/'):
        respond({'data': {'tax_codes': [{'code': 'T1', 'name': 'Tax', 'rate': 14}]}}); return
    respond({'data': {}})

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    context = browser.new_context(viewport={'width': 1400, 'height': 950})
    context.add_init_script("localStorage.setItem('app-lang','en');localStorage.setItem('app-theme','light');localStorage.setItem('auth_user', " + json.dumps(json.dumps(USER)) + ");")
    context.route('**/api/**', handle)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(ORIGIN + '/customization-delivery/quotations/new')
    customer = page.get_by_role('combobox').first
    expect(customer).to_be_visible()
    assert not any(path.endswith(('/customers/', '/items/')) for path, _ in calls)
    customer.fill('Bu')
    page.get_by_role('option', name='C001', exact=False).click()
    expect(page.get_by_text('Fixture Buyer', exact=False).first).to_be_visible()
    expect(page.get_by_role('button', name='Continue to Items', exact=True)).to_be_enabled()
    assert sum(path.endswith('/customers/') for path, _ in calls) == 1
    assert not any(path.endswith('/items/') for path, _ in calls), 'Selection must not load an item catalog.'
    page.get_by_role('button', name='Continue to Items', exact=True).click()
    item = page.get_by_role('combobox').first
    item.fill('Fr')
    page.get_by_role('option', name='270001', exact=False).click()
    expect(page.get_by_role('button', name='Add Item', exact=True)).to_be_enabled()
    item.fill('EMPTY')
    expect(page.locator('.MuiAutocomplete-noOptions')).to_be_visible()
    page.keyboard.press('Escape')
    page.get_by_role('button', name='Add Item', exact=True).click()
    added_row = page.locator('tbody tr').filter(has_text='270001')
    expect(added_row).to_have_count(1)
    expect(added_row.locator('strong').first).to_contain_text('Fixture Fruit')
    expect(added_row.locator('input[value="12.5"]')).to_be_visible()
    item.fill('FAIL')
    expect(page.locator('.MuiAutocomplete-noOptions')).to_contain_text('Search failed')
    page.keyboard.press('Escape')
    item.fill('Fr')
    expect(page.get_by_role('option', name='270001', exact=False)).to_be_visible()
    assert sum(path.endswith('/items/') for path, _ in calls) == 3, 'Repeat search must reuse its result.'
    assert not errors, errors
    browser.close()
print('Sales workflow UI: customer metadata, price-list scope, retained item price/UOM, empty/error states, cached retry, and no catalog/detail/write requests passed.')
