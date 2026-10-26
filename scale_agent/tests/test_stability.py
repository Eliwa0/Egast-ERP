import time
import unittest

from scale_agent.stability import StabilityDetector


class TestStabilityDetector(unittest.TestCase):

    def test_becomes_stable_after_n_samples(self):
        detector = StabilityDetector(stable_sample_count=3, stable_delta=0.02)
        self.assertFalse(detector.add_sample(1000.00))
        self.assertFalse(detector.add_sample(1000.01))
        self.assertTrue(detector.add_sample(1000.00))
        self.assertTrue(detector.add_sample(1000.00))

    def test_unstable_when_delta_exceeded(self):
        detector = StabilityDetector(stable_sample_count=3, stable_delta=0.02)
        self.assertFalse(detector.add_sample(1000.00))
        self.assertFalse(detector.add_sample(1000.50))
        self.assertFalse(detector.add_sample(1000.10))

    def test_unstable_with_insufficient_samples(self):
        detector = StabilityDetector(stable_sample_count=5, stable_delta=0.02)
        for _ in range(4):
            self.assertFalse(detector.add_sample(1000.00))
        self.assertTrue(detector.add_sample(1000.00))

    def test_stable_then_unstable_recovery(self):
        detector = StabilityDetector(stable_sample_count=3, stable_delta=0.02)
        detector.add_sample(1000.00)
        detector.add_sample(1000.00)
        detector.add_sample(1000.00)
        self.assertTrue(detector.is_stable)

        detector.reset()
        self.assertFalse(detector.is_stable)

    def test_cooldown_prevents_flapping(self):
        detector = StabilityDetector(
            stable_sample_count=3, stable_delta=0.02, cooldown_seconds=100.0
        )
        detector.add_sample(1000.00)
        detector.add_sample(1000.00)
        detector.add_sample(1000.00)
        self.assertTrue(detector.is_stable)
        # Weight swings outside delta; transition is suppressed by cooldown.
        detector.add_sample(1200.00)
        self.assertTrue(detector.is_stable)

    def test_cooldown_expires_allows_transition(self):
        detector = StabilityDetector(
            stable_sample_count=3, stable_delta=0.02, cooldown_seconds=0.01
        )
        detector.add_sample(1000.00)
        detector.add_sample(1000.00)
        detector.add_sample(1000.00)
        self.assertTrue(detector.is_stable)
        time.sleep(0.05)
        detector.add_sample(1200.00)
        self.assertFalse(detector.is_stable)

    def test_sample_count_tracking(self):
        detector = StabilityDetector(stable_sample_count=3, stable_delta=0.02)
        detector.add_sample(1)
        detector.add_sample(2)
        detector.add_sample(3)
        self.assertEqual(detector.sample_count, 3)
        self.assertEqual(len(detector.samples), 3)


if __name__ == "__main__":
    unittest.main()