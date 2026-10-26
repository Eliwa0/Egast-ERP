"""Real React -> real Django views/services/models -> mocked SAP transport.

An isolated temporary test database only; no operational DB or live SAP access.
Run a separate Vite server at 127.0.0.1:5189 with console forwarding disabled.
"""
import json
import os
import re
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr = sys.stdout

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
os.environ['DJANGO_ALLOW_ASYNC_UNSAFE'] = 'true'  # Synchronous Playwright fixture callbacks only.
os.environ['PW_TEST_SCREENSHOT_NO_FONTS_READY'] = '1'  # Preserve evidence even if a popup font never settles.
from django.conf import settings
test_database = tempfile.TemporaryDirectory(prefix='sales-journey-db-', dir=ROOT / 'scratch', ignore_cleanup_errors=True)
settings.DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': str(Path(test_database.name) / 'fixture.sqlite3')}}
settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
settings.ALLOWED_HOSTS = ['testserver']
import django
django.setup()
from django.core.management import call_command
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.models_delivery import DeliveryDraft, DeliveryDraftLine
from api.models_customization import CustomizationDraft, CustomizationDraftLine
from playwright.sync_api import sync_playwright, expect

call_command('migrate', verbosity=0, interactive=False)
admin = User.objects.create_superuser('browser-journey', password='fixture')
client = APIClient()
client.force_login(admin)
client.force_authenticate(admin)
USER = {'id': admin.id, 'username': admin.username, 'role': 'admin', 'is_superuser': True}
documents, posted_documents, calls, sap_calls, errors = {}, {}, [], [], []
fail_next_quotation = False
reject_next_quotation = False
delayed_search = False
delayed_responses = []
lose_next_order_response = False
lose_next_quotation_response = False

