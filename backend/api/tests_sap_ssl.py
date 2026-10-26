"""TLS configuration and transport isolation; all SAP HTTP is mocked."""
import contextlib
import io
import os
import tempfile
import threading
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from api.services import sap_transport
from api.services.sap_service import SAPServiceLayer


class SAPSSLTests(SimpleTestCase):
    def setUp(self):
        env = patch.dict(os.environ, {
            'SAP_BASE_URL': 'https://sap.test:50000/b1s/v2',
            'SAP_COMPANY_DB': 'fixture-company',
            'SAP_USERNAME': 'fixture-user',
            'SAP_PASSWORD': 'fixture-password',
        }, clear=True)
        env.start()
        self.addCleanup(env.stop)
        SAPServiceLayer._clear_session_cache_for_tests()
        self.addCleanup(SAPServiceLayer._clear_session_cache_for_tests)

    def response(self, body=None):
        response = Mock(status_code=200)
        response.cookies = requests.cookies.cookiejar_from_dict({'B1SESSION': 'fixture-session'})
        response.json.return_value = body or {'value': []}
        return response

    def assert_request_verification(self, expected):
        client = SAPServiceLayer()
        with patch('api.services.sap_service.pooled_request', return_value=self.response()) as http:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertTrue(client.login())
            client._request('GET', 'Items')
        self.assertEqual(http.call_count, 2)
        self.assertTrue(http.call_args_list[0].args[2].endswith('/Login'))
        self.assertTrue(http.call_args_list[1].args[2].endswith('/Items'))
        for call in http.call_args_list:
            self.assertEqual(call.kwargs['verify'], expected)

    @override_settings(DEBUG=False)
    def test_default_is_verified_in_production(self):
        self.assert_request_verification(True)

    @override_settings(DEBUG=True)
    def test_debug_alone_does_not_disable_verification(self):
        self.assert_request_verification(True)

    @override_settings(DEBUG=True)
    def test_explicit_development_opt_out(self):
        os.environ['SAP_VERIFY_SSL'] = 'False'
        self.assert_request_verification(False)

    @override_settings(DEBUG=False)
    def test_production_rejects_opt_out_before_network(self):
        os.environ['SAP_VERIFY_SSL'] = 'False'
        with patch('api.services.sap_service.pooled_request') as http:
            with self.assertRaisesMessage(ImproperlyConfigured, 'requires DEBUG=True'):
                SAPServiceLayer()
        http.assert_not_called()

    def test_invalid_boolean_fails_closed(self):
        for value in ('', 'flase', 'unknown'):
            with self.subTest(value=value):
                os.environ['SAP_VERIFY_SSL'] = value
                with self.assertRaisesMessage(ImproperlyConfigured, 'explicit boolean'):
                    SAPServiceLayer()

    @override_settings(DEBUG=False)
    def test_custom_ca_is_validated_and_forwarded(self):
        with tempfile.TemporaryDirectory(dir=settings.BASE_DIR) as directory:
            bundle = Path(directory).resolve() / 'ca.pem'
            bundle.write_bytes(Path(requests.certs.where()).read_bytes())
            for value in (str(bundle), os.path.relpath(bundle, settings.BASE_DIR)):
                with self.subTest(path_form='absolute' if Path(value).is_absolute() else 'relative'):
                    os.environ['SAP_CA_BUNDLE'] = value
                    self.assert_request_verification(str(bundle))

    def test_invalid_ca_path_or_contents_fails_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            bad = Path(directory) / 'invalid.pem'
            bad.write_text('not a certificate', encoding='utf-8')
            for path in (Path(directory) / 'missing.pem', Path(directory), bad):
                with self.subTest(kind=path.name):
                    os.environ['SAP_CA_BUNDLE'] = str(path)
                    with patch('api.services.sap_service.pooled_request') as http:
                        with self.assertRaisesMessage(ImproperlyConfigured, 'valid PEM CA'):
                            SAPServiceLayer()
                    http.assert_not_called()

    @override_settings(DEBUG=True)
    def test_ca_and_disabled_verification_are_rejected(self):
        os.environ.update(SAP_VERIFY_SSL='false', SAP_CA_BUNDLE=requests.certs.where())
        with self.assertRaisesMessage(ImproperlyConfigured, 'requires SAP_VERIFY_SSL=True'):
            SAPServiceLayer()

    @override_settings(DEBUG=True)
    def test_authentication_cache_is_isolated_by_tls_policy(self):
        secure = SAPServiceLayer()
        secure._store_session(self.response())
        self.assertEqual(SAPServiceLayer().session_id, 'fixture-session')
        os.environ['SAP_CA_BUNDLE'] = requests.certs.where()
        self.assertIsNone(SAPServiceLayer().session_id)
        del os.environ['SAP_CA_BUNDLE']
        os.environ['SAP_VERIFY_SSL'] = 'false'
        self.assertIsNone(SAPServiceLayer().session_id)

    def test_sql_queries_and_pagination_use_custom_ca(self):
        os.environ['SAP_CA_BUNDLE'] = requests.certs.where()
        client = SAPServiceLayer()
        client._store_session(self.response())
        client.ensure_sql_query = Mock(return_value={})
        pages = [self.response({'value': [], 'odata.nextLink': 'SQLQueries/next'}), self.response()]
        with patch('api.services.sap_service.pooled_request', side_effect=pages) as http:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(client.get_open_production_orders(), [])
        self.assertEqual([call.args[1] for call in http.call_args_list], ['POST', 'GET'])
        for call in http.call_args_list:
            self.assertEqual(call.kwargs['verify'], client.verify_ssl)

    def test_tls_errors_are_actionable_and_do_not_log_original_exception(self):
        client = SAPServiceLayer()
        output = io.StringIO()
        with patch('api.services.sap_service.pooled_request', side_effect=requests.exceptions.SSLError('sensitive-fixture')):
            with contextlib.redirect_stdout(output):
                with self.assertRaisesMessage(requests.exceptions.SSLError, 'SAP_CA_BUNDLE') as error:
                    client.login()
        self.assertNotIn('sensitive-fixture', str(error.exception) + output.getvalue())
        self.assertNotIn('fixture-password', output.getvalue())

    def test_central_transport_enforces_configured_policy(self):
        client = SAPServiceLayer()
        with patch('api.services.sap_service.pooled_request') as http:
            client._http_request('GET', client.base_url + '/Items', verify=False)
        self.assertIs(http.call_args.kwargs['verify'], True)


class SAPSSLPoolTests(SimpleTestCase):
    def test_same_scope_with_changed_tls_policy_gets_new_pool(self):
        with patch.object(sap_transport, '_local', threading.local()):
            with patch.object(sap_transport.requests, 'Session') as factory:
                sessions = [Mock() for _ in range(4)]
                factory.side_effect = sessions
                for verify in (True, True, False, '/ca/one.pem', '/ca/two.pem'):
                    sap_transport.pooled_request('same-company', 'GET', 'https://sap.test/Items', verify=verify)
                self.assertEqual(factory.call_count, 4)
                self.assertEqual(sessions[0].request.call_count, 2)
                for session in sessions[:3]:
                    session.close.assert_called_once()
                sessions[-1].close.assert_not_called()
