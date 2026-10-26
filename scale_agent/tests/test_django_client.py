import unittest
from unittest import mock

from scale_agent.django_client import DjangoClient
from scale_agent.models import ScaleState


class TestDjangoClient(unittest.TestCase):

    def setUp(self):
        self.client = DjangoClient(
            server_url="http://127.0.0.1:8000",
            auth_token="",
            timeout=1.0,
        )
        self.state = ScaleState(device_id="SCALE-01", device_name="Main", com_port="COM3")
        self.state.update_reading(1250.40, raw_line="1250.40 kg", is_stable=True)

    def test_push_success(self):
        with mock.patch.object(self.client._session, "post") as mock_post:
            mock_post.return_value.status_code = 200
            result = self.client.push_reading(self.state)
        self.assertTrue(result)
        self.assertEqual(self.client.stats["push_count"], 1)
        self.assertEqual(self.client.stats["error_count"], 0)

        # Verify payload contract matches Django receive-weight endpoint
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], "http://127.0.0.1:8000/api/scale/receive-weight/")
        payload = kwargs["json"]
        self.assertEqual(payload["device_id"], "SCALE-01")
        self.assertEqual(payload["weight"], 1250.40)
        self.assertEqual(payload["is_stable"], True)
        self.assertEqual(payload["raw_data"], "1250.40 kg")

    def test_push_server_error(self):
        with mock.patch.object(self.client._session, "post") as mock_post:
            mock_post.return_value.status_code = 500
            result = self.client.push_reading(self.state)
        self.assertFalse(result)
        self.assertEqual(self.client.stats["error_count"], 1)

    def test_push_connection_error(self):
        import requests
        with mock.patch.object(self.client._session, "post") as mock_post:
            mock_post.side_effect = requests.ConnectionError("refused")
            result = self.client.push_reading(self.state)
        self.assertFalse(result)
        self.assertEqual(self.client.stats["error_count"], 1)
        self.assertIn("Connection error", self.client.stats["last_error"])

    def test_push_timeout(self):
        import requests
        with mock.patch.object(self.client._session, "post") as mock_post:
            mock_post.side_effect = requests.Timeout("slow")
            result = self.client.push_reading(self.state)
        self.assertFalse(result)
        self.assertIn("timeout", self.client.stats["last_error"].lower())

    def test_auth_token_added_when_configured(self):
        client = DjangoClient("http://x:8000", auth_token="secret123")
        self.assertEqual(client._get_headers()["Authorization"], "Bearer secret123")

    def test_no_auth_header_when_not_configured(self):
        headers = self.client._get_headers()
        self.assertNotIn("Authorization", headers)

    def test_check_server(self):
        with mock.patch.object(self.client._session, "get") as mock_get:
            mock_get.return_value.status_code = 200
            self.assertTrue(self.client.check_server())
            mock_get.return_value.status_code = 401
            self.assertTrue(self.client.check_server())
            mock_get.return_value.status_code = 503
            self.assertFalse(self.client.check_server())

    def test_successful_push_clears_previous_sync_error(self):
        with mock.patch.object(self.client._session, "post") as post:
            post.return_value.status_code = 401
            self.assertFalse(self.client.push_reading(self.state))
            self.assertEqual(self.client.stats['last_error'], 'HTTP 401')
            post.return_value.status_code = 200
            self.assertTrue(self.client.push_reading(self.state))
            self.assertEqual(self.client.stats['last_error'], '')


if __name__ == "__main__":
    unittest.main()
