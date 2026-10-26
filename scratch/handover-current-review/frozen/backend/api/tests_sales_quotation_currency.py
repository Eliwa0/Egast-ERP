"""Currency regression through real API views and SAP methods, intercepting only transport."""
from copy import deepcopy
import json
import os
from unittest import skipUnless
from urllib.parse import urlparse
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from api.models_customization import CustomizationDraft
from api.services.customization_service import CustomizationService
from api.services.sales_order_payload_builder import SalesOrderPayloadBuilder


class SalesQuotationCurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('currency-test', 'currency@example.com', 'test')
        self.client = APIClient()
        self.client.force_login(self.user)
        self.client.force_authenticate(self.user)
        self.documents = {}
        self.sap_calls = []
        self.transport = patch('api.services.sap_service.SAPServiceLayer._request', side_effect=self.sap_request)
        self.transport.start()
        self.addCleanup(self.transport.stop)

    def sap_request(self, method, endpoint, payload=None, **kwargs):
        self.sap_calls.append((method, endpoint, deepcopy(payload)))
        if method == 'GET' and endpoint == 'CompanyService_GetAdminInfo':
            return {'LocalCurrency': 'EGP'}
        if method == 'POST' and endpoint in ('Quotations', 'Orders'):
            entry = (1001 if endpoint == 'Quotations' else 2002) + sum(key.startswith(endpoint + '(') for key in self.documents)
            document = dict(deepcopy(payload), DocEntry=entry, DocNum=entry + 4000,
                            DocTotal=6000 if payload['DocCurrency'] == 'EGP' else 291000, DocTotalFc=6000 if payload['DocCurrency'] != 'EGP' else 0, DocCurrency=payload['DocCurrency'])
            document['DocumentLines'] = [dict(line, LineNum=i) for i, line in enumerate(payload['DocumentLines'])]
            self.documents[f'{endpoint}({entry})'] = document
            return deepcopy(document)
        if method == 'GET' and endpoint in self.documents:
            return deepcopy(self.documents[endpoint])
        raise AssertionError(f'Unexpected SAP call: {method} {endpoint}')

    def request_payload(self, currency=None):
        payload = {'customer_code': 'C-EGP', 'customer_name': 'EGP Customer',
                   'doc_date': '2026-10-04', 'exchange_rate': 48.5,
                   'lines': [{'item_code': 'ITEM', 'quantity': 10, 'unit_price': 600}]}
        if currency is not None:
            payload['currency'] = currency
        return payload

    def test_default_currency_full_api_round_trip_and_order(self):
        response = self.client.post('/api/customization-delivery/quotations/create/', self.request_payload(), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        draft_data = response.data['draft']
        self.assertEqual(draft_data['currency'], 'USD')
        self.assertEqual(draft_data['total_amount'], 6000)
        self.assertEqual(self.sap_calls[0][0:2], ('POST', 'Quotations'))
        self.assertEqual(self.sap_calls[0][2]['DocCurrency'], 'USD')
        self.assertEqual(self.sap_calls[0][2]['DocRate'], 48.5)
        self.assertEqual(self.documents['Quotations(1001)']['DocCurrency'], 'USD')
        draft = CustomizationDraft.objects.get(pk=draft_data['id'])
        self.assertEqual(draft.currency, 'USD')
        reopened = self.client.get(f'/api/customization-delivery/customization/drafts/{draft.id}/')
        self.assertEqual(reopened.data['draft']['currency'], 'USD')
        self.assertEqual(reopened.data['draft']['total_amount'], 6000)
        order = self.client.post(f'/api/customization-delivery/customization/drafts/{draft.id}/create-order/', {}, format='json')
        self.assertEqual(order.status_code, 200, order.data)
        order_payload = next(payload for method, endpoint, payload in self.sap_calls if method == 'POST' and endpoint == 'Orders')
        self.assertEqual(order_payload['DocCurrency'], 'USD')
        self.assertEqual(order_payload['DocumentLines'][0]['BaseType'], 23)
        self.assertEqual(self.documents['Orders(2002)']['DocCurrency'], 'USD')

    def test_explicit_currency_is_preserved_not_overwritten(self):
        for currency in ('EUR', 'EGP'):
            with self.subTest(currency=currency):
                response = self.client.post('/api/customization-delivery/quotations/create/', self.request_payload(currency), format='json')
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(response.data['draft']['currency'], currency)
                draft = CustomizationDraft.objects.get(pk=response.data['draft']['id'])
                self.assertEqual(SalesOrderPayloadBuilder().build(draft)['DocCurrency'], currency)

    def test_local_save_defaults_to_usd_and_posts_usd(self):
        response = self.client.post('/api/customization-delivery/customization/drafts/',
                                    dict(self.request_payload(), action='save_draft'), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['draft']['currency'], 'USD')
        self.assertEqual(self.sap_calls, [])
        draft = CustomizationDraft.objects.get(pk=response.data['draft']['id'])
        self.assertEqual(draft.draft_payload['currency'], 'USD')
        CustomizationService().post_quotation_to_sap(draft, self.user)
        self.assertEqual(self.sap_calls[0][2]['DocCurrency'], 'USD')
        draft.refresh_from_db()
        self.assertEqual(draft.currency, 'USD')

    def test_import_and_legacy_display_use_actual_sap_currency(self):
        self.documents['Quotations(1001)'] = {
            'DocEntry': 1001, 'DocNum': 5001, 'CardCode': 'C-EGP', 'DocCurrency': 'EUR',
            'DocumentLines': [{'LineNum': 0, 'ItemCode': 'ITEM', 'Quantity': 10, 'UnitPrice': 600}],
        }
        draft = CustomizationService().create_draft(self.user, 1001)
        self.assertEqual(draft.currency, 'EUR')
        # Previously-created drafts can have the old model default despite a USD/EUR SAP snapshot.
        draft.currency = 'EGP'
        draft.save(update_fields=['currency'])
        response = self.client.get(f'/api/customization-delivery/customization/drafts/{draft.id}/')
        self.assertEqual(response.data['draft']['currency'], 'EUR')
        self.assertEqual(SalesOrderPayloadBuilder().build(draft)['DocCurrency'], 'EUR')

    @skipUnless(os.environ.get('QUOTATION_CURRENCY_BROWSER_URL'), 'Requires running frontend and Chrome')
    def test_browser_form_to_backend_to_sap_transport_and_reopen(self):
        from playwright.sync_api import sync_playwright, expect

        base = os.environ['QUOTATION_CURRENCY_BROWSER_URL'].rstrip('/')
        user = {'id': self.user.id, 'username': self.user.username, 'role': 'admin', 'is_superuser': True}
        errors, submitted = [], []

        def handle(route):
            request = route.request
            parsed = urlparse(request.url)
            path = parsed.path
            headers = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
                       'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}

            def respond(data, status=200):
                route.fulfill(status=status, content_type='application/json', headers=headers, body=json.dumps(data))

            if request.method == 'OPTIONS':
                respond({})
            elif path.endswith('/me/'):
                respond({'data': user})
            elif path.endswith('/customers/'):
                respond({'success': True, 'customers': [{'card_code': 'C-EGP', 'card_name': 'EGP Customer', 'currency': 'EGP'}]})
            elif path.endswith('/items/'):
                respond({'success': True, 'items': [{'item_code': 'ITEM', 'item_name': 'Currency Fixture Item', 'default_price': 600, 'price_currency': 'EGP', 'sales_unit': 'PCS'}]})
            elif path.endswith('/quotation-metadata/'):
                respond({'success': True})
            elif path.endswith('/quotation-context/'):
                self.assertIn('currency=USD', parsed.query)
                respond({'exchange_rate': 48.5, 'local_currency': 'EGP', 'currency': 'USD'})
            elif path.endswith('/tax-codes/'):
                respond({'data': {'tax_codes': []}})
            elif '/customization/drafts/' in path or path.endswith('/quotations/create/') or path.endswith('/documents/1001/'):
                target = path + (f'?{parsed.query}' if parsed.query else '')
                try:
                    if request.method == 'POST':
                        payload = request.post_data_json
                        submitted.append(payload)
                        response = self.client.post(target, payload, format='json')
                    else:
                        self.assertEqual(request.method, 'GET')
                        response = self.client.get(target)
                    self.assertLess(response.status_code, 400, (target, response.json()))
                    respond(response.json(), response.status_code)
                finally:
                    # Playwright callbacks have their own greenlet-local DB
                    # connections. Close them there, as a real request does,
                    # so PostgreSQL can drop this isolated test database.
                    connections.close_all()
            else:
                self.assertEqual(request.method, 'GET', f'Unexpected mutation: {path}')
                respond({'data': {}})

        # Playwright callbacks run on this test thread; only this isolated database is used.
        with patch.dict(os.environ, {'DJANGO_ALLOW_ASYNC_UNSAFE': 'true'}), sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1100})
            context.add_init_script("localStorage.setItem('app-lang','en');localStorage.setItem('auth_user', " + json.dumps(json.dumps(user)) + ");")
            context.route('**/api/**', handle)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + '/customization-delivery/quotations/new')
            page.get_by_role('combobox').first.click()
            page.get_by_role('combobox').first.fill('EGP')
            page.get_by_role('option').filter(has_text='EGP Customer').click()
            page.get_by_role('button', name='Continue to Items', exact=True).click()
            page.get_by_role('combobox').first.click()
            page.get_by_role('combobox').first.fill('ITEM')
            page.get_by_role('option').filter(has_text='Currency Fixture Item').click()
            page.get_by_role('button', name='Add Item', exact=True).click()
            page.get_by_role('spinbutton').nth(0).fill('10')
            page.get_by_role('spinbutton').nth(1).fill('600')
            expect(page.get_by_text('USD 6000.00', exact=True)).to_be_visible()
            for label in ('Continue to Commercial Header', 'Continue to Logistics', 'Continue to Customization', 'Continue to Review'):
                page.get_by_role('button', name=label, exact=True).click()
            expect(page.get_by_text('USD 6000.00', exact=True)).to_be_visible()
            page.get_by_role('button', name='Create Sales Quotation', exact=True).click()
            expect(page.get_by_role('heading', name='Sales Quotation Created in SAP Business One Successfully!', exact=True)).to_be_visible()
            self.assertEqual(submitted[0]['currency'], 'USD')
            self.assertEqual(submitted[0]['lines'][0]['quantity'], 10)
            self.assertEqual(submitted[0]['lines'][0]['unit_price'], 600)
            self.assertEqual(self.sap_calls[0][2]['DocCurrency'], 'USD')
            self.assertEqual(self.documents['Quotations(1001)']['DocCurrency'], 'USD')
            with page.expect_popup() as popup_info:
                page.get_by_role('button', name='Print Quotation', exact=True).click()
            popup = popup_info.value
            expect(popup.locator('body')).to_contain_text('USD')
            expect(popup.locator('body')).to_contain_text('6,000.00')
            page.goto(base + '/customization-delivery/quotations')
            expect(page.get_by_text('USD 6000', exact=True)).to_be_visible()
            page.goto(base + '/customization-delivery/quotations/documents/1001')
            expect(page.locator('.cd-field-value').filter(has_text='USD')).to_be_visible()
            self.assertFalse(errors, errors)
            browser.close()

