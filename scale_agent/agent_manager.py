import logging
import threading
import time
from typing import Dict, Optional

from scale_agent import __version__
from scale_agent.config import AgentConfig, load_config, save_config
from scale_agent.models import ScaleState, ConnectionStatus
from scale_agent.serial_reader import SerialReader
from scale_agent.auto_detect import AutoDetector
from scale_agent.django_client import DjangoClient
from scale_agent.http_server import AgentHTTPServer
from scale_agent.diagnostics import Diagnostics
from scale_agent.tray import ScaleAgentTray

logger = logging.getLogger("scale_agent.manager")

# Minimum time between successive HTTP pushes (prevents flooding).
MIN_PUSH_INTERVAL_SECONDS = 0.3
# Always push a keep-alive reading at least this often.
HEARTBEAT_INTERVAL_SECONDS = 5.0
# Significant weight change (kg) that triggers an immediate push.
SIGNIFICANT_DELTA_KG = 0.5


class AgentManager:
    """Orchestrates serial readers, Django client, local HTTP API, and tray."""

    def __init__(self, config_path: str = None):
        self.version = __version__
        self._start_time = time.time()
        self.config_path = config_path
        self.config: AgentConfig = load_config(config_path)
        self._lock = threading.Lock()

        self.readers: Dict[str, SerialReader] = {}
        self.states: Dict[str, ScaleState] = {}
        self._last_pushed: Dict[str, dict] = {}

        self.django_client = DjangoClient(
            server_url=self.config.server_url,
            auth_token=self.config.auth_token,
        )
        self.diagnostics = Diagnostics(self)
        self.http_server: Optional[AgentHTTPServer] = None
        self.tray: Optional[ScaleAgentTray] = None
        self._running = False

        self._detector = AutoDetector()
        self._discovery_lock = threading.Lock()
        self._discovery_status = "idle"
        self._discovery_candidates: list = []
        self._discovery_last_scan: Optional[float] = None
        self._discovery_error: str = ""

        self._create_readers()

    @property
    def uptime_seconds(self) -> float:
        return round(time.time() - self._start_time, 1)

    @property
    def connected_count(self) -> int:
        return sum(1 for s in self.states.values() if s.is_online)

    def start(self):
        self._running = True
        for reader in self.readers.values():
            reader.start()
        self._start_http_server()
        self.tray = ScaleAgentTray(self)
        self.tray.start()
        logger.info("Scale Agent started (v%s)", self.version)

    def stop(self):
        self._running = False
        if self.tray:
            self.tray.stop()
        if self.http_server:
            self.http_server.stop()
        self._stop_readers()
        logger.info("Scale Agent stopped")

    def _create_readers(self):
        for dev_cfg in self.config.devices:
            state = ScaleState(
                device_id=dev_cfg.device_id,
                device_name=dev_cfg.device_name,
                com_port=dev_cfg.com_port,
                baud_rate=dev_cfg.baud_rate,
            )
            reader = SerialReader(
                device_config=dev_cfg,
                state=state,
                on_reading=self._on_reading,
            )
            self.states[dev_cfg.device_id] = state
            self.readers[dev_cfg.device_id] = reader
            logger.info("Reader created for %s (%s)", dev_cfg.device_id, dev_cfg.com_port)

    def _stop_readers(self):
        for reader in self.readers.values():
            reader.stop()
        self.readers.clear()
        self.states.clear()

    def _start_http_server(self):
        self.http_server = AgentHTTPServer(
            host=self.config.local_api_host,
            port=self.config.local_api_port,
            agent_manager=self,
        )
        self.http_server.start()

    def _on_reading(self, state: ScaleState):
        """Callback invoked by serial readers each time a reading is parsed."""
        self.diagnostics.record("reading", state.device_id, f"{state.weight:.2f} kg")
        if self._should_push(state):
            self.django_client.push_reading(state)
            state.last_push_time = time.time()
            self._last_pushed[state.device_id] = {
                "weight": state.weight,
                "is_stable": state.is_stable,
                "ts": time.time(),
            }

    def _should_push(self, state: ScaleState) -> bool:
        now = time.time()
        last = self._last_pushed.get(state.device_id)
        if last is None:
            return True

        time_since_last = now - last.get("ts", 0)
        if time_since_last < MIN_PUSH_INTERVAL_SECONDS:
            return False

        stability_changed = last.get("is_stable") != state.is_stable
        weight_delta = abs(last.get("weight", 0) - state.weight)
        significant_change = weight_delta >= SIGNIFICANT_DELTA_KG
        heartbeat = time_since_last >= HEARTBEAT_INTERVAL_SECONDS

        return stability_changed or significant_change or heartbeat

    def get_scale_state(self, device_id: str) -> Optional[ScaleState]:
        return self.states.get(device_id)

    def get_all_states(self) -> Dict[str, dict]:
        return {sid: state.to_dict() for sid, state in self.states.items()}

    def get_available_ports(self) -> list:
        """Enumerate available local serial/COM ports."""
        try:
            import serial.tools.list_ports
            ports = serial.tools.list_ports.comports()
            return [
                {
                    "port": p.device,
                    "description": p.description or p.device,
                    "hwid": getattr(p, "hwid", ""),
                }
                for p in ports
            ]
        except Exception as e:
            logger.warning("Failed to list serial ports: %s", e)
            return []


    def get_discovery_info(self) -> dict:
        with self._discovery_lock:
            return {
                "status": self._discovery_status,
                "candidates": [c.to_dict() for c in self._discovery_candidates],
                "last_scan": self._discovery_last_scan,
                "error": self._discovery_error,
            }

    def start_discovery_scan(self) -> dict:
        with self._discovery_lock:
            if self._discovery_status == "running":
                return {"status": "running"}
            self._discovery_status = "running"
            self._discovery_error = ""

        def _scan():
            try:
                candidates = self._detector.discover()
                with self._discovery_lock:
                    self._discovery_candidates = candidates
                    self._discovery_status = "done"
                    self._discovery_last_scan = time.time()
            except Exception as e:
                with self._discovery_lock:
                    self._discovery_status = "error"
                    self._discovery_error = str(e)

        t = threading.Thread(target=_scan, name="discovery-scan", daemon=True)
        t.start()
        return {"status": "running"}

    def reload_config(self):
        """Reload config.json and restart readers with the new configuration."""
        logger.info("Reloading config from %s", self.config_path or "default")
        new_config = load_config(self.config_path)

        with self._lock:
            # Stop existing readers (serial ports freed for reuse).
            for reader in list(self.readers.values()):
                reader.stop()
            self.readers.clear()
            self.states.clear()

            self.config = new_config
            self.django_client = DjangoClient(
                server_url=new_config.server_url,
                auth_token=new_config.auth_token,
            )
            self._create_readers()
            for reader in self.readers.values():
                reader.start()
            if self.http_server:
                self.http_server.update_manager(self)

        logger.info("Config reloaded: %d device(s)", len(self.config.devices))


def run_agent(config_path: str = None):
    """Main agent entry point."""
    manager = AgentManager(config_path=config_path)

    def _signal_handler(*_):
        manager.stop()

    try:
        import signal
        signal.signal(signal.SIGINT, _signal_handler)
        signal.signal(signal.SIGTERM, _signal_handler)
    except (ImportError, ValueError):
        pass

    manager.start()

    try:
        while manager._running:
            time.sleep(1)
    except KeyboardInterrupt:
        manager.stop()

    return manager