import sys
import time
import unittest
from unittest import mock

from scale_agent.serial_reader import SerialReader
from scale_agent.models import ScaleState, ConnectionStatus
from scale_agent.config import DeviceConfig


class FakeSerial:
    def __init__(self, lines, fail_open=False, fail_read=False):
        self.lines = list(lines)
        self.is_open = not fail_open
        self._fail_open = fail_open
        self._fail_read = fail_read
        self.closed = False

    def readline(self):
        if not self.lines:
            time.sleep(0.02)
            return b""
        line = self.lines.pop(0)
        if self._fail_read:
            raise IOError("port closed")
        if isinstance(line, str):
            line = line.encode("ascii")
        return line

    def close(self):
        self.closed = True
        self.is_open = False


def _fake_serial(port, baudrate, bytesize, stopbits, parity, timeout):
    return FakeSerial([])


class TestSerialReader(unittest.TestCase):

    def make_reader(self, cfg=None, lines=None):
        cfg = cfg or DeviceConfig(
            device_id="SCALE-01", device_name="Main", com_port="COM3",
            baud_rate=9600, poll_interval=0.01, stable_sample_count=3,
            stable_delta=0.02, reconnect_delay=0.01,
        )
        state = ScaleState(device_id=cfg.device_id, device_name=cfg.device_name, com_port=cfg.com_port)
        fake = FakeSerial(lines or ["1250.40 kg\n", "1250.41 kg\n", "1250.40 kg\n"])
        reader = SerialReader(cfg, state)
        return reader, state, fake

    def test_parse_and_update(self):
        reader, state, fake = self.make_reader()
        with mock.patch.dict(sys.modules, {"serial": mock.MagicMock(**{"Serial.side_effect": lambda *a, **k: fake})}):
            reader.start()
            time.sleep(0.3)
            reader.stop()
        self.assertGreater(state.total_readings, 0)
        self.assertEqual(state.weight, 1250.40)
        self.assertEqual(state.last_raw_line, "1250.40 kg")

    def test_com_open_failure_then_reconnect(self):
        cfg = DeviceConfig(
            device_id="S1", device_name="S1", com_port="COM9",
            baud_rate=9600, reconnect_delay=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="SCALE-01", device_name="Main", com_port="COM9")
        reader = SerialReader(cfg, state)

        calls = {"n": 0}

        def flaky_serial(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError("port not found")
            return FakeSerial(["1000.00 kg\n"])

        fake_mod = mock.MagicMock()
        fake_mod.Serial = flaky_serial
        with mock.patch.dict(sys.modules, {"serial": fake_mod}):
            reader.start()
            time.sleep(0.3)
            self.assertGreaterEqual(calls["n"], 2)
            self.assertEqual(state.weight, 1000.00)
            self.assertTrue(state.is_online)
            reader.stop()

    def test_invalid_serial_data_ignored(self):
        cfg = DeviceConfig(
            device_id="S1", device_name="S1", com_port="COM3",
            baud_rate=9600, poll_interval=0.01, stable_sample_count=3, stable_delta=0.02,
        )
        state = ScaleState(device_id="S1", device_name="S1", com_port="COM3")
        reader = SerialReader(cfg, state)
        fake = FakeSerial(["NO_DATA\n", "ERROR\n", "1250.00 kg\n"])
        with mock.patch.dict(sys.modules, {"serial": mock.MagicMock(**{"Serial.side_effect": lambda *a, **k: fake})}):
            reader.start()
            time.sleep(0.3)
            reader.stop()
        self.assertEqual(state.total_readings, 1)
        self.assertEqual(state.weight, 1250.00)

    def test_one_disconnected_scale_does_not_crash_agent(self):
        cfg_good = DeviceConfig(
            device_id="SCALE-GOOD", device_name="Good", com_port="COM3",
            baud_rate=9600, poll_interval=0.01, reconnect_delay=0.01,
        )
        cfg_bad = DeviceConfig(
            device_id="SCALE-BAD", device_name="Bad", com_port="COM99",
            baud_rate=9600, poll_interval=0.01, reconnect_delay=0.01,
        )
        state_good = ScaleState(device_id="SCALE-GOOD", device_name="Good", com_port="COM3")
        state_bad = ScaleState(device_id="SCALE-BAD", device_name="Bad", com_port="COM99")
        reader_good = SerialReader(cfg_good, state_good)
        reader_bad = SerialReader(cfg_bad, state_bad)

        def serial_factory(port, *a, **k):
            if port == "COM99":
                raise OSError("not found")
            return FakeSerial(["200.00 kg\n"])

        fake_mod = mock.MagicMock()
        fake_mod.Serial = serial_factory
        with mock.patch.dict(sys.modules, {"serial": fake_mod}):
            reader_good.start()
            reader_bad.start()
            time.sleep(0.3)
            reader_good.stop()
            reader_bad.stop()

        self.assertEqual(state_good.weight, 200.00)
        self.assertEqual(state_bad.weight, 0.0)
        self.assertIn("error", state_bad.last_error.lower())
        self.assertTrue(state_bad.error_count >= 1)


if __name__ == "__main__":
    unittest.main()