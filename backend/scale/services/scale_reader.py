import re
import time
import logging
import threading
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone as dt_timezone
from typing import Optional, Dict, Any
from django.core.cache import cache

logger = logging.getLogger(__name__)

# ── Regex pattern for weight extraction from scale serial stream ─────────────
# Matches integers or decimals with optional sign e.g., '+12540.50', '12540', '0.00'
WEIGHT_REGEX = re.compile(r"[-+]?\d*\.?\d+")
SCALE_CACHE_PREFIX = "scale:device:"
CACHE_TTL_SECONDS = 60


def parse_raw_weight(raw_line: str) -> Optional[Decimal]:
    """
    Extracts a numeric Decimal weight from a raw ASCII string sent by scale indicators.
    Examples handled:
      - 'ST,GS,+012540.00kg\\r\\n' -> Decimal('12540.00')
      - 'WN: 5420.0 kg' -> Decimal('5420.0')
      - '12500' -> Decimal('12500')
      - 'NO_DATA' -> None
    """
    if not raw_line or not isinstance(raw_line, str):
        return None
    cleaned = raw_line.strip()
    if not cleaned:
        return None

    # Search for numeric pattern
    match = WEIGHT_REGEX.search(cleaned)
    if not match:
        return None

    try:
        val = Decimal(match.group(0))
        return val if val.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


class ScaleDeviceState:
    """Thread-safe state container for a single scale device's live readings."""
    def __init__(self, device_id: str, stability_window_seconds: float = 1.5, stability_tolerance_kg: Decimal = Decimal("0.50")):
        self.device_id = device_id
        self.device_name: str = device_id
        self.location: str = ""
        self.device_type: str = "local"
        self.stability_window_seconds = stability_window_seconds
        self.stability_tolerance_kg = stability_tolerance_kg

        self.latest_weight: Decimal = Decimal("0.00")
        self.is_stable: bool = False
        self.last_seen: Optional[float] = None
        self.last_error: Optional[str] = None
        self.readings_history = []  # List of tuples: (timestamp, Decimal(weight))
        self._lock = threading.Lock()

    def update_reading(self, weight: Decimal, is_stable: Optional[bool] = None, raw_data: str = "", error: Optional[str] = None, force_last_seen: Optional[float] = None):
        with self._lock:
            now = time.time()
            self.last_seen = force_last_seen if force_last_seen is not None else now
            self.last_error = error

            if error:
                self.is_stable = False
                return

            self.latest_weight = weight
            self.readings_history.append((now, weight))

            # Prune old readings outside window
            cutoff = now - self.stability_window_seconds
            self.readings_history = [
                (t, w) for t, w in self.readings_history if t >= cutoff
            ]

            if is_stable is not None:
                self.is_stable = bool(is_stable)
            else:
                # Calculate stability from consecutive recent readings
                if len(self.readings_history) >= 3:
                    weights = [w for _, w in self.readings_history]
                    min_w = min(weights)
                    max_w = max(weights)
                    self.is_stable = (max_w - min_w) <= self.stability_tolerance_kg
                else:
                    self.is_stable = False

    def to_dict(self, offline_threshold_seconds: float = 15.0) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            is_online = bool(self.last_seen and (now - self.last_seen) <= offline_threshold_seconds)
            age = (now - self.last_seen) if self.last_seen else None

            return {
                "device_id": self.device_id,
                "device_name": self.device_name,
                "location": self.location,
                "device_type": self.device_type,
                "weight": float(self.latest_weight),
                "weight_formatted": f"{self.latest_weight:.2f}",
                "is_stable": self.is_stable if is_online else False,
                "is_online": is_online,
                "data_age_seconds": round(age, 2) if age is not None else None,
                "last_seen": datetime.fromtimestamp(self.last_seen, tz=dt_timezone.utc).isoformat() if self.last_seen else None,
                "last_seen_ts": self.last_seen,
                "error": self.last_error if not is_online else None,
            }


