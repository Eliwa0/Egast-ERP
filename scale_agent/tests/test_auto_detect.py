import time
import unittest
from unittest import mock

from scale_agent.auto_detect import (
    AutoDetector,
    AutoDiscoveryError,
    PortInfo,
    ProbeCandidate,
    _normalize_port,
    DEFAULT_PROBE_BAUD_RATES,
)
from scale_agent.config import (
    DeviceConfig,
    is_auto_com_port,
    is_auto_baud,
)
from scale_agent.models import ScaleState, ConnectionStatus
from scale_agent.serial_reader import SerialReader


class FakeProbeSerial:
    def __init__(self, lines=None):
        self._lines = list(lines or [])
        self.is_open = True
        self.closed = False

    def readline(self):
        if not self._lines:
            time.sleep(0.02)
            return b""
        return self._lines.pop(0)

    def close(self):
        self.is_open = False
        self.closed = True

    def reset_input_buffer(self):
        pass


def _make_factory(baud_map):
    """Factory: baud_map = {9600: [b'line1\n', b'line2\n'], 19200: [...]}. Uknown bauds raise."""
    def factory(port=None, baudrate=None, **kw):
        lines = baud_map.get(baudrate)
        if lines is None:
            raise OSError(f"no data at {baudrate}")
        return FakeProbeSerial(list(lines))
    return factory


def _make_port_baud_factory(port_baud_map, calls=None):
    """Factory: port_baud_map = {("COM3", 9600): [b'line1\n']}."""
    def factory(port=None, baudrate=None, **kw):
        if calls is not None:
            calls.append((port, baudrate))
        lines = port_baud_map.get((port, baudrate))
        if lines is None:
            raise OSError(f"no scale data at {port}@{baudrate}")
        return FakeProbeSerial(list(lines))
    return factory


def _lines(*strings):
    return [s.encode("ascii") for s in strings]


def _ports(*names):
    """Build fake port list: just device names, no description."""
    return [{"device": n, "description": "", "hwid": ""} for n in names]


def _ports_with_desc(*items):
    """Build fake port list: (device, desc) tuples."""
    return [{"device": d, "description": desc, "hwid": ""} for d, desc in items]


class TestConfigAutoHelpers(unittest.TestCase):

    def test_is_auto_com_port(self):
        self.assertTrue(is_auto_com_port(""))
        self.assertTrue(is_auto_com_port(None))
        self.assertTrue(is_auto_com_port("  "))
        self.assertTrue(is_auto_com_port("AUTO"))
        self.assertTrue(is_auto_com_port("auto"))
        self.assertFalse(is_auto_com_port("COM3"))
        self.assertFalse(is_auto_com_port("COM10"))

    def test_is_auto_baud(self):
        self.assertTrue(is_auto_baud(None))
        self.assertTrue(is_auto_baud("AUTO"))
        self.assertTrue(is_auto_baud("auto"))
        self.assertFalse(is_auto_baud(9600))
        self.assertFalse(is_auto_baud(19200))

    def test_config_default_is_auto(self):
        cfg = DeviceConfig()
        self.assertEqual(cfg.com_port, "AUTO")
        self.assertEqual(cfg.baud_rate, "AUTO")

    def test_config_explicit_values_preserved(self):
        cfg = DeviceConfig(com_port="COM5", baud_rate=4800)
        self.assertEqual(cfg.com_port, "COM5")
        self.assertEqual(cfg.baud_rate, 4800)

    def test_config_parse_device_auto_strings(self):
        from scale_agent.config import _parse_device
        dev = _parse_device({"device_id": "D1", "com_port": "AUTO", "baud_rate": "AUTO"})
        self.assertEqual(dev.com_port, "AUTO")
        self.assertEqual(dev.baud_rate, "AUTO")


class TestProbeCandidate(unittest.TestCase):

    def test_to_dict(self):
        c = ProbeCandidate(
            port="COM3", baud_rate=9600, description="USB", hwid="HW1",
            valid_lines=3, sample_lines=["100.0 kg", "100.1 kg"],
        )
        d = c.to_dict()
        self.assertEqual(d["port"], "COM3")
        self.assertEqual(d["baud_rate"], 9600)
        self.assertEqual(d["valid_lines"], 3)
        self.assertEqual(len(d["sample_lines"]), 2)


