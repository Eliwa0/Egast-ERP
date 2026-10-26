import logging
import threading
import time
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from scale_agent.models import ScaleState

logger = logging.getLogger("scale_agent.django_client")

# The dedicated Agent credential is sent only to the ERP ingestion endpoint as
# Authorization: Bearer <token>. The token value is never logged.


class DjangoClient:
    """Pushes weight readings to the Django ERP server.

    Uses a dedicated session with retry logic. Runs in the caller's thread
    (typically the serial reader thread) to avoid blocking.
    """

    def __init__(self, server_url: str, auth_token: str = "", timeout: float = 3.0):
        self.server_url = server_url.rstrip("/")
        self.auth_token = auth_token
        self._timeout = timeout
        self._session = self._create_session()
        self._push_count = 0
        self._error_count = 0
        self._last_error: str = ""
        self._lock = threading.Lock()

    def _create_session(self) -> requests.Session:
        session = requests.Session()
        retries = Retry(total=2, backoff_factor=0.5, status_forcelist=[502, 503, 504])
        adapter = HTTPAdapter(max_retries=retries, pool_connections=5, pool_maxsize=5)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def _get_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    def push_reading(self, state: ScaleState) -> bool:
        """Send current weight reading to Django ERP.

        Returns True on success, False on failure.
        """
        url = f"{self.server_url}/api/scale/receive-weight/"
        payload = {
            "device_id": state.device_id,
            "weight": state.weight,
            "is_stable": state.is_stable,
            "raw_data": state.last_raw_line,
        }

        try:
            resp = self._session.post(
                url, json=payload, headers=self._get_headers(), timeout=self._timeout
            )
            if resp.status_code < 300:
                with self._lock:
                    self._push_count += 1
                    self._last_error = ""
                logger.debug(
                    "Pushed reading for %s: %.2f kg (stable=%s)",
                    state.device_id, state.weight, state.is_stable,
                )
                return True
            else:
                with self._lock:
                    self._error_count += 1
                    self._last_error = f"HTTP {resp.status_code}"
                logger.warning(
                    "Push failed for %s: HTTP %d", state.device_id, resp.status_code
                )
                return False
        except requests.ConnectionError as e:
            with self._lock:
                self._error_count += 1
                self._last_error = f"Connection error: {e}"
            logger.warning("Cannot reach Django server for %s: %s", state.device_id, e)
            return False
        except requests.Timeout:
            with self._lock:
                self._error_count += 1
                self._last_error = "Request timeout"
            logger.warning("Push timeout for %s", state.device_id)
            return False
        except Exception as e:
            with self._lock:
                self._error_count += 1
                self._last_error = str(e)
            logger.error("Push error for %s: %s", state.device_id, e)
            return False

    def check_server(self) -> bool:
        """Quick health check against Django server."""
        try:
            resp = self._session.get(
                f"{self.server_url}/api/scale/live-weight/",
                timeout=self._timeout,
            )
            # Auth-protected ERP endpoints can return 401/403 to this GET.
            # That proves reachability; push stats report actual sync success.
            return 200 <= resp.status_code < 500
        except Exception:
            return False

    @property
    def stats(self) -> dict:
        with self._lock:
            return {
                "server_url": self.server_url,
                "push_count": self._push_count,
                "error_count": self._error_count,
                "last_error": self._last_error,
            }