class ScaleReaderService:
    """
    Singleton service for scale reading ingestion, Redis shared cache synchronization,
    and In-Memory fallback.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(ScaleReaderService, cls).__new__(cls)
                cls._instance._devices: Dict[str, ScaleDeviceState] = {}
        return cls._instance

    def _get_cache_key(self, device_id: str) -> str:
        return f"{SCALE_CACHE_PREFIX}{device_id}"

    def get_or_create_device_state(self, device_id: str) -> ScaleDeviceState:
        if not device_id:
            device_id = "default_scale"
        if device_id not in self._devices:
            self._devices[device_id] = ScaleDeviceState(device_id=device_id)
        return self._devices[device_id]

    def record_reading(
        self,
        device_id: str,
        weight: Decimal,
        is_stable: Optional[bool] = None,
        raw_data: str = "",
        device_name: Optional[str] = None,
        location: Optional[str] = None,
        error: Optional[str] = None,
        force_last_seen: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Ingests a weight reading from any source (Serial daemon, HTTP push, Virtual scale).
        Updates In-Memory state AND writes to Redis shared cache.
        """
        state = self.get_or_create_device_state(device_id)
        if device_name:
            state.device_name = device_name
        if location:
            state.location = location

        state.update_reading(
            weight=weight,
            is_stable=is_stable,
            raw_data=raw_data,
            error=error,
            force_last_seen=force_last_seen,
        )
        data = state.to_dict()

        # Write to Redis shared cache
        cache_key = self._get_cache_key(device_id)
        try:
            cache.set(cache_key, data, timeout=CACHE_TTL_SECONDS)
        except Exception as exc:
            logger.debug("Redis cache write failed for scale device %s: %s (using in-memory fallback)", device_id, exc)

        return data

    def record_virtual_reading(
        self,
        device_id: str,
        weight: Decimal,
        is_stable: bool = True,
        is_online: bool = True,
        device_name: str = "Virtual Scale",
        location: str = "Virtual",
        error: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Sets simulated weight for development & testing without affecting real hardware.
        """
        state = self.get_or_create_device_state(device_id)
        state.device_type = "virtual"
        force_ts = time.time() if is_online else (time.time() - 60.0)

        return self.record_reading(
            device_id=device_id,
            weight=weight,
            is_stable=is_stable if is_online else False,
            device_name=device_name,
            location=location,
            error=error if not is_online else None,
            force_last_seen=force_ts,
        )

    def get_live_reading(self, device_id: Optional[str] = None, offline_threshold_seconds: float = 15.0) -> Dict[str, Any]:
        """
        Reads live weight & stability.
        1. Attempts to read from Redis shared cache (enables multiple Django workers sync).
        2. Recalculates online status and data age based on current server clock.
        3. Falls back to In-Memory state if cache is missing or Redis is unavailable.
        """
        if not device_id:
            if self._devices:
                device_id = list(self._devices.keys())[0]
            else:
                device_id = "scale_001"

        cache_key = self._get_cache_key(device_id)
        cached_data = None

        try:
            cached_data = cache.get(cache_key)
        except Exception as exc:
            logger.debug("Redis cache read failed for scale device %s: %s (falling back to in-memory)", device_id, exc)

        now = time.time()
        if isinstance(cached_data, dict) and "last_seen_ts" in cached_data:
            last_seen_ts = cached_data.get("last_seen_ts")
            is_online = bool(last_seen_ts and (now - last_seen_ts) <= offline_threshold_seconds)
            age = (now - last_seen_ts) if last_seen_ts else None

            cached_data["is_online"] = is_online
            cached_data["data_age_seconds"] = round(age, 2) if age is not None else None
            cached_data["is_stable"] = cached_data.get("is_stable", False) if is_online else False
            if not is_online and not cached_data.get("error"):
                cached_data["error"] = "Device offline or reading timed out"

            return cached_data

        # In-Memory fallback
        state = self.get_or_create_device_state(device_id)
        return state.to_dict(offline_threshold_seconds=offline_threshold_seconds)

    def list_active_devices(self) -> list:
        return [self.get_live_reading(dev_id) for dev_id in self._devices.keys()]

    def reset(self):
        """Used in test suites to reset in-memory state and clear cache keys."""
        for dev_id in list(self._devices.keys()):
            try:
                cache.delete(self._get_cache_key(dev_id))
            except Exception:
                pass
        self._devices.clear()


# Global scale service singleton
scale_reader_service = ScaleReaderService()
