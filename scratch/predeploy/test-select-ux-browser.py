"""Actual shared controls in Chrome; bounded API fixtures, never operational writes.

Run Vite at 127.0.0.1:5188. The test entry is not part of the production build.
"""
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

USER = {'id': 1, 'username': 'ux-fixture', 'role': 'admin', 'is_superuser': True}
calls, errors = [], []
failed_once = False

def handle(route):
    global failed_once
    request = route.request
    parsed = urlparse(request.url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    headers = {'Access-Control-Allow-Origin': 'http://127.0.0.1:5188', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*'}
    def respond(data, status=200):
        route.fulfill(status=status, content_type='application/json', headers=headers, body=json.dumps(data))
    if request.method == 'OPTIONS':
        respond({}); return
    assert request.method == 'GET', 'Selection tests cannot write documents.'
    calls.append((parsed.path, params))
    if parsed.path.endswith('/me/'):
        respond({'data': USER}); return
    assert params.get('lookup') == ['1'], (parsed.path, params)
    assert params.get('limit') == ['25']
    offset = int(params.get('offset', ['0'])[0])
    query = params.get('search', [''])[0]
    if query == 'FAIL' and not failed_once:
        failed_once = True
        respond({'error': 'Fixture unavailable'}, 503); return
    if parsed.path.endswith('/warehouses/'):
        collection = 'warehouses'
        rows = [{'code': f'W{i:03}', 'name': f'Warehouse {i:03}'} for i in range(1, 71)]
    elif '/bin-locations/' in parsed.path:
        collection = 'locations'
        warehouse = parsed.path.rstrip('/').split('/')[-1]
        rows = [{'absEntry': i, 'code': f'{warehouse}-B{i:03}', 'name': f'Bin {i:03}', 'warehouse': warehouse,
                 'is_system_bin': i == 1, 'inactive': i == 2} for i in range(1, 41)]
    elif parsed.path.endswith('/admin/users/'):
        assert params['module'] == ['transfer'] and params['level'] == ['USER']
        collection = 'users'
        rows = [{'id': i, 'username': f'Operator {i:03}'} for i in range(1, 61)]
    elif parsed.path.endswith('/customers/'):
        assert len(query) >= 2 and 'initial' not in params
        collection = 'customers'
        rows = [{'card_code': f'C{i:03}', 'card_name': f'Buyer {i:03}'} for i in range(1, 61)]
    elif parsed.path.endswith('/items/'):
        assert len(query) >= 2 and 'initial' not in params
        collection = 'items'
        rows = [{'item_code': f'I{i:03}', 'item_name': f'Fruit {i:03}', 'sales_unit': 'KG'} for i in range(1, 61)]
    else:
        raise AssertionError(f'Unexpected API: {parsed.path}')
    if query and query != 'FAIL':
        rows = [row for row in rows if query.casefold() in str(row).casefold()]
    page = rows[offset:offset + 25]
    respond({'data': {collection: page, 'next_offset': offset + 25 if len(rows) > offset + 25 else None}})

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    context = browser.new_context(viewport={'width': 1100, 'height': 1100})
    context.add_init_script("localStorage.setItem('app-lang','en');localStorage.setItem('app-theme','light');localStorage.setItem('auth_user', " + json.dumps(json.dumps(USER)) + ");")
    context.route('**/api/**', handle)
    def entry(route):
        response = route.fetch()
        html = re.sub(r'<script type="module" src="/src/main\.jsx[^"\n]*"></script>', '<script type="module">await new Promise(resolve=>setTimeout(resolve,500));await import("/scripts/fixtures/select-ux-harness.jsx");</script>', response.text())
        route.fulfill(response=response, body=html)
    context.route('**/__select-ux-test__', entry)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(error.stack or str(error)))
    page.goto('http://127.0.0.1:5188/__select-ux-test__')
    stage = page.get_by_role('combobox', name='Stage', exact=True)
    expect(stage).to_be_visible()
    assert stage.evaluate('(node)=>node.tagName') == 'SELECT'
    assert stage.locator('option').count() == 3
    stage.select_option('S2')
    values = lambda: json.loads(page.get_by_test_id('values').inner_text())
    assert values()['stage'] == 'S2'
    page.get_by_role('combobox', name='Roles', exact=True).click()
    assert page.get_by_role('listbox').get_by_role('option').count() == 2
    page.get_by_role('option', name='Quality', exact=True).click()
    page.keyboard.press('Escape')
    assert values()['roles'] == ['transfer', 'quality']

    warehouse = page.get_by_role('combobox', name='Warehouse', exact=True)
    assert not any(path.endswith('/warehouses/') for path, _ in calls)
    warehouse.click()
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    page.get_by_role('listbox').evaluate('(list)=>{list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event("scroll"));}')
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(50)
    page.get_by_role('option', name='W031', exact=False).click()
    assert values()['warehouse'] == 'W031'
    warehouse.fill('EMPTY')
    expect(page.locator('.MuiAutocomplete-noOptions')).to_contain_text('No')
    page.keyboard.press('Escape')
    assert values()['warehouse'] == 'W031'
    expect(warehouse).to_have_value('W031 - Warehouse 031')
    warehouse.fill('FAIL')
    retry = page.locator('.MuiAutocomplete-noOptions').get_by_role('button', name='Retry')
    expect(retry).to_be_visible()
    retry.click()
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    page.keyboard.press('Escape')

    bin_field = page.get_by_role('combobox', name='Bin', exact=True)
    bin_field.click()
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    expect(page.get_by_role('option', name='W031-B001', exact=False)).to_have_attribute('aria-disabled', 'true')
    bin_field.press('ArrowDown')
    bin_field.press('Enter')
    assert values()['bin'] == '4', values()
    warehouse.fill('W002')
    page.get_by_role('option', name='W002', exact=False).click()
    assert values()['bin'] == ''
    bin_field.click()
    expect(page.get_by_role('option', name='W002-B003', exact=False)).to_be_visible()
    assert page.get_by_role('option', name='W031', exact=False).count() == 0
    page.keyboard.press('Escape')
    user = page.get_by_role('combobox', name='User', exact=True)
    user.click()
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    user.press('ArrowDown'); user.press('Enter')
    assert values()['user'] == '2'

    customer = page.get_by_role('combobox', name='Customer', exact=True)
    customer.click()
    expect(page.locator('.MuiAutocomplete-noOptions')).to_contain_text('at least 2')
    customer.fill('B')
    page.wait_for_timeout(350)
    assert not any(path.endswith('/customers/') for path, _ in calls)
    customer.fill('Buyer')
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    page.get_by_role('listbox').evaluate('(list)=>{list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event("scroll"));}')
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(50)
    page.get_by_role('option', name='C032', exact=False).click()
    assert values()['customer'] == 'C032'
    customer.fill('EMPTY')
    expect(page.locator('.MuiAutocomplete-noOptions')).to_be_visible()
    customer.fill('Buyer')
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    assert sum(path.endswith('/customers/') and params['search'] == ['Buyer'] for path, params in calls) == 2
    page.keyboard.press('Escape')
    assert values()['customer'] == 'C032'
    item = page.get_by_role('combobox', name='Item', exact=True)
    item.fill('Fruit')
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    item.press('ArrowDown'); item.press('Enter')
    assert values()['item']['item_code'] == 'I002', values()
    assert values()['item']['sales_unit'] == 'KG'
    for field in ['Location', 'General']:
        page.get_by_role('combobox', name=field, exact=True).click()
        expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(2)
        page.keyboard.press('Escape')
    assert values()['location'] == 'L1' and values()['general'] == 'G1'
    context.add_init_script("localStorage.setItem('app-lang','ar');localStorage.setItem('app-theme','dark');")
    page.set_viewport_size({'width': 320, 'height': 1100})
    page.reload()
    expect(page.get_by_role('combobox', name='Warehouse', exact=True)).to_be_visible()
    page.evaluate("document.documentElement.dir='rtl';document.documentElement.dataset.theme='dark'")
    page.get_by_role('combobox', name='Warehouse', exact=True).click()
    expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(25)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
    Path('scratch').mkdir(exist_ok=True)
    page.screenshot(path='scratch/predeploy/extra/select-ux-rtl-dark-320.png', full_page=True)
    assert not errors, errors
    browser.close()
print('PASS: fixed/multiple choices, initial browse, 25-row pagination, keyboard, retry, selection retention, parent bins, name/code search, cache, metadata, Location/General, RTL/dark/mobile; no API writes.')
