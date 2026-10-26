"""Automatic COM-port and baud-rate discovery with scale-data validation.

Discovery never assumes a COM port is a scale.  For each (port, baud) pair the
detector opens the port briefly and listens for serial output; the pair is
accepted only when multiple independent lines parse as valid weight readings
through the same parser the live reader uses.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Union

from scale_agent.parser import SerialParser

logger = logging.getLogger("scale_agent.auto_detect")

DEFAULT_PROBE_BAUD_RATES = (9600, 19200, 4800, 2400, 38400, 57600, 115200, 1200)
DEFAULT_PROBE_WINDOW_SECONDS = 1.0
DEFAULT_MIN_VALID_LINES = 2


class AutoDiscoveryError(Exception):
    """Raised when automatic port/baud resolution cannot resolve a single scale."""


@dataclass
class PortInfo:
    port: str
    description: str = ""
    hwid: str = ""


@dataclass
class ProbeCandidate:
    port: str
    baud_rate: int
    description: str = ""
    hwid: str = ""
    valid_lines: int = 0
    sample_lines: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "port": self.port,
            "baud_rate": self.baud_rate,
            "description": self.description,
            "hwid": self.hwid,
            "valid_lines": self.valid_lines,
            "sample_lines": self.sample_lines[:5],
        }


def _decode(raw: bytes) -> str:
    for enc in ("ascii", "utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, ValueError):
            continue
    return raw.decode("latin-1")


def _normalize_port(source) -> PortInfo:
    if isinstance(source, PortInfo):
        return source
    if isinstance(source, dict):
        return PortInfo(
            port=source.get("port") or source.get("device") or "",
            description=source.get("description", "") or "",
            hwid=source.get("hwid", "") or "",
        )
    return PortInfo(
        port=getattr(source, "device", None) or str(source),
        description=getattr(source, "description", "") or "",
        hwid=getattr(source, "hwid", "") or "",
    )


class AutoDetector:
    """Scans serial ports at supported baud rates, validated against real data."""

    def __init__(
        self,
        parser: Optional[SerialParser] = None,
        *,
        baud_rates: Optional[Sequence[Union[int, str]]] = None,
        probe_window: Optional[float] = None,
        min_valid_lines: Optional[int] = None,
        list_ports_fn: Optional[Callable[[], List]] = None,
        serial_factory: Optional[Callable] = None,
    ):
        self.parser = parser or SerialParser()
        self.baud_rates = tuple(baud_rates or DEFAULT_PROBE_BAUD_RATES)
        self.probe_window = probe_window or DEFAULT_PROBE_WINDOW_SECONDS
        self.min_valid_lines = min_valid_lines or DEFAULT_MIN_VALID_LINES
        self._list_ports_fn = list_ports_fn
        self._serial_factory = serial_factory

    def list_ports(self) -> List[PortInfo]:
        if self._list_ports_fn is not None:
            return [_normalize_port(p) for p in self._list_ports_fn()]
        try:
            import serial.tools.list_ports
            return [_normalize_port(p) for p in serial.tools.list_ports.comports()]
        except Exception as e:
            logger.warning("Failed to list serial ports: %s", e)
            return []

    def _open(self, port: str, baud: int):
        if self._serial_factory is not None:
            ser = self._serial_factory(port=port, baudrate=baud, timeout=0.2)
            try:
                ser.reset_input_buffer()
            except Exception:
                pass
            return ser
        import serial as serial_mod
        ser = serial_mod.Serial(port=port, baudrate=baud, timeout=0.2)
        try:
            ser.reset_input_buffer()
        except Exception:
            pass
        return ser

    def _probe(self, port_info: PortInfo, baud: int) -> Optional[ProbeCandidate]:
        try:
            ser = self._open(port_info.port, baud)
        except Exception as e:
            logger.debug("Probe open failed %s @%d: %s", port_info.port, baud, e)
            return None

        valid_lines = 0
        samples: List[str] = []
        deadline = time.time() + self.probe_window
        try:
            while time.time() < deadline:
                try:
                    raw = ser.readline()
                except Exception as e:
                    logger.debug("Probe read failed %s @%d: %s", port_info.port, baud, e)
                    break
                if not raw:
                    time.sleep(0.02)
                    continue
                line = _decode(raw).strip()
                if not line:
                    continue
                samples.append(line)
                if self.parser.parse(line) is not None:
                    valid_lines += 1
        finally:
            try:
                ser.close()
            except Exception:
                pass

        if valid_lines >= self.min_valid_lines:
            return ProbeCandidate(
                port=port_info.port,
                baud_rate=baud,
                description=port_info.description,
                hwid=port_info.hwid,
                valid_lines=valid_lines,
                sample_lines=samples,
            )
        return None

    def discover(
        self,
        ports: Optional[list] = None,
        baud_rates: Optional[Sequence[Union[int, str]]] = None,
    ) -> List[ProbeCandidate]:
        if ports is None:
            port_infos = self.list_ports()
            if not port_infos:
                return []
        else:
            port_infos = [_normalize_port(p) for p in ports]

        bauds = [int(b) for b in (baud_rates or self.baud_rates)]

        candidates: List[ProbeCandidate] = []
        for port_info in port_infos:
            for baud in bauds:
                candidate = self._probe(port_info, baud)
                if candidate is not None:
                    candidates.append(candidate)
                    break
        return candidates