def sap_request(_self, method, endpoint, data=None, **_kwargs):
    global fail_next_quotation, reject_next_quotation, lose_next_order_response, lose_next_quotation_response
    sap_calls.append({'method': method, 'endpoint': endpoint, 'payload': deepcopy(data)})
    if method == 'POST' and endpoint == 'Quotations' and reject_next_quotation:
        reject_next_quotation = False
        return {'error': {'code': -1, 'message': {'value': 'Definitive fixture rejection'}}}
    if method == 'POST' and endpoint == 'Quotations' and fail_next_quotation:
        fail_next_quotation = False
        return {'error': 'Connection timed out; posting outcome unknown'}
    entity = endpoint.split('?')[0]
    if method == 'POST' and entity in ['Quotations', 'Orders', 'DeliveryNotes']:
        index = ['Quotations', 'Orders', 'DeliveryNotes'].index(entity) + 1
        lines = []
        for i, submitted in enumerate(data['DocumentLines']):
            base = {}
            if submitted.get('BaseType'):
                base_entity = 'Quotations' if submitted['BaseType'] == 23 else 'Orders'
                base = deepcopy(documents[base_entity]['DocumentLines'][submitted['BaseLine']])
            line = {**base, **deepcopy(submitted), 'LineNum': i}
            line.setdefault('ItemCode', 'FRUIT')
            line.setdefault('ItemDescription', 'Fixture Fruit with a long distinctive description')
            line.setdefault('WarehouseCode', 'WH')
            line.setdefault('UoMCode', 'KG')
            line.setdefault('UnitPrice', 24)
            line['LineTotal'] = line['Quantity'] * line['UnitPrice'] * (1 - line.get('DiscountPercent', 0) / 100)
            line['RemainingOpenQuantity'] = line['Quantity']
            line['LineStatus'] = 'bost_Open'
            lines.append(line)
        currency = data.get('DocCurrency') or documents.get('Orders', {}).get('DocCurrency') or 'USD'
        sequence = sum(key[0] == entity for key in posted_documents)
        document = {**deepcopy(data), 'DocEntry': index * 1001 + sequence, 'DocNum': index * 1000 + 4001 + sequence,
            'CardName': 'Fixture Buyer with a long customer name', 'DocCurrency': currency,
            'DocumentStatus': 'bost_Open', 'DocumentLines': lines, 'DocTotal': sum(line['LineTotal'] for line in lines)}
        documents[entity] = document
        posted_documents[(entity, document['DocEntry'])] = document
        if entity == 'Orders' and lose_next_order_response:
            lose_next_order_response = False
            return {'error': 'Response lost after successful SAP creation'}
        if entity == 'Quotations' and lose_next_quotation_response:
            lose_next_quotation_response = False
            return {'error': 'Response lost after successful SAP creation'}
        if entity == 'DeliveryNotes':
            for line in lines:
                order_line = documents['Orders']['DocumentLines'][line['BaseLine']]
                order_line['RemainingOpenQuantity'] -= line['Quantity']
                order_line['DeliveredQuantity'] = order_line['Quantity'] - order_line['RemainingOpenQuantity']
                if order_line['RemainingOpenQuantity'] == 0:
                    order_line['LineStatus'] = 'bost_Close'
        return deepcopy(document)
    for entity in ['Quotations', 'Orders', 'DeliveryNotes']:
        if endpoint.startswith(entity + '('):
            entry = int(endpoint.split('(')[1].split(')')[0])
            return deepcopy(posted_documents.get((entity, entry), {'error': {'message': {'value': 'Not found'}}}))
        if endpoint.startswith(entity + '?'):
            marker = re.search(r'\[AppPost:[a-f0-9]+\]', endpoint)
            return {'value': [deepcopy(doc) for (kind, _), doc in posted_documents.items()
                if kind == entity and (not marker or marker.group() in doc.get('Comments', ''))][:2]}
    if endpoint.startswith('BusinessPartners?'):
        return {'value': [{'CardCode': 'C001', 'CardName': 'Fixture Buyer with a long customer name',
            'Currency': 'EGP', 'PriceListNum': 2, 'PayTermsGrpCode': 1, 'BPAddresses': []}]}
    if endpoint.startswith('Items?'):
        return {'value': [{'ItemCode': 'FRUIT', 'ItemName': 'Fixture Fruit with a long distinctive description',
            'SalesUnit': 'KG', 'DefaultSalesUoMEntry': 7, 'DefaultWarehouse': 'WH', 'SalesVATGroup': 'T0',
            'ItemPrices': [{'PriceList': 2, 'Price': 24, 'Currency': 'USD'}]}]}
    if endpoint.startswith('Warehouses?'):
        return {'value': [{'WarehouseCode': 'WH', 'WarehouseName': 'Fixture warehouse', 'Inactive': 'tNO'}]}
    if endpoint.startswith('BinLocations?'):
        return {'value': [{'BinCode': 'WH-PHYSICAL', 'Warehouse': 'WH', 'AbsEntry': 11, 'Inactive': 'tNO', 'IsSystemBin': 'tNO'}]}
    return {'value': []}

def handle(route):
    request = route.request
    parsed = urlparse(request.url)
    path, params = parsed.path, parse_qs(parsed.query)
    headers = {'Access-Control-Allow-Origin': 'http://127.0.0.1:5189', 'Access-Control-Allow-Credentials': 'true',
               'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'}
    def respond(payload, status=200):
        route.fulfill(status=status, content_type='application/json', headers=headers, body=json.dumps(payload, default=str))
    if request.method == 'OPTIONS':
        respond({}); return
    payload = json.loads(request.post_data) if request.post_data else None
    calls.append({'method': request.method, 'path': path, 'params': params, 'payload': payload})
    if path.endswith('/me/'):
        respond({'data': USER}); return
    if path.endswith('/quotation-metadata/'):
        respond({'line_fields': {}, 'header_fields': {}, 'system_fields': {}}); return
    if path.endswith('/quotation-context/'):
        respond({'exchange_rate': 1, 'currency': 'USD'}); return
    if path.endswith('/tax-codes/'):
        respond({'data': {'tax_codes': [{'code': 'T0', 'name': 'Fixture Zero Tax', 'rate': 0}]}}); return
    if '/cost-centers' in path:
        respond({'data': {'cost_centers': [{'code': 'CC', 'name': 'Fixture cost center'}]}}); return
    if request.method == 'GET':
        response = client.get(path + ('?' + parsed.query if parsed.query else ''))
    else:
        response = getattr(client, request.method.lower())(path, payload or {}, format='json')
    if response.streaming:
        route.fulfill(status=response.status_code, content_type=response.headers['Content-Type'], headers=headers,
            body=b''.join(response.streaming_content))
        return
    if delayed_search and params.get('search') == ['Performance 00002'] and path.endswith('/customization/drafts/'):
        delayed_responses.append((route, response, headers))
        return
    assert response.headers.get('Content-Type', '').startswith('application/json'), (path, response.status_code, response.content[:300])
    respond(json.loads(response.content), response.status_code)

