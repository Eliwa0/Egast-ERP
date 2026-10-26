import logging
import threading

from scale_agent.models import ScaleState

logger = logging.getLogger("scale_agent.diagnostics")


class Diagnostics:
    """Collects runtime diagnostics for the Scale Agent."""

    def __init__(self, agent_manager=None):
        self._manager = agent_manager
        self._lock = threading.Lock()
        self._events = []

    def record(self, event_type: str, device_id: str = None, message: str = ""):
        import time
        with self._lock:
            self._events.append({
                "ts": time.time(),
                "type": event_type,
                "device_id": device_id,
                "message": message,
            })
            if len(self._events) > 500:
                self._events = self._events[-500:]

    def get_events(self, limit: int = 50) -> list:
        with self._lock:
            return self._events[-limit:]

    def get_report(self) -> dict:
        report = {
            "uptime_seconds": self._manager.uptime_seconds if self._manager else 0,
            "scales_count": len(self._manager.readers) if self._manager else 0,
            "connected_count": self._manager.connected_count if self._manager else 0,
            "django_push_stats": self._manager.django_client.stats if self._manager else {},
            "scales": self._manager.get_all_states() if self._manager else {},
            "recent_events": self.get_events(20),
        }
        return report