class TestNormalizePort(unittest.TestCase):

    def test_dict_input(self):
        p = _normalize_port({"device": "COM3", "description": "USB"})
        self.assertEqual(p.port, "COM3")

    def test_port_info_passthrough(self):
        pi = PortInfo(port="COM7", description="test")
        self.assertIs(_normalize_port(pi), pi)


class TestAutoDetectorProbe(unittest.TestCase):

    def test_valid_scale_data_matched(self):
        factory = _make_factory({
            9600: _lines("ST,GS,+01250.00kg\n", "ST,GS,+01250.01kg\n", "ST,GS,+01250.00kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.5,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].port, "COM3")
        self.assertEqual(candidates[0].baud_rate, 9600)
        self.assertGreaterEqual(candidates[0].valid_lines, 2)

    def test_zero_weight_scale_protocol_matched(self):
        factory = _make_factory({
            9600: _lines("ST,GS,+      0kg\r\n", "ST,GS,+      0kg\r\n", "ST,GS,+      0kg\r\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM5"),
            probe_window=0.5,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].port, "COM5")
        self.assertEqual(candidates[0].baud_rate, 9600)
        self.assertGreaterEqual(candidates[0].valid_lines, 2)

    def test_arbitrary_printable_text_with_numbers_no_candidate(self):
        factory = _make_factory({
            9600: _lines("status code 12 ready\n", "sensor value 13\n", "port 14 open\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_garbage_data_no_candidate(self):
        factory = _make_factory({
            9600: _lines("@@@\n", "!!!\n", "***\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_no_ports_no_candidates(self):
        det = AutoDetector(
            list_ports_fn=lambda: [],
            probe_window=0.1,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_multiple_ports_returns_one_per_port(self):
        factory = _make_factory({
            9600: _lines("100.00 kg\n", "100.01 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3", "COM5"),
            probe_window=0.5,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 2)
        ports_found = {c.port for c in candidates}
        self.assertEqual(ports_found, {"COM3", "COM5"})

    def test_filters_to_specific_port(self):
        factory = _make_factory({
            9600: _lines("100.00 kg\n", "100.01 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3", "COM5"),
            probe_window=0.5,
        )
        candidates = det.discover(ports=["COM3"])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].port, "COM3")

    def test_baud_probing_reaches_non_default_baud(self):
        """Scale only responds at 19200. Detector must probe past 9600 to find it."""
        factory = _make_factory({
            19200: _lines("100.00 kg\n", "100.01 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            baud_rates=[9600, 19200, 4800],
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].baud_rate, 19200)

    def test_baud_filter(self):
        """Explicit baud_rates only probes those bauds."""
        factory = _make_factory({
            4800: _lines("100.00 kg\n", "100.01 kg\n"),
            9600: _lines("@@@\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            baud_rates=[4800],
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].baud_rate, 4800)

    def test_open_failure_skips_port(self):
        def factory(port=None, baudrate=None, **kw):
            raise OSError("device not found")
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM99"),
            probe_window=0.1,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_partial_data_insufficient_lines(self):
        """Only 1 valid line in the window should NOT be accepted (min_valid_lines=2)."""
        factory = _make_factory({
            9600: _lines("100.00 kg\n") + [b""] * 10,
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.4,
            min_valid_lines=2,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_experimentation_positive_weight_rejected(self):
        """parser.parse rejects negatives; probe should not match negative-only lines."""
        factory = _make_factory({
            9600: _lines("-100.00 kg\n", "-100.01 kg\n", "-100.02 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_binary_garbage_not_matched(self):
        """Non-text bytes should not produce false positives."""
        factory = _make_factory({
            9600: [b"\x00\x01\x02\x03\n", b"\xff\xfe\xfd\n", b"\x00\x00\x00\n"],
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 0)

    def test_port_and_baud_pair_selection_skips_wrong_pairs(self):
        calls = []
        factory = _make_port_baud_factory(
            {
                ("COM4", 19200): _lines("ST,GS,+      5kg\r\n", "ST,GS,+      5kg\r\n"),
            },
            calls=calls,
        )
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3", "COM4"),
            baud_rates=[9600, 19200],
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual([(c.port, c.baud_rate) for c in candidates], [("COM4", 19200)])
        self.assertEqual(
            calls,
            [("COM3", 9600), ("COM3", 19200), ("COM4", 9600), ("COM4", 19200)],
        )

    def test_wrong_baud_binary_garbage_rejected_before_correct_baud(self):
        factory = _make_factory({
            9600: [b"\xff\x00\x01\n", b"\xfe\x00\x02\n", b"\xfd\x00\x03\n"],
            19200: _lines("ST,GS,+      5kg\r\n", "ST,GS,+      5kg\r\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            baud_rates=[9600, 19200],
            probe_window=0.3,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].baud_rate, 19200)

    def test_probe_closes_each_attempt(self):
        opened = []

        def factory(port=None, baudrate=None, **kw):
            serial = FakeProbeSerial(_lines("ST,GS,+      0kg\r\n", "ST,GS,+      0kg\r\n"))
            opened.append(serial)
            return serial

        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            baud_rates=[9600],
            probe_window=0.3,
        )
        self.assertEqual(len(det.discover()), 1)
        self.assertEqual(len(opened), 1)
        self.assertTrue(opened[0].closed)


class TestAutoDetectorDiscoveryResolution(unittest.TestCase):

    def test_auto_port_auto_baud_picks_single_scale(self):
        factory = _make_factory({
            9600: _lines("1250.40 kg\n", "1250.41 kg\n", "1250.40 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.5,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 1)

    def test_multiple_candidates_exposed(self):
        """Two ports both valid → multiple candidates."""
        factory = _make_factory({
            9600: _lines("100.00 kg\n", "100.01 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3", "COM5"),
            probe_window=0.5,
        )
        candidates = det.discover()
        self.assertEqual(len(candidates), 2)


class TestSerialReaderAuto(unittest.TestCase):

    def _make_auto_reader(
        self, com_port="AUTO", baud_rate="AUTO",
        detect_port_data=None, live_port_data=None,
    ):
        if detect_port_data is None:
            detect_port_data = _lines("1250.40 kg\n", "1250.41 kg\n", "1250.40 kg\n")
        if live_port_data is None:
            live_port_data = _lines("1250.40 kg\n", "1250.41 kg\n", "1250.40 kg\n")

        factory = _make_factory({9600: list(detect_port_data)})
        detector = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            probe_window=0.5,
        )

        cfg = DeviceConfig(
            device_id="S1", device_name="Main",
            com_port=com_port, baud_rate=baud_rate,
            reconnect_delay=0.01, poll_interval=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="S1", device_name="Main", com_port=com_port)
        reader = SerialReader(cfg, state, detector=detector)
        return reader, state, live_port_data

    def test_auto_resolve_updates_state(self):
        reader, state, live_data = self._make_auto_reader()
        live_factory = _make_factory({9600: list(live_data)})
        with mock.patch.dict(
            "sys.modules",
            {"serial": mock.MagicMock(Serial=lambda port=None, baudrate=None, **kw: live_factory(port=port, baudrate=baudrate))},
        ):
            reader.start()
            time.sleep(0.6)
            reader.stop()
        self.assertEqual(state.com_port, "COM3")
        self.assertEqual(state.baud_rate, 9600)
        self.assertTrue(state.auto_detected)
        self.assertGreater(state.total_readings, 0)
        self.assertEqual(state.weight, 1250.40)

    def test_manual_com_with_auto_baud(self):
        factory = _make_factory({
            4800: _lines("100.00 kg\n", "100.01 kg\n"),
        })
        detector = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3"),
            baud_rates=[9600, 4800],
            probe_window=0.05,
        )
        cfg = DeviceConfig(
            device_id="S1", device_name="S1",
            com_port="COM7", baud_rate="AUTO",
            reconnect_delay=0.01, poll_interval=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="S1", device_name="S1", com_port="COM7")

        live_factory = _make_factory({4800: _lines("100.00 kg\n", "100.01 kg\n")})
        with mock.patch.dict(
            "sys.modules",
            {"serial": mock.MagicMock(Serial=lambda port=None, baudrate=None, **kw: live_factory(port=port, baudrate=baudrate))},
        ):
            reader = SerialReader(cfg, state, detector=detector)
            reader.start()
            time.sleep(0.3)
            reader.stop()
        self.assertEqual(state.baud_rate, 4800)
        self.assertTrue(state.auto_detected)

    def test_manual_config_unaffected(self):
        """Explicit com_port + baud_rate → detector never called."""
        detector_called = {"called": False}
        original_discover = AutoDetector.discover

        def tracking_discover(self, *a, **kw):
            detector_called["called"] = True
            return original_discover(self, *a, **kw)

        cfg = DeviceConfig(
            device_id="S1", device_name="S1",
            com_port="COM3", baud_rate=9600,
            reconnect_delay=0.01, poll_interval=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="S1", device_name="S1", com_port="COM3")
        fake = FakeProbeSerial(_lines("1250.40 kg\n", "1250.41 kg\n", "1250.40 kg\n"))

        with mock.patch.dict(
            "sys.modules",
            {"serial": mock.MagicMock(Serial=lambda **kw: fake)},
        ), mock.patch.object(AutoDetector, "discover", tracking_discover):
            reader = SerialReader(cfg, state)
            reader.start()
            time.sleep(0.3)
            reader.stop()

        self.assertFalse(detector_called["called"])
        self.assertFalse(state.auto_detected)
        self.assertEqual(state.weight, 1250.40)

    def test_auto_no_scale_error(self):
        det = AutoDetector(
            serial_factory=lambda **kw: FakeProbeSerial(_lines("@@@\n", "!!!\n")),
            list_ports_fn=lambda: _ports("COM3"),
            baud_rates=[9600],
            probe_window=0.05,
        )
        cfg = DeviceConfig(
            device_id="S1", device_name="S1",
            com_port="AUTO", baud_rate="AUTO",
            reconnect_delay=0.01, poll_interval=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="S1", device_name="S1", com_port="AUTO")
        reader = SerialReader(cfg, state, detector=det)
        reader.start()
        time.sleep(0.5)
        reader.stop()
        self.assertIn("Auto-detect", state.last_error)
        self.assertFalse(state.is_online)

    def test_auto_no_hardware_later_connected(self):
        attempts = {"n": 0}

        def list_ports():
            attempts["n"] += 1
            return [] if attempts["n"] == 1 else _ports("COM9")

        detector = AutoDetector(
            serial_factory=_make_factory({
                4800: _lines("ST,GS,+      5kg\r\n", "ST,GS,+      5kg\r\n"),
            }),
            list_ports_fn=list_ports,
            baud_rates=[9600, 4800],
            probe_window=0.05,
        )
        cfg = DeviceConfig(
            device_id="S1", device_name="S1",
            com_port="AUTO", baud_rate="AUTO",
            reconnect_delay=0.01, poll_interval=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="S1", device_name="S1", com_port="AUTO")
        live_factory = _make_factory({
            4800: _lines("ST,GS,+      5kg\r\n", "ST,GS,+      5kg\r\n"),
        })
        with mock.patch.dict(
            "sys.modules",
            {"serial": mock.MagicMock(Serial=lambda port=None, baudrate=None, **kw: live_factory(port=port, baudrate=baudrate))},
        ):
            reader = SerialReader(cfg, state, detector=detector)
            reader.start()
            time.sleep(0.4)
            reader.stop()
        self.assertEqual(state.com_port, "COM9")
        self.assertEqual(state.baud_rate, 4800)
        self.assertGreater(state.total_readings, 0)

    def test_auto_multiple_candidates_error(self):
        factory = _make_factory({
            9600: _lines("100.00 kg\n", "100.01 kg\n"),
        })
        det = AutoDetector(
            serial_factory=factory,
            list_ports_fn=lambda: _ports("COM3", "COM5"),
            baud_rates=[9600],
            probe_window=0.05,
        )
        cfg = DeviceConfig(
            device_id="S1", device_name="S1",
            com_port="AUTO", baud_rate="AUTO",
            reconnect_delay=0.01, poll_interval=0.01, serial_timeout=0.05,
        )
        state = ScaleState(device_id="S1", device_name="S1", com_port="AUTO")
        reader = SerialReader(cfg, state, detector=det)
        reader.start()
        time.sleep(0.5)
        reader.stop()
        self.assertIn("candidates", state.last_error.lower())
        self.assertFalse(state.is_online)

    def test_to_dict_includes_auto_detected(self):
        state = ScaleState(device_id="S1", device_name="S1", com_port="COM3")
        data = state.to_dict()
        self.assertIn("auto_detected", data)
        self.assertIn("discovery_candidates", data)
        self.assertFalse(data["auto_detected"])
        self.assertEqual(data["discovery_candidates"], [])


if __name__ == "__main__":
    unittest.main()
