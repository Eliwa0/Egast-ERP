"""Deterministic transport recovery tests; no hardware or wall-clock sleeps."""
import unittest
from unittest import mock

from scale_agent.auto_detect import ProbeCandidate
from scale_agent.config import DeviceConfig
from scale_agent.models import ScaleState
from scale_agent.serial_reader import SerialReader


class TestSerialRecovery(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.clock = mock.patch('scale_agent.serial_reader.time.monotonic',
                                side_effect=lambda: self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.config = DeviceConfig(com_port='COM7', baud_rate=19200)
        self.detector = mock.Mock()
        self.state = ScaleState(device_id='RECOVERY')
        self.reader = SerialReader(self.config, self.state, detector=self.detector)
        self.reader._stop_event = mock.Mock()
        self.wait_count = 0
        def bounded_wait(timeout):
            self.wait_count += 1
            if self.wait_count > 10:
                raise AssertionError('Recovery did not finish within ten retries')
        self.reader._stop_event.wait.side_effect = bounded_wait
        self.addCleanup(self.reader._close_serial)

    def serial(self, *responses):
        connection = mock.Mock(is_open=True)
        def read():
            elapsed, data = next(events)
            self.now += elapsed
            if isinstance(data, Exception):
                raise data
            return data
        events = iter(responses)
        connection.readline.side_effect = read
        return connection

    def run_until_reading(self, factory):
        def on_reading(state):
            self.reader._running = False
        self.reader._on_reading = on_reading
        self.reader._running = True
        with mock.patch('serial.Serial', side_effect=factory) as constructor:
            self.reader._run_loop()
        self.assertEqual(self.state.total_readings, 1)
        return constructor

    def test_stale_open_handle_replaced_and_stability_reset(self):
        stale = self.serial((60, b''))
        fresh = self.serial((1, b'125.00 kg\n'))
        def open_serial(**kwargs):
            connection = next(connections)
            if connection is fresh:
                stale.close.assert_called_once()
            return connection
        # Simulate a previously stable connection whose native handle died.
        self.reader._serial = stale
        self.reader._last_rx_time = 0
        for _ in range(3):
            self.reader.stability.add_sample(125)
        self.state.is_stable = True
        self.assertTrue(self.reader.stability.is_stable)
        # The stale object is already open, so only the replacement is constructed.
        connections = iter([fresh])
        constructor = self.run_until_reading(open_serial)
        self.assertEqual(constructor.call_count, 1)
        self.assertIs(self.reader._serial, fresh)
        self.assertFalse(self.state.is_stable)
        self.assertEqual(self.reader.stability.sample_count, 1)
        self.reader._stop_event.wait.assert_called_with(self.config.reconnect_delay)
        self.detector.discover.assert_not_called()
        self.assertEqual(constructor.call_args.kwargs['port'], 'COM7')
        self.assertEqual(constructor.call_args.kwargs['baudrate'], 19200)

    def test_short_silence_does_not_reconnect(self):
        connection = self.serial((10, b''), (20, b''), (1, b'12\n'))
        constructor = self.run_until_reading([connection])
        self.assertEqual(constructor.call_count, 1)
        connection.close.assert_not_called()

    def test_raw_unparseable_bytes_reset_silence_timer(self):
        connection = self.serial((50, b'WAIT\n'), (50, b''), (1, b'12\n'))
        constructor = self.run_until_reading([connection])
        self.assertEqual(constructor.call_count, 1)
        connection.close.assert_not_called()

    def test_watchdog_can_be_disabled_for_request_only_indicator(self):
        self.config.serial_silence_timeout = 0
        connection = self.serial((3600, b''), (1, b'12\n'))
        constructor = self.run_until_reading([connection])
        self.assertEqual(constructor.call_count, 1)

    def test_longer_configured_timeout_allows_intermittent_output(self):
        self.config.serial_silence_timeout = 180
        connection = self.serial((120, b''), (1, b'12\n'))
        constructor = self.run_until_reading([connection])
        self.assertEqual(constructor.call_count, 1)
        connection.close.assert_not_called()

    def test_auto_rediscovery_after_silence_and_usb_reappearance(self):
        self.reader._auto_port = self.reader._auto_baud = True
        self.detector.discover.side_effect = [
            [ProbeCandidate('COM8', 4800)],
            [],  # USB device absent during the first recovery attempt.
            [ProbeCandidate('COM12', 19200)],
        ]
        stale = self.serial((60, b''))
        fresh = self.serial((1, b'12\n'))
        constructor = self.run_until_reading([stale, fresh])
        stale.close.assert_called_once()
        self.assertEqual(self.detector.discover.call_count, 3)
        self.assertEqual([call.kwargs['port'] for call in constructor.call_args_list],
                         ['COM8', 'COM12'])
        self.assertEqual(self.reader._resolved, ('COM12', 19200))

    def test_manual_port_auto_baud_recovery_only_probes_configured_port(self):
        self.reader._auto_baud = True
        self.detector.discover.side_effect = [
            [ProbeCandidate('COM7', 4800)], [ProbeCandidate('COM7', 19200)],
        ]
        self.run_until_reading([self.serial((60, b'')), self.serial((1, b'12\n'))])
        self.assertEqual(self.detector.discover.call_args_list, [
            mock.call(ports=['COM7'], baud_rates=None),
            mock.call(ports=['COM7'], baud_rates=None),
        ])

    def test_read_exception_also_invalidates_auto_resolution(self):
        self.reader._auto_port = True
        self.detector.discover.side_effect = [
            [ProbeCandidate('COM8', 19200)], [ProbeCandidate('COM9', 19200)],
        ]
        stale = self.serial((1, OSError('USB removed')))
        self.run_until_reading([stale, self.serial((1, b'12\n'))])
        stale.close.assert_called_once()
        self.assertEqual(self.detector.discover.call_count, 2)
        self.detector.discover.assert_called_with(ports=None, baud_rates=[19200])

    def test_close_error_still_discards_handle_and_cached_resolution(self):
        stale = mock.Mock(is_open=False)
        stale.close.side_effect = OSError('Invalid handle')
        self.reader._serial = stale
        self.reader._resolved = ('COM8', 4800)
        self.reader._last_rx_time = 0
        self.reader._close_serial()
        stale.close.assert_called_once()
        self.assertIsNone(self.reader._serial)
        self.assertIsNone(self.reader._resolved)
        self.assertIsNone(self.reader._last_rx_time)
        self.assertFalse(self.state.is_online)

    def test_closed_handle_forces_fresh_discovery(self):
        self.reader._auto_port = True
        stale = mock.Mock(is_open=False)
        self.reader._serial = stale
        self.reader._resolved = ('COM8', 19200)
        self.detector.discover.return_value = [ProbeCandidate('COM9', 19200)]
        constructor = self.run_until_reading([self.serial((1, b'12\n'))])
        stale.close.assert_called_once()
        self.assertEqual(constructor.call_args.kwargs['port'], 'COM9')


if __name__ == '__main__':
    unittest.main()
