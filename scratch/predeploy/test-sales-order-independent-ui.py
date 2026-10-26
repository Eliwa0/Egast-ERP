"""Browser regression with intercepted APIs; never posts a real SAP document."""
import json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

USER = {'id': 1, 'username': 'order-fixture', 'role': 'admin', 'is_superuser': True}
DRAFT = {'id': 41, 'status': 'READY_FOR_ORDER', 'is_local_creation': True,
    'quotation_doc_entry': 1001, 'quotation_doc_num': '5001', 'customer_code': 'C001',
    'customer_name': 'Fixture Customer', 'currency': 'USD', 'customer_reference_number': 'PO-41',
    'lines': [{'id': 1, 'line_number': 0, 'item_code': 'ITEM-1', 'item_description': 'Fixture Item',
               'customized_quantity': 10, 'customized_unit_price': 25, 'is_selected': True, 'uom': 'PCS'}]}
ORDER = {'document_entry': 2002, 'document_number': '7002', 'customer_code': 'C001',
    'customer_name': 'Fixture Customer', 'document_status': 'O', 'order_date': '2026-10-04',
    'lines': [{'line_number': 0, 'item_code': 'ITEM-1', 'item_description': 'Fixture Item',
               'quantity': 10, 'remaining_open_quantity': 10, 'uom': 'PCS', 'warehouse_code': 'WH'}]}
SUMMARY = {'sales_order_doc_entry': 2002, 'sales_order_doc_num': '7002', 'customer_code': 'C001',
    'customer_name': 'Fixture Customer', 'ordered_quantity': 10, 'delivered_quantity': 0,
    'remaining_open_quantity': 10, 'has_remaining': True, 'lines': ORDER['lines']}
calls, errors = [], []
delivery_drafts = []

def handle(route):
    request = route.request
    path = urlparse(request.url).path
    headers = {'Access-Control-Allow-Origin': 'http://127.0.0.1:5188', 'Access-Control-Allow-Credentials': 'true',
               'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
    def respond(data, status=200):
        route.fulfill(status=status, content_type='application/json', headers=headers, body=json.dumps(data))
    if request.method == 'OPTIONS': respond({}); return
    calls.append((request.method, path))
    if path.endswith('/me/'): respond({'data': USER}); return
    if path.endswith('/create-order/'):
        assert request.method == 'POST'
        DRAFT.update(status='ORDER_POSTED', sap_order_doc_entry='2002', sap_order_doc_num='7002')
        respond({'success': True, 'draft': DRAFT}); return
    if path.endswith('/customization/drafts/'): respond({'drafts': [DRAFT]}); return
    if path.endswith(('/delivery/eligible-orders/', '/customization-delivery/orders/')):
        respond({'orders': [SUMMARY], 'counts': {'total': 1, 'active': 1, 'completed': 0}}); return
    if path.endswith(('/delivery-documents/2002/', '/orders/documents/2002/')): respond({'document': ORDER}); return
    if path.endswith('/delivery/drafts/'):
        if request.method == 'POST':
            assert request.post_data_json['sales_order_doc_entry'] == 2002
            if delivery_drafts:
                respond({'error': 'An active Delivery Draft already exists.'}, 400)
            else:
                delivery_drafts.append({'id': 91, 'status': 'DRAFT', 'sales_order_doc_entry': 2002,
                                        'sales_order_doc_num': '7002', 'lines': []})
                respond({'draft': delivery_drafts[0]}, 201)
        else: respond({'drafts': delivery_drafts})
        return
    if path.endswith('/cost-centers/'): respond({'cost_centers': []}); return
    if path.endswith('/tax-codes/'): respond({'data': {'tax_codes': []}}); return
    assert request.method == 'GET', f'Unexpected mutation: {request.method} {path}'
    respond({'data': {}})

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    context = browser.new_context(viewport={'width': 1400, 'height': 1000})
    context.add_init_script("localStorage.setItem('app-lang','en');localStorage.setItem('auth_user', " + json.dumps(json.dumps(USER)) + ");")
    context.route('**/api/**', handle)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5188/customization-delivery/quotations')
    page.get_by_role('button', name='Create Sales Order in SAP', exact=True).click()
    expect(page.get_by_role('heading', name='Sales Order Created Successfully in SAP!', exact=True)).to_be_visible()
    expect(page.locator('.modal-backdrop').get_by_text('2002', exact=True)).to_be_visible()
    expect(page.locator('.modal-backdrop').get_by_text('#7002', exact=True)).to_be_visible()
    page.wait_for_timeout(400)
    assert page.url.endswith('/quotations'), 'Success must not navigate into Delivery.'
    assert [path for method, path in calls if method == 'POST'] == ['/api/customization-delivery/customization/drafts/41/create-order/']
    assert not any('/delivery/' in path for _, path in calls), 'Order success must not even load a delivery workflow.'
    page.get_by_role('button', name='Done', exact=True).click()
    page.goto('http://127.0.0.1:5188/customization-delivery/orders')
    page.get_by_role('button', name='View Sales Order Details', exact=True).click()
    expect(page).to_have_url('http://127.0.0.1:5188/customization-delivery/orders/documents/2002')
    expect(page.get_by_text('Fixture Customer', exact=False).first).to_be_visible()
    assert not any('/delivery/drafts/' in path for _, path in calls), 'Viewing an order must not load/create delivery drafts.'
    page.goto('http://127.0.0.1:5188/customization-delivery/orders')
    page.get_by_role('button', name='Open Delivery Module', exact=True).click()
    expect(page).to_have_url('http://127.0.0.1:5188/customization-delivery/deliveries')
    expect(page.get_by_role('button', name='Create Delivery Note in SAP', exact=True)).to_be_visible()
    assert sum(method == 'POST' for method, _ in calls) == 1, 'Opening the independent module must not create a delivery.'
    page.get_by_role('button', name='Create Delivery Note in SAP', exact=True).click()
    expect(page).to_have_url('http://127.0.0.1:5188/customization-delivery/deliveries/new/2002')
    page.wait_for_function("document.body.innerText.includes('7002')")
    assert sum(method == 'POST' and path.endswith('/delivery/drafts/') for method, path in calls) >= 1
    assert len(delivery_drafts) == 1
    assert not any(path.endswith('/post/') for method, path in calls if method == 'POST')
    assert not errors, errors
    browser.close()
print('Browser PASS: order success ends without Delivery requests; order detail is read-only; Delivery draft starts only after an explicit action in the Delivery module. APIs intercepted; no SAP writes.')
