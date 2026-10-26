import json
import os
import tempfile
import unittest

from scale_agent.config import AgentConfig, DeviceConfig, load_config, save_config


class TestConfig(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.config_path = os.path.join(self.tmp_dir, "config.json")

    def test_missing_file_returns_defaults(self):
        config = load_config(os.path.join(self.tmp_dir, "missing.json"))
        self.assertEqual(config.server_url, "http://localhost:8000")
        self.assertEqual(config.devices, [])

    def test_load_valid_config(self):
        raw = {
            "server_url": "http://192.168.1.10:8000",
            "local_api_port": 8998,
            "devices": [
                {
                    "device_id": "SCALE-01",
                    "device_name": "Main Scale",
                    "device_type": "local",
                    "com_port": "COM3",
                    "baud_rate": 9600,
                },
                {
                    "device_id": "SCALE-02",
                    "device_name": "Second Scale",
                    "device_type": "local",
                    "com_port": "COM4",
                    "baud_rate": 4800,
                },
            ],
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(raw, f)

        config = load_config(self.config_path)
        self.assertEqual(config.server_url, "http://192.168.1.10:8000")
        self.assertEqual(len(config.devices), 2)
        self.assertEqual(config.devices[0].device_id, "SCALE-01")
        self.assertEqual(config.devices[0].com_port, "COM3")
        self.assertEqual(config.devices[1].com_port, "COM4")
        self.assertEqual(config.receive_weight_url,
                         "http://192.168.1.10:8000/api/scale/receive-weight/")

    def test_null_server_url_normalized(self):
        raw = {"server_url": "http://127.0.0.1:8000/", "devices": []}
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(raw, f)
        config = load_config(self.config_path)
        self.assertEqual(
            config.receive_weight_url,
            "http://127.0.0.1:8000/api/scale/receive-weight/",
        )

    def test_malformed_json(self):
        with open(self.config_path, "w", encoding="utf-8") as f:
            f.write("{not valid json")
        with self.assertRaises(json.JSONDecodeError):
            load_config(self.config_path)

    def test_unknown_fields_ignored(self):
        raw = {
            "server_url": "http://x:8000",
            "unknown_field": 42,
            "devices": [
                {
                    "device_id": "S1",
                    "device_name": "S1",
                    "com_port": "COM5",
                    "bogus_field": "ignored",
                }
            ],
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(raw, f)
        config = load_config(self.config_path)
        self.assertEqual(config.devices[0].com_port, "COM5")
        self.assertFalse(hasattr(config, "unknown_field"))

    def test_save_roundtrip(self):
        config = AgentConfig(
            server_url="http://192.168.1.20:8000",
            devices=[
                DeviceConfig(device_id="SCALE-01", device_name="A", com_port="COM3",
                             serial_silence_timeout=180.0),
            ],
        )
        save_config(config, self.config_path)
        loaded = load_config(self.config_path)
        self.assertEqual(loaded.server_url, "http://192.168.1.20:8000")
        self.assertEqual(loaded.devices[0].device_id, "SCALE-01")
        self.assertEqual(loaded.devices[0].serial_silence_timeout, 180.0)

    def test_get_device_config(self):
        config = AgentConfig(
            devices=[
                DeviceConfig(device_id="SCALE-01", com_port="COM3"),
                DeviceConfig(device_id="SCALE-02", com_port="COM4"),
            ]
        )
        self.assertEqual(config.get_device_config("SCALE-02").com_port, "COM4")
        self.assertIsNone(config.get_device_config("NOPE"))

    def test_defaults_populated(self):
        cfg = DeviceConfig()
        self.assertEqual(cfg.com_port, "AUTO")
        self.assertEqual(cfg.baud_rate, "AUTO")
        self.assertEqual(cfg.data_bits, 8)
        self.assertEqual(cfg.stop_bits, 1)
        self.assertEqual(cfg.parity, "N")
        self.assertEqual(cfg.stable_sample_count, 3)
        self.assertEqual(cfg.stable_delta, 0.02)
        self.assertEqual(cfg.serial_silence_timeout, 60.0)


if __name__ == "__main__":
    unittest.main()
