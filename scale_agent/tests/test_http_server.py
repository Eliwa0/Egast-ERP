import json
import time
import unittest
import urllib.request
import urllib.error

from scale_agent.agent_manager import AgentManager
from scale_agent.config import AgentConfig


class FakeDjangoClient:
    def __init__(self):
        self.pushed = []

    def push_reading(self, state):
        self.pushed.append(state.to_dict())
        return True

    def check_server(self):
        return True

    @property
    def stats(self):
        return {"push_count": len(self.pushed), "error_count": 0, "last_error": ""}


class _FakeManager:
    """Minimal manager object implementing the HTTP handler contract."""
    def __init__(self, states):
        self._states = states
        self.version = "test"
        self._start = time.time()
        self.django_client = FakeDjangoClient()
        self.readers = {sid: None for sid in states}

    @property
    def uptime_seconds(self):
        return 5.0

    @property
    def connected_count(self):
        return sum(1 for s in self._states.values() if s.is_online)

    def get_scale_state(self, device_id):
        return self._states.get(device_id)

    def get_all_states(self):
        return {sid: s.to_dict() for sid, s in self._states.items()}

    def reload_config(self):
        return None

    def get_available_ports(self):
        return [{"port": "COM3", "description": "USB-Serial CH340", "hwid": "USB\\VID_1A86&PID_7523"}]


class TestLocalHTTPServer(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from scale_agent.models import ScaleState
        cls.state = ScaleState(device_id="SCALE-01", device_name="Main", com_port="COM3")
        cls.state.update_reading(1250.40, raw_line="1250.40 kg", is_stable=True)
        cls.manager = _FakeManager({"SCALE-01": cls.state})

        from scale_agent.http_server import AgentHTTPServer
        cls.httpd = AgentHTTPServer("127.0.0.1", 0, agent_manager=cls.manager)
        cls.httpd.start()
        cls.port = cls.httpd._httpd.server_port

    @classmethod
    def tearDownClass(cls):
        cls.httpd.stop()

    def _get(self, path):
        url = f"http://127.0.0.1:{self.port}{path}"
        with urllib.request.urlopen(url) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _post(self, path, payload=None):
        url = f"http://127.0.0.1:{self.port}{path}"
        data = json.dumps(payload or {}).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def test_health(self):
        status, data = self._get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ok")

    def test_status(self):
        status, data = self._get("/status")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["scales_count"], 1)
        self.assertIn("server_url", data)
        self.assertIn("available_ports", data)
        self.assertEqual(data["available_ports"][0]["port"], "COM3")

    def test_ports(self):
        status, data = self._get("/ports")
        self.assertEqual(status, 200)
        self.assertIn("ports", data)
        self.assertEqual(data["ports"][0]["port"], "COM3")

    def test_scales(self):
        status, data = self._get("/scales")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["scales"]), 1)
        scale = data["scales"]["SCALE-01"]
        self.assertEqual(scale["weight"], 1250.40)
        self.assertTrue(scale["is_stable"])

    def test_weight_by_id(self):
        status, data = self._get("/weight?scale_id=SCALE-01")
        self.assertEqual(status, 200)
        self.assertEqual(data["weight"], 1250.40)

    def test_weight_unknown_scale(self):
        import urllib.error
        with self.assertRaises(urllib.error.HTTPError):
            self._get("/weight?scale_id=NOPE")

    def test_not_found(self):
        import urllib.error
        with self.assertRaises(urllib.error.HTTPError):
            self._get("/nope")

    def test_select_scale(self):
        status, data = self._post("/select-scale", {"scale_id": "SCALE-01"})
        self.assertEqual(status, 200)
        self.assertEqual(data["selected_scale"]["device_id"], "SCALE-01")

    def test_select_scale_missing_id(self):
        import urllib.error
        with self.assertRaises(urllib.error.HTTPError):
            self._post("/select-scale", {})

    def test_sync_scales(self):
        status, data = self._post("/sync-scales")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["scales"]), 1)

    def test_reload_config(self):
        status, data = self._post("/reload-config")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "reloaded")


if __name__ == "__main__":
    unittest.main()