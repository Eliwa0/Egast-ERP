import tempfile
import unittest
from unittest import mock

from scale_agent.agent_manager import AgentManager
from scale_agent.models import ScaleState


class TestAgentManager(unittest.TestCase):

    def make_state(self, weight=100.0, stable=False):
        s = ScaleState(device_id="S1", device_name="Main", com_port="COM3")
        s.update_reading(weight, raw_line=str(weight), is_stable=stable)
        return s

    def test_push_on_first_reading(self):
        manager = AgentManager.__new__(AgentManager)
        manager._last_pushed = {}
        state = self.make_state(100.0, stable=False)
        self.assertTrue(manager._should_push(state))

    def test_stability_change_triggers_push(self):
        manager = AgentManager.__new__(AgentManager)
        state = self.make_state(100.7, stable=True)
        manager._last_pushed = {"S1": {"weight": 100.6, "is_stable": False, "ts": 0}}
        self.assertTrue(manager._should_push(state))

    def test_min_interval_suppresses_rapid_pushes(self):
        import time
        manager = AgentManager.__new__(AgentManager)
        state = self.make_state(100.4, stable=True)
        manager._last_pushed = {
            "S1": {"weight": 100.5, "is_stable": True, "ts": time.time()}
        }
        self.assertFalse(manager._should_push(state))

    def test_heartbeat_forces_regular_push(self):
        manager = AgentManager.__new__(AgentManager)
        state = self.make_state(100.5, stable=True)
        manager._last_pushed = {
            "S1": {"weight": 100.5, "is_stable": True, "ts": 0}
        }
        self.assertTrue(manager._should_push(state))

    def test_significant_change_triggers_push(self):
        manager = AgentManager.__new__(AgentManager)
        state = self.make_state(900.0, stable=True)
        manager._last_pushed = {
            "S1": {"weight": 100.5, "is_stable": True, "ts": 0}
        }
        self.assertTrue(manager._should_push(state))

    def test_config_load_and_readers_created(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            import json
            json.dump({
                "server_url": "http://127.0.0.1:8000",
                "local_api_host": "127.0.0.1",
                "local_api_port": 0,
                "devices": [{"device_id": "S1", "device_name": "S1", "com_port": "COM3"}],
            }, f)
            path = f.name

        manager = AgentManager(config_path=path)
        self.assertEqual(len(manager.readers), 1)
        self.assertEqual(manager.states["S1"].device_id, "S1")
        manager._stop_readers()

    def test_reload_config_replaces_readers(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            import json
            json.dump({
                "server_url": "http://127.0.0.1:8000",
                "local_api_port": 0,
                "devices": [{"device_id": "S1", "device_name": "S1", "com_port": "COM3"}],
            }, f)
            path = f.name

        manager = AgentManager(config_path=path)
        self.assertEqual(len(manager.readers), 1)
        # Point config to a new device and reload
        config_data = {
            "server_url": "http://127.0.0.1:8000",
            "local_api_port": 0,
            "devices": [
                {"device_id": "S2", "device_name": "S2", "com_port": "COM4"},
            ],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(config_data, f)
        manager.reload_config()
        self.assertEqual(len(manager.readers), 1)
        self.assertIn("S2", manager.states)
        manager._stop_readers()

    def test_get_available_ports(self):
        manager = AgentManager.__new__(AgentManager)
        fake_port = mock.MagicMock()
        fake_port.device = "COM5"
        fake_port.description = "USB Serial"
        fake_port.hwid = "USB123"

        with mock.patch("serial.tools.list_ports.comports", return_value=[fake_port]):
            ports = manager.get_available_ports()
            self.assertEqual(len(ports), 1)
            self.assertEqual(ports[0]["port"], "COM5")
            self.assertEqual(ports[0]["description"], "USB Serial")


if __name__ == "__main__":
    unittest.main()