def snapshot(page, name):
    artifact = ROOT / 'scratch' / 'sales-journey'
    artifact.mkdir(exist_ok=True)
    page.screenshot(path=str(artifact / f'{name}.png'), full_page=True)
    overflow = page.evaluate("""[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1 && r.width>0 && getComputedStyle(e).position!=='fixed'}).map(e=>({tag:e.tagName,css:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).slice(0,20)""")
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), (name, page.viewport_size, overflow)

def print_check(page, button, expected_number, item=True):
    with page.expect_popup() as popup:
        button.click()
    printed = popup.value
    printed.bring_to_front()
    printed.on('requestfailed', lambda req: print('PRINT FAILED REQUEST', req.url, req.failure, flush=True))
    expect(printed.locator('body')).to_contain_text(str(expected_number))
    expect(printed.locator('body')).to_contain_text('Fixture Buyer')
    if item:
        expect(printed.locator('body')).to_contain_text('FRUIT')
    assert 'EGP' not in printed.locator('body').inner_text()
    expect(printed.locator('body')).to_contain_text('USD')
    assert printed.locator('html').get_attribute('dir') == 'ltr'
    assert printed.url.startswith('blob:'), printed.url
    try:
        printed.wait_for_function('document.documentElement.dataset.printInvoked === "true" && document.documentElement.dataset.printAssets', timeout=15000)
    except Exception:
        print('PRINT DIAGNOSTIC', printed.evaluate('({ready:window.__printReady,verified:window.__printVerified,assets:window.__printAssets,fonts:document.fonts.status,images:[...document.images].map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth})),state:document.readyState,scripts:[...document.scripts].map(s=>s.textContent.slice(0,500)),alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.textContent)})'), flush=True)
        raise
    verified_assets = json.loads(printed.locator('html').get_attribute('data-print-assets'))
    assert verified_assets['ready'] and verified_assets['fonts'] == 'loaded' and verified_assets['images'] and all(verified_assets['images']), verified_assets
    printed.emulate_media(media='print')
    printed.evaluate('document.body.getBoundingClientRect()')
    printed.screenshot(path=str(ROOT / f'scratch/sales-journey/print-{expected_number}.png'), full_page=True, timeout=15000)
    print('PRINT VERIFIED BEFORE NATIVE CALL', verified_assets, flush=True)
    (ROOT / f'scratch/sales-journey/print-{expected_number}.html').write_text(printed.content(), encoding='utf-8')
    printed.close()
    page.bring_to_front()

