import time
import unittest

from scale_agent.models import ScaleState, ConnectionStatus


class TestScaleState(unittest.TestCase):

    def test_initial_state(self):
        state = ScaleState(device_id="SCALE-01", device_name="Main", com_port="COM3")
        self.assertEqual(state.device_id, "SCALE-01")
        self.assertEqual(state.weight, 0.0)
        self.assertFalse(state.is_stable)
        self.assertFalse(state.is_online)
        self.assertEqual(state.connection_status, ConnectionStatus.DISCONNECTED.value)

    def test_update_reading(self):
        state = ScaleState(device_id="S1")
        state.update_reading(weight=1250.40, raw_line="1250.40 kg", is_stable=True)
        self.assertEqual(state.weight, 1250.40)
        self.assertEqual(state.weight_formatted, "1250.40")
        self.assertTrue(state.is_stable)
        self.assertTrue(state.is_online)
        self.assertEqual(state.total_readings, 1)
        self.assertEqual(state.last_raw_line, "1250.40 kg")

    def test_set_error(self):
        state = ScaleState(device_id="S1")
        state.set_error("COM error")
        self.assertEqual(state.last_error, "COM error")
        self.assertEqual(state.error_count, 1)
        self.assertFalse(state.is_stable)

    def test_connection_status_conected(self):
        state = ScaleState(device_id="S1")
        state.set_connection_status(ConnectionStatus.CONNECTED.value)
        self.assertTrue(state.is_online)
        self.assertEqual(state.last_error, "")

    def test_to_dict(self):
        state = ScaleState(device_id="S1", device_name="Main", com_port="COM3", baud_rate=9600)
        state.update_reading(1250.40, raw_line="1250.40", is_stable=False)
        data = state.to_dict()
        self.assertEqual(data["device_id"], "S1")
        self.assertEqual(data["device_name"], "Main")
        self.assertEqual(data["com_port"], "COM3")
        self.assertEqual(data["baud_rate"], 9600)
        self.assertEqual(data["weight"], 1250.40)
        self.assertEqual(data["weight_formatted"], "1250.40")
        self.assertEqual(data["is_stable"], False)
        self.assertEqual(data["is_online"], True)
        self.assertIn("data_age_seconds", data)
        self.assertIn("last_raw_line", data)

    def test_state_is_thread_safe(self):
        import threading
        state = ScaleState(device_id="S1")
        errors = []

        def reader():
            try:
                for i in range(1000):
                    state.update_reading(float(i), raw_line=str(i), is_stable=(i % 2 == 0))
                    state.to_dict()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=reader) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()