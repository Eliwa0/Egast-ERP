import time
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Union


class ConnectionStatus(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class ScaleState:
    """Runtime state for a single physical scale device."""
    device_id: str
    device_name: str = ""
    com_port: str = ""
    baud_rate: Union[int, str] = 9600
    auto_detected: bool = False
    discovery_candidates: List[dict] = field(default_factory=list)

    weight: float = 0.0
    weight_formatted: str = "0.00"
    is_stable: bool = False
    is_online: bool = False
    connection_status: str = ConnectionStatus.DISCONNECTED.value

    raw_data: str = ""
    last_raw_line: str = ""
    last_reading_time: float = 0.0
    last_push_time: float = 0.0
    last_error: str = ""
    error_count: int = 0
    total_readings: int = 0

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update_reading(self, weight: float, raw_line: str = "", is_stable: bool = False):
        with self._lock:
            self.weight = weight
            self.weight_formatted = f"{weight:.2f}"
            self.is_stable = is_stable
            self.is_online = True
            self.raw_data = raw_line
            self.last_raw_line = raw_line
            self.last_reading_time = time.time()
            self.total_readings += 1

    def set_error(self, error: str):
        with self._lock:
            self.last_error = error
            self.error_count += 1
            self.is_stable = False

    def set_connection_status(self, status: str):
        with self._lock:
            self.connection_status = status
            if status == ConnectionStatus.CONNECTED.value:
                self.is_online = True
                self.last_error = ""
            elif status == ConnectionStatus.DISCONNECTED.value:
                self.is_online = False
                self.is_stable = False

    def to_dict(self) -> dict:
        with self._lock:
            now = time.time()
            data_age = (now - self.last_reading_time) if self.last_reading_time else None
            return {
                "device_id": self.device_id,
                "device_name": self.device_name,
                "com_port": self.com_port,
                "baud_rate": self.baud_rate,
                "auto_detected": self.auto_detected,
                "discovery_candidates": list(self.discovery_candidates),
                "weight": self.weight,
                "weight_formatted": self.weight_formatted,
                "is_stable": self.is_stable,
                "is_online": self.is_online,
                "connection_status": self.connection_status,
                "last_raw_line": self.last_raw_line,
                "data_age_seconds": round(data_age, 2) if data_age is not None else None,
                "last_reading_time": self.last_reading_time,
                "last_error": self.last_error,
                "error_count": self.error_count,
                "total_readings": self.total_readings,
            }