with patch('api.services.sap_service.SAPServiceLayer._request', sap_request), \
        patch('api.services.sap_service.SAPServiceLayer.execute_sql_query', return_value={'value': [{'BatchNumber': 'PAL-001', 'WhsCode': 'WH', 'OnHandQty': 250, 'BinAbsEntry': 11, 'BinCode': 'WH-PHYSICAL'}]}), \
        patch('api.customization_views._get_octg_terms_map', return_value={1: 'Cash'}), \
        patch('api.customization_views._get_payment_terms_details', return_value={1: {}}), \
        patch('requests.sessions.Session.request', side_effect=AssertionError('Live SAP HTTP forbidden')), sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100})
    context.add_init_script("localStorage.setItem('app-lang','en');localStorage.setItem('app-theme','light');localStorage.setItem('auth_user', " + json.dumps(json.dumps(USER)) + ");window.print=()=>document.documentElement.setAttribute('data-print-invoked','true');")
    context.route('**/api/**', handle)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations/new')
    page.get_by_role('combobox').first.fill('Buyer')
    page.get_by_role('option', name='C001', exact=False).click()
    page.get_by_role('button', name='Continue to Items', exact=True).click()
    page.get_by_role('combobox').first.fill('Fruit')
    page.get_by_role('option', name='FRUIT', exact=False).click()
    page.get_by_role('button', name='Add Item', exact=True).click()
    page.locator('tbody input[type=number]').nth(0).fill('250')
    page.set_viewport_size({'width':390,'height':1000})
    snapshot(page, 'quotation-items-mobile')
    expect(page.get_by_text('USD 6000.00', exact=False).first).to_be_visible()
    for step in range(4):
        page.get_by_role('button', name=re.compile('^Continue to ')).last.click()
        snapshot(page, f'quotation-step-{step}-mobile')
    page.set_viewport_size({'width':1440,'height':1100})
    snapshot(page, 'quotation-review')
    page.get_by_role('button', name=re.compile('Create.*Quotation|Create in SAP')).last.click()
    expect(page.get_by_text('Sales Quotation Created in SAP Business One Successfully!', exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':1000})
    snapshot(page, 'quotation-success-mobile')
    page.set_viewport_size({'width':1440,'height':1100})
    assert documents['Quotations']['DocCurrency'] == 'USD'
    assert documents['Quotations']['DocTotal'] == 6000
    assert documents['Quotations']['DocumentLines'][0]['Quantity'] == 250
    page.reload()
    expect(page.get_by_text('Sales Quotation Created in SAP Business One Successfully!', exact=True)).to_be_visible()
    assert sum(c['method'] == 'POST' and c['endpoint'] == 'Quotations' for c in sap_calls) == 1
    print_check(page, page.get_by_role('button', name='Print Quotation', exact=True), 5001)
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations/documents/1001')
    expect(page.locator('body')).to_contain_text('5001')
    expect(page.locator('body')).to_contain_text('USD')
    page.reload()
    expect(page.locator('body')).to_contain_text('USD')
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations')
    lose_next_order_response = True
    page.get_by_role('button', name='Create Sales Order in SAP', exact=True).first.click()
    expect(page.locator('body')).to_contain_text('Checking document status')
    page.reload()
    page.get_by_role('button', name=re.compile('Check.*Status|Check.*SAP', re.I)).first.click()
    expect(page.get_by_text('Sales Order Created Successfully in SAP!', exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':1000})
    snapshot(page, 'order-success-modal-mobile')
    page.set_viewport_size({'width':1440,'height':1100})
    assert documents['Orders']['CardCode'] == 'C001'
    assert documents['Orders']['DocCurrency'] == 'USD'
    line = documents['Orders']['DocumentLines'][0]
    assert (line['BaseType'], line['BaseEntry'], line['BaseLine'], line['Quantity'], line['UnitPrice'], line['WarehouseCode']) == (23, 1001, 0, 250, 24, 'WH')
    assert not DeliveryDraft.objects.exists()
    assert sum(c['method'] == 'POST' and c['endpoint'] == 'Orders' for c in sap_calls) == 1
    assert not any(call['endpoint'] == 'DeliveryNotes' for call in sap_calls)
    assert not any(call['method'] == 'POST' and '/delivery/drafts/' in call['path'] for call in calls)
    print_check(page, page.get_by_role('button', name='Print Sales Order', exact=True), 6001)
    page.get_by_role('button', name='Go to Sales Orders', exact=True).click()
    expect(page.get_by_role('heading', name=re.compile('Sales Orders'))).to_be_visible()
    print_check(page, page.get_by_role('button', name='Print Sales Order', exact=True).first, 6001)
    page.goto('http://127.0.0.1:5189/customization-delivery/deliveries')
    assert not DeliveryDraft.objects.exists()
    snapshot(page, 'delivery-orders')
    page.get_by_role('button', name='Create Delivery Note in SAP', exact=True).first.click()
    page.get_by_role('button', name='Continue to Quantities', exact=True).click()
    page.get_by_role('button', name='Continue to Batches', exact=True).click()
    combo = page.get_by_role('combobox').first
    combo.fill('PAL')
    page.get_by_role('option', name='PAL-001', exact=False).click()
    # The selected batch's quantity input starts empty; allocation is explicit.
    page.locator('input[type=number]').last.fill('250')
    page.get_by_role('button', name='Continue to Bin Locations', exact=True).click()
    page.get_by_role('button', name='Continue to Cost Centers', exact=True).click()
    page.get_by_role('button', name='Continue to Review', exact=True).click()
    for width, name in [(768, 'tablet'), (390, 'mobile')]:
        page.set_viewport_size({'width': width, 'height': 1000})
        snapshot(page, f'delivery-review-{name}')
    page.set_viewport_size({'width': 1440, 'height': 1100})
    rtl_context = browser.new_context(viewport={'width': 390, 'height': 1000})
    rtl_context.add_init_script("localStorage.setItem('app-lang','ar');localStorage.setItem('app-theme','dark');localStorage.setItem('auth_user', " + json.dumps(json.dumps(USER)) + ");")
    rtl_context.route('**/api/**', handle)
    rtl_page = rtl_context.new_page()
    rtl_page.on('pageerror', lambda error: errors.append(str(error)))
    responsive = []
    for route_name, suffix in [('quotation', 'quotations/documents/1001'), ('order', 'orders/documents/2002'), ('delivery', 'deliveries/new/2002')]:
        rtl_page.goto('http://127.0.0.1:5189/customization-delivery/' + suffix)
        expect(rtl_page.locator('body')).to_contain_text('Fixture Buyer')
        assert rtl_page.locator('html').get_attribute('dir') == 'rtl'
        for width in [1440, 768, 390]:
            rtl_page.set_viewport_size({'width': width, 'height': 1000})
            snapshot(rtl_page, f'{route_name}-rtl-dark-{width}')
            responsive.append({'module': route_name, 'rtl': True, 'dark': True, 'width': width,
                               'scrollWidth': rtl_page.evaluate('document.documentElement.scrollWidth')})
    rtl_page.goto('http://127.0.0.1:5189/customization-delivery/quotations/new')
    rtl_page.get_by_role('combobox').first.fill('Buyer')
    rtl_page.get_by_role('option', name='C001', exact=False).click()
    snapshot(rtl_page, 'quotation-customer-rtl-dark-mobile')
    rtl_page.locator('.sales-readiness-workflow button.app-button--primary').last.click()
    rtl_page.get_by_role('combobox').first.fill('Fruit')
    rtl_page.get_by_role('option', name='FRUIT', exact=False).click()
    rtl_page.locator('.sales-readiness-workflow button.app-button--primary').first.click()
    rtl_page.locator('tbody input[type=number]').nth(0).fill('250')
    snapshot(rtl_page, 'quotation-items-rtl-dark-mobile')
    for step in range(4):
        rtl_page.locator('.sales-readiness-workflow button.app-button--primary').last.click()
        snapshot(rtl_page, f'quotation-step-{step}-rtl-dark-mobile')
    rtl_context.close()
    snapshot(page, 'delivery-review')
    assert not any(call['endpoint'] == 'DeliveryNotes' for call in sap_calls)
    page.get_by_role('button', name='Submit Draft for Review', exact=True).click()
    page.wait_for_function("document.body.innerText.includes('submitted for review') || document.body.innerText.includes('Submitted for Review')")
    page.reload()
    expect(page.get_by_role('button', name='Approve & Post to SAP', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Back', exact=True)).to_be_disabled()
    page.get_by_role('button', name='Approve & Post to SAP', exact=True).click()
    expect(page.get_by_role('heading', name='Delivery Note Created Successfully in SAP!', exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':1000})
    snapshot(page, 'delivery-success-mobile')
    page.set_viewport_size({'width':1440,'height':1100})
    delivery = documents['DeliveryNotes']
    assert delivery['DocCurrency'] == 'USD'
    line = delivery['DocumentLines'][0]
    assert (line['BaseType'], line['BaseEntry'], line['BaseLine'], line['Quantity'], line['WarehouseCode']) == (17, 2002, 0, 250, 'WH')
    assert line['BatchNumbers'] == [{'BatchNumber': 'PAL-001', 'Quantity': 250}]
    assert line['DocumentLinesBinAllocations'][0]['BinAbsEntry'] == 11
    print_check(page, page.get_by_role('button', name=re.compile('Print Delivery')).first, 7001)
    assert sum(call['method'] == 'POST' and call['endpoint'] == 'DeliveryNotes' for call in sap_calls) == 1
    page.goto('http://127.0.0.1:5189/customization-delivery/review')
    expect(page.locator('.badge').filter(has_text='Fully Delivered').first).to_be_visible()
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations/review')
    expect(page.locator('body')).to_contain_text('7001')
    assert not errors, errors
    (ROOT / 'scratch/sales-journey/network.json').write_text(json.dumps({'browser': calls, 'sap_transport': sap_calls, 'responsive': responsive}, indent=2, default=str), encoding='utf-8')
    offset = len(sap_calls)
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations/new')
    expect(page.get_by_role('button', name='Continue to Items', exact=True)).to_be_disabled()
    page.get_by_role('combobox').first.fill('Buyer')
    page.get_by_role('option', name='C001', exact=False).click()
    page.get_by_role('button', name='Continue to Items', exact=True).click()
    page.get_by_role('combobox').first.fill('Fruit')
    page.get_by_role('option', name='FRUIT', exact=False).click()
    page.get_by_role('button', name='Add Item', exact=True).click()
    page.locator('tbody input[type=number]').nth(0).fill('250')
    for _ in range(4):
        page.get_by_role('button', name=re.compile('^Continue to ')).last.click()
    fail_next_quotation = True
    page.get_by_role('button', name='Create Sales Quotation', exact=True).last.click()
    expect(page.get_by_role('button', name='Try Again', exact=True)).to_be_disabled()
    expect(page.locator('body')).to_contain_text('Checking document status in SAP')
    page.set_viewport_size({'width':390,'height':1000})
    snapshot(page, 'quotation-ambiguous-error')
    page.reload()
    expect(page.locator('body')).to_contain_text('Checking document status in SAP')
    snapshot(page, 'quotation-ambiguous-error-reload')
    assert sum(c['method'] == 'POST' and c['endpoint'] == 'Quotations' for c in sap_calls[offset:]) == 1
    assert not errors, errors
    (ROOT / 'scratch/sales-journey/error-network.json').write_text(json.dumps(sap_calls[offset:], indent=2, default=str), encoding='utf-8')
    offset = len(sap_calls)
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations/new')
    page.get_by_role('combobox').first.fill('Buyer')
    page.get_by_role('option', name='C001', exact=False).click()
    page.get_by_role('button', name='Continue to Items', exact=True).click()
    page.get_by_role('combobox').first.fill('Fruit')
    page.get_by_role('option', name='FRUIT', exact=False).click()
    page.get_by_role('button', name='Add Item', exact=True).click()
    page.locator('tbody input[type=number]').nth(0).fill('240')
    page.locator('tbody input[type=number]').nth(1).fill('25')
    for _ in range(4):
        page.get_by_role('button', name=re.compile('^Continue to ')).last.click()
    lose_next_quotation_response = True
    page.get_by_role('button', name='Create Sales Quotation', exact=True).last.click()
    expect(page.locator('body')).to_contain_text('Checking document status in SAP')
    page.reload()
    expect(page.get_by_text('Sales Quotation Created in SAP Business One Successfully!', exact=True)).to_be_visible()
    expect(page.locator('body')).to_contain_text('5002')
    assert sum(c['method']=='POST' and c['endpoint']=='Quotations' for c in sap_calls[offset:]) == 1
    assert documents['Quotations']['DocEntry'] == 1002
    assert documents['Quotations']['DocTotal'] == 6000
    print_check(page, page.get_by_role('button', name='Print Quotation', exact=True), 5002)
    assert sum(c['method']=='POST' and c['endpoint']=='DeliveryNotes' for c in sap_calls) == 1
    (ROOT / 'scratch/sales-journey/network.json').write_text(json.dumps({'browser':calls,'sap_transport':sap_calls,'responsive':responsive}, indent=2, default=str), encoding='utf-8')
    page.set_viewport_size({'width':1440,'height':1100})
    rendering = []
    previous = 0
    for size in [1000,5000,10000]:
        added = CustomizationDraft.objects.bulk_create([CustomizationDraft(created_by=admin,
            customer_code=f'P{i:05}',customer_name=f'Performance {i:05} long customer name',currency='USD',
            status='READY_FOR_ORDER',quotation_doc_entry=100000+i,quotation_doc_num=str(900000+i))
            for i in range(previous,size)])
        CustomizationDraftLine.objects.bulk_create([CustomizationDraftLine(draft=draft,line_number=j,
            item_code=f'PERF-{j}',item_description='A realistic long item description',original_quantity=50,
            customized_quantity=50,original_unit_price=24,customized_unit_price=24,warehouse_code='WH')
            for draft in added for j in range(5)])
        previous = size
        offset_calls = len(calls)
        started = perf_counter()
        page.goto('http://127.0.0.1:5189/customization-delivery/quotations')
        expect(page.locator('.quotation-card')).to_have_count(25)
        render_ms = round((perf_counter()-started)*1000,2)
        first_numbers = page.locator('.quotation-card').all_text_contents()
        page.get_by_role('navigation',name='Document pages').get_by_role('button',name='Next',exact=True).click()
        expect(page.locator('.quotation-card')).to_have_count(25)
        page.wait_for_function("document.querySelector('.workflow-pagination span').textContent.startsWith('26')")
        assert page.locator('.quotation-card').all_text_contents() != first_numbers
        search = page.locator('.sales-readiness-workflow input[type=search]')
        search.fill('Performance')
        search.fill('Performance 00001')
        expect(page.locator('.quotation-card')).to_have_count(1)
        expect(page.locator('.quotation-card')).to_contain_text('Performance 00001')
        listing_calls = [c for c in calls[offset_calls:] if c['method']=='GET' and c['path']=='/api/customization-delivery/customization/drafts/']
        assert len(listing_calls)==3, listing_calls
        rendering.append({'dataset':size,'first_render_ms':render_ms,'initial_cards':25,'search_cards':1,'list_requests':len(listing_calls)})
    (ROOT/'scratch/readiness-browser-performance.json').write_text(json.dumps(rendering,indent=2),encoding='utf-8')
    # A real out-of-order list request must not replace the current query's results.
    delayed_search = True
    search = page.locator('.sales-readiness-workflow input[type=search]')
    search.fill('Performance 00002')
    page.wait_for_timeout(600)
    assert delayed_responses, 'Older query was not sent'
    search.fill('Performance 00001')
    expect(page.locator('.quotation-card')).to_have_count(1)
    expect(page.locator('.quotation-card')).to_contain_text('Performance 00001')
    page.wait_for_timeout(600)
    for route, response, headers in delayed_responses:
        route.fulfill(status=response.status_code, content_type='application/json', headers=headers, body=response.content)
    page.wait_for_timeout(300)
    expect(page.locator('.quotation-card')).to_contain_text('Performance 00001')
    delayed_search = False

    # Reload a persisted definitive rejection through the same GET recovery path.
    reject_next_quotation = True
    before = len(sap_calls)
    rejected = client.post('/api/customization-delivery/quotations/create/', {'request_key':'browser-rejected',
        'customer_code':'REJECTED-CUSTOMER', 'currency':'USD', 'lines':[{'item_code':'FRUIT','quantity':3,'unit_price':7}]}, format='json')
    assert rejected.status_code == 502 and rejected.data['is_ambiguous'] is False
    page.goto('http://127.0.0.1:5189/customization-delivery/quotations/new?posting=browser-rejected')
    expect(page.locator('body')).to_contain_text('Definitive fixture rejection')
    expect(page.get_by_role('button', name='Try Again', exact=True)).to_be_enabled()
    expect(page.locator('body')).not_to_contain_text('Checking document status in SAP')
    assert 'posting=' not in page.url
    assert sum(c['method']=='POST' and c['endpoint']=='Quotations' for c in sap_calls[before:]) == 1
    snapshot(page, 'quotation-definitive-rejection-recovery')

    # Delivery summaries and print must include all 30 posted documents, across both pages.
    for i in range(29):
        draft = DeliveryDraft.objects.create(status='POSTED', sales_order_doc_entry=2002, sales_order_doc_num='6002',
            customer_code='C001', customer_name='Fixture Buyer', sap_doc_entry=str(8000+i), sap_doc_num=str(9000+i),
            doc_date='2026-10-04', doc_due_date='2026-10-04', created_by=admin)
        DeliveryDraftLine.objects.create(draft=draft,line_number=0,item_code='FRUIT',item_description='Fixture Fruit',
            delivery_quantity=5,warehouse_code='WH')
    page.goto('http://127.0.0.1:5189/customization-delivery/review/deliveries')
    expect(page.locator('.cd-table-view tbody tr')).to_have_count(25)
    summary = page.locator('.delivery-report-analytics-sections').inner_text()
    assert '395' in summary and '30' in summary, summary
    page.get_by_role('navigation',name='Document pages').get_by_role('button',name='Next',exact=True).click()
    expect(page.locator('.cd-table-view tbody tr')).to_have_count(5)
    assert page.locator('.delivery-report-analytics-sections').inner_text() == summary
    with page.expect_popup() as popup:
        page.get_by_role('button',name='Print Report',exact=True).first.click()
    printed = popup.value
    expect(printed.locator('.delivery-print-table').first.locator('tbody tr')).to_have_count(30)
    expect(printed.locator('body')).to_contain_text('395')
    expect(printed.locator('body')).to_contain_text('9000')
    expect(printed.locator('body')).to_contain_text('9028')
    expect(printed.locator('body')).to_contain_text('7001')
    printed.close()
    # Changing an order filter while on page two resets the offset and filters all candidates.
    for i in range(30):
        entry = 9100+i
        document = {**deepcopy(documents['Orders']), 'DocEntry':entry, 'DocNum':8100+i, 'DocumentLines':[
            {'ItemCode':'FRUIT', 'Quantity':10, 'RemainingOpenQuantity':5 if i%2 else 0}]}
        posted_documents[('Orders', entry)] = document
        CustomizationDraft.objects.create(status='ORDER_POSTED',is_local_creation=True,customer_code='FILTER',
            customer_name='Filter fixture', currency='USD', sap_order_doc_entry=str(entry),sap_order_doc_num=str(8100+i),created_by=admin)
    page.goto('http://127.0.0.1:5189/customization-delivery/orders')
    page.get_by_role('button',name=re.compile('All')).filter(has_text='All').first.click()
    expect(page.locator('.workflow-pagination span')).to_contain_text('1–25')
    page.get_by_role('navigation',name='Document pages').get_by_role('button',name='Next',exact=True).click()
    expect(page.locator('.workflow-pagination span')).to_contain_text('26')
    page.get_by_role('button',name=re.compile('Active')).first.click()
    expect(page.locator('.workflow-pagination span')).to_contain_text('1–15 / 15')
    assert calls[-1]['params'].get('offset') == ['0'], calls[-1]
    page.goto('http://127.0.0.1:5189/customization-delivery/review')
    page.get_by_role('combobox').last.select_option('PARTIAL')
    expect(page.locator('.workflow-pagination span')).to_contain_text('1–15 / 15')
    assert not errors, errors
    (ROOT/'scratch/sales-journey/scope-regressions-network.json').write_text(json.dumps({'browser':calls,'sap_transport':sap_calls},indent=2,default=str),encoding='utf-8')
    print('PASS: late search ignored, definitive rejection recovery enables retry, delivery page totals invariant, full 30-document print.')
    browser.close()
from django.db import connections
connections.close_all()
test_database.cleanup()
print('PASS: real UI/Django/SAP payload chain USD6000 -> order -> explicit batched delivery, native base links, three print journeys and NO automatic Delivery; fixtures only.')
