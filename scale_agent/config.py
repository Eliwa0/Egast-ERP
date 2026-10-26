import json
import logging
import os
import sys
from dataclasses import dataclass, field
from typing import List, Optional, Union

logger = logging.getLogger("scale_agent.config")

# Under PyInstaller (onefile) `__file__` points into the temporary extraction
# directory. The external config.json must live next to the real executable,
# otherwise the temp dir path is used. Handle both dev and frozen modes.
if getattr(sys, "frozen", False):
    _AGENT_DIR = os.path.dirname(sys.executable)
else:
    _AGENT_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULT_CONFIG_PATH = os.path.join(_AGENT_DIR, "config.json")

# Sentinel used in config files to request automatic discovery of the COM port
# and/or baud rate instead of a fixed value.
AUTO = "AUTO"


def is_auto_com_port(com_port: Optional[str]) -> bool:
    """True when the device should auto-discover its COM port."""
    value = (com_port or "").strip()
    return not value or value.upper() == AUTO


def is_auto_baud(baud_rate: Union[int, str, None]) -> bool:
    """True when the device should auto-detect its baud rate."""
    if baud_rate is None:
        return True
    if isinstance(baud_rate, str):
        return baud_rate.strip().upper() == AUTO
    return False


@dataclass
class DeviceConfig:
    device_id: str = "SCALE-01"
    device_name: str = "Main Scale"
    device_type: str = "local"
    com_port: str = AUTO
    baud_rate: Union[int, str] = AUTO
    data_bits: int = 8
    stop_bits: int = 1
    parity: str = "N"
    serial_timeout: float = 1.0
    poll_interval: float = 0.1
    stable_sample_count: int = 3
    stable_delta: float = 0.02
    reconnect_delay: float = 5.0
    # Recycle a handle after this many seconds without ANY serial bytes.
    # Increase for intermittent indicators; 0 disables the silence watchdog.
    serial_silence_timeout: float = 60.0


@dataclass
class AgentConfig:
    server_url: str = "http://localhost:8000"
    local_api_host: str = "127.0.0.1"
    local_api_port: int = 8998
    push_interval: float = 0.5
    auth_token: str = ""
    log_level: str = "INFO"
    log_max_bytes: int = 5 * 1024 * 1024
    log_backup_count: int = 3
    devices: List[DeviceConfig] = field(default_factory=list)

    @property
    def receive_weight_url(self) -> str:
        return f"{self.server_url.rstrip('/')}/api/scale/receive-weight/"

    def get_device_config(self, device_id: str) -> Optional[DeviceConfig]:
        for d in self.devices:
            if d.device_id == device_id:
                return d
        return None


def _parse_device(raw: dict) -> DeviceConfig:
    """Parse a single device block, ignoring unknown fields."""
    known = {f.name for f in DeviceConfig.__dataclass_fields__.values()}
    filtered = {k: v for k, v in raw.items() if k in known}
    return DeviceConfig(**filtered)


def load_config(path: str = None) -> AgentConfig:
    """Load and validate config.json, returning an AgentConfig."""
    if path is None:
        path = DEFAULT_CONFIG_PATH

    if not os.path.isfile(path):
        logger.warning("Config file not found at %s, using defaults", path)
        return AgentConfig()

    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    known_global = {f.name for f in AgentConfig.__dataclass_fields__.values()} - {"devices"}
    global_kwargs = {k: v for k, v in raw.items() if k in known_global}

    devices = []
    for d in raw.get("devices", []):
        try:
            devices.append(_parse_device(d))
        except TypeError as e:
            logger.error("Skipping malformed device config: %s (%s)", d, e)

    config = AgentConfig(devices=devices, **global_kwargs)
    logger.info(
        "Config loaded: %d device(s), server=%s, port=%d",
        len(config.devices), config.server_url, config.local_api_port,
    )
    return config


def save_config(config: AgentConfig, path: str = None) -> None:
    """Write current config back to disk."""
    if path is None:
        path = DEFAULT_CONFIG_PATH

    data = {
        "server_url": config.server_url,
        "local_api_host": config.local_api_host,
        "local_api_port": config.local_api_port,
        "push_interval": config.push_interval,
        "auth_token": config.auth_token,
        "log_level": config.log_level,
        "log_max_bytes": config.log_max_bytes,
        "log_backup_count": config.log_backup_count,
        "devices": [
            {k: getattr(d, k) for k in DeviceConfig.__dataclass_fields__}
            for d in config.devices
        ],
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    logger.info("Config saved to %s", path)
