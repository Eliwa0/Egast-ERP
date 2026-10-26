import time
from collections import deque
from typing import Optional


class StabilityDetector:
    """Detects weight stability using a sliding window of consecutive samples.

    Configuration:
      - stable_sample_count: number of consecutive readings within delta to be stable
      - stable_delta: max allowed difference between min and max in the window (kg)
      - cooldown_seconds: minimum time between stability state changes (prevents flapping)
    """

    def __init__(
        self,
        stable_sample_count: int = 3,
        stable_delta: float = 0.02,
        cooldown_seconds: float = 0.5,
    ):
        self.stable_sample_count = stable_sample_count
        self.stable_delta = stable_delta
        self.cooldown_seconds = cooldown_seconds
        self._samples: deque = deque(maxlen=stable_sample_count)
        self._is_stable: bool = False
        self._last_state_change: float = 0.0

    def reset(self):
        self._samples.clear()
        self._is_stable = False
        self._last_state_change = 0.0

    def add_sample(self, weight: float) -> bool:
        """Add a weight sample and return current stability state."""
        self._samples.append(weight)

        if len(self._samples) < self.stable_sample_count:
            new_stable = False
        else:
            weights = list(self._samples)
            min_w = min(weights)
            max_w = max(weights)
            new_stable = (max_w - min_w) <= self.stable_delta

        now = time.time()
        if new_stable != self._is_stable:
            if (now - self._last_state_change) >= self.cooldown_seconds:
                self._is_stable = new_stable
                self._last_state_change = now

        return self._is_stable

    @property
    def is_stable(self) -> bool:
        return self._is_stable

    @property
    def sample_count(self) -> int:
        return len(self._samples)

    @property
    def samples(self) -> list:
        return list(self._samples)
