import logging
import threading
import time
from typing import Optional

from scale_agent.config import DeviceConfig, is_auto_com_port, is_auto_baud
from scale_agent.models import ScaleState, ConnectionStatus
from scale_agent.parser import SerialParser
from scale_agent.auto_detect import AutoDetector, AutoDiscoveryError
from scale_agent.stability import StabilityDetector

logger = logging.getLogger("scale_agent.serial")


class SerialReader:
    """Manages a single COM port connection with auto-reconnect.

    Runs in its own daemon thread. Reads lines from the serial port,
    parses weight data, and updates the ScaleState.
    """

    def __init__(
        self,
        device_config: DeviceConfig,
        state: ScaleState,
        parser: Optional[SerialParser] = None,
        on_reading: Optional[callable] = None,
        detector: Optional[AutoDetector] = None,
    ):
        self.config = device_config
        self.state = state
        self.parser = parser or SerialParser()
        self.stability = StabilityDetector(
            stable_sample_count=device_config.stable_sample_count,
            stable_delta=device_config.stable_delta,
        )
        self._on_reading = on_reading
        self._serial = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._running = False
        self._auto_port = is_auto_com_port(device_config.com_port)
        self._auto_baud = is_auto_baud(device_config.baud_rate)
        self._detector = detector or AutoDetector(parser=self.parser)
        self._resolved: Optional[tuple] = None
        self._last_rx_time: Optional[float] = None

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self):
        if self._running:
            return
        self._stop_event.clear()
        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop, name=f"serial-{self.config.device_id}", daemon=True
        )
        self._thread.start()
        logger.info("Serial reader started for %s on %s", self.config.device_id, self.config.com_port)

    def stop(self):
        self._running = False
        self._stop_event.set()
        self._close_serial()
        logger.info("Serial reader stopped for %s", self.config.device_id)

    def _resolve_serial(self) -> tuple:
        if self._resolved:
            return self._resolved

        ports = None if self._auto_port else [self.config.com_port]
        bauds = None if self._auto_baud else [int(self.config.baud_rate)]
        candidates = self._detector.discover(ports=ports, baud_rates=bauds)

        if not candidates:
            raise AutoDiscoveryError(
                "Auto-detect: no valid scale data found on any COM port"
            )
        if len(candidates) > 1:
            summary = ", ".join(f"{c.port}@{c.baud_rate}" for c in candidates)
            raise AutoDiscoveryError(
                f"Auto-detect: {len(candidates)} scale candidates found ({summary}). "
                "Set com_port/baud_rate manually to choose one."
            )

        cand = candidates[0]
        self.state.com_port = cand.port
        self.state.baud_rate = cand.baud_rate
        self.state.auto_detected = True
        self.state.discovery_candidates = [c.to_dict() for c in candidates]
        self._resolved = (cand.port, cand.baud_rate)
        logger.info(
            "Auto-detect resolved %s to %s @ %d baud (%d valid lines)",
            self.config.device_id, cand.port, cand.baud_rate, cand.valid_lines,
        )
        return self._resolved

    def _open_serial(self) -> bool:
        try:
            import serial
            if self._auto_port or self._auto_baud:
                port, baud = self._resolve_serial()
            else:
                port = self.config.com_port
                baud = int(self.config.baud_rate)
            self._serial = serial.Serial(
                port=port,
                baudrate=baud,
                bytesize=self.config.data_bits,
                stopbits=self.config.stop_bits,
                parity=self.config.parity,
                timeout=self.config.serial_timeout,
            )
            self._last_rx_time = time.monotonic()
            self.stability.reset()
            self.state.com_port = port
            self.state.baud_rate = baud
            if self._auto_port or self._auto_baud:
                self.state.auto_detected = True
            self.state.set_connection_status(ConnectionStatus.CONNECTED.value)
            logger.info("COM connected: %s @ %d baud", port, baud)
            return True
        except AutoDiscoveryError as e:
            self.state.set_connection_status(ConnectionStatus.ERROR.value)
            self.state.set_error(str(e))
            logger.error("Auto-detect failed for %s: %s", self.config.device_id, e)
            return False
        except Exception as e:
            self.state.set_connection_status(ConnectionStatus.ERROR.value)
            self.state.set_error(f"COM error: {e}")
            logger.error("COM connection failed for %s: %s", self.config.device_id, e)
            return False

    def _close_serial(self):
        # is_open only describes pyserial's state, not the health of a USB handle.
        # Detach first and always attempt close, even after device disappearance.
        old_serial, self._serial = self._serial, None
        if old_serial is not None:
            try:
                old_serial.close()
            except Exception as exc:
                logger.debug("COM close failed for %s: %s", self.config.device_id, exc)
            logger.debug("COM closed: %s", self.config.com_port)
        self._resolved = None
        self._last_rx_time = None
        self.stability.reset()
        self.state.set_connection_status(ConnectionStatus.DISCONNECTED.value)

    def _run_loop(self):
        while self._running:
            if not self._serial or not self._serial.is_open:
                self._close_serial()
                self.state.set_connection_status(ConnectionStatus.CONNECTING.value)
                if not self._open_serial():
                    self._resolved = None
                    self._stop_event.wait(self.config.reconnect_delay)
                    continue

            try:
                raw_line = self._read_line()
                if raw_line is None:
                    # A dead driver can return immediately instead of respecting
                    # serial_timeout. Avoid spinning while awaiting the watchdog.
                    self._stop_event.wait(self.config.poll_interval)
                    continue

                weight = self.parser.parse(raw_line)
                if weight is None:
                    logger.debug("Unparseable line on %s: %r", self.config.com_port, raw_line)
                    continue

                is_stable = self.stability.add_sample(weight)
                self.state.update_reading(
                    weight=weight, raw_line=raw_line.strip(), is_stable=is_stable
                )

                if self._on_reading:
                    self._on_reading(self.state)

            except Exception as e:
                err_msg = str(e)
                self.state.set_error(err_msg)
                logger.error("Read error on %s: %s", self.config.com_port, err_msg)
                self._close_serial()
                self._stop_event.wait(self.config.reconnect_delay)

    def _read_line(self) -> Optional[str]:
        if not self._serial or not self._serial.is_open:
            return None
        try:
            line_bytes = self._serial.readline()
            if not line_bytes:
                timeout = self.config.serial_silence_timeout
                if (timeout > 0 and self._last_rx_time is not None
                        and time.monotonic() - self._last_rx_time >= timeout):
                    raise TimeoutError(
                        f"No serial bytes for {timeout:g}s; recycling connection"
                    )
                return None
            # Transport liveness is independent of the weight parser.
            self._last_rx_time = time.monotonic()
            for enc in ("ascii", "utf-8", "latin-1"):
                try:
                    return line_bytes.decode(enc)
                except (UnicodeDecodeError, ValueError):
                    continue
            return line_bytes.decode("latin-1")
        except Exception:
            raise

    def get_state_dict(self) -> dict:
        return self.state.to_dict()
