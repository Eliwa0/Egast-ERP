import logging
import threading
import time
from typing import Optional

logger = logging.getLogger("scale_agent.tray")


def _create_icon_image(
    connected: bool = True, stable: bool = False
):
    """Create a simple tray icon using Pillow."""
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        if connected:
            color = (0, 180, 0, 255) if stable else (220, 160, 0, 255)
        else:
            color = (200, 0, 0, 255)
        draw.ellipse([8, 8, 56, 56], fill=color)
        draw.text((20, 20), "S", fill=(255, 255, 255, 255))
        return img
    except ImportError:
        return None


class ScaleAgentTray:
    """Windows system tray icon for the Scale Agent.

    Uses pystray for the tray icon. Falls back gracefully if pystray
    is not available (e.g., headless/CI environments).
    """

    def __init__(self, agent_manager=None):
        self._manager = agent_manager
        self._tray = None
        self._thread: Optional[threading.Thread] = None
        self._running = False

    def start(self):
        try:
            import pystray
            self._running = True
            menu = pystray.Menu(
                pystray.MenuItem("Scale Agent", None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Status", self._on_status),
                pystray.MenuItem("Connected Scales", self._on_scales),
                pystray.MenuItem("Diagnostics", self._on_diagnostics),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Reload Config", self._on_reload),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit", self._on_exit),
            )
            icon_img = _create_icon_image(connected=False)
            self._tray = pystray.Icon(
                "ScaleAgent",
                icon_img or _create_icon_image(),
                "Scale Agent",
                menu,
            )
            self._thread = threading.Thread(target=self._run_tray, name="system-tray", daemon=True)
            self._thread.start()
            logger.info("System tray icon started")
        except ImportError:
            logger.warning("pystray not available, running without tray icon")
        except Exception as e:
            logger.warning("Failed to start tray icon: %s", e)

    def stop(self):
        self._running = False
        if self._tray:
            try:
                self._tray.stop()
            except Exception:
                pass
        logger.info("System tray icon stopped")

    def update_status(self):
        """Refresh tray icon based on current agent state."""
        if not self._tray:
            return
        try:
            if self._manager:
                connected = self._manager.connected_count > 0
                any_stable = any(
                    s.get("is_stable", False)
                    for s in self._manager.get_all_states().values()
                )
                count = self._manager.connected_count
                total = len(self._manager.readers)
                self._tray.title = f"Scale Agent ({count}/{total})"
                self._tray.icon = _create_icon_image(connected, any_stable)
        except Exception:
            pass

    def _run_tray(self):
        try:
            self._tray.run()
        except Exception as e:
            logger.error("Tray run error: %s", e)

    def _on_status(self, icon, item):
        if self._manager:
            logger.info("Uptime: %.0fs, Connected: %d/%d",
                        self._manager.uptime_seconds,
                        self._manager.connected_count,
                        len(self._manager.readers))

    def _on_scales(self, icon, item):
        if self._manager:
            for sid, state in self._manager.get_all_states().items():
                logger.info(
                    "%s [%s] %.2f kg %s",
                    sid, state.get("connection_status"),
                    state.get("weight", 0),
                    "STABLE" if state.get("is_stable") else "UNSTABLE",
                )

    def _on_diagnostics(self, icon, item):
        if self._manager:
            logger.info("Diagnostics: %s", self._manager.django_client.stats)

    def _on_reload(self, icon, item):
        if self._manager:
            try:
                self._manager.reload_config()
                logger.info("Config reloaded")
            except Exception as e:
                logger.error("Reload failed: %s", e)

    def _on_exit(self, icon, item):
        self._running = False
        if self._manager:
            self._manager.stop()
        if self._tray:
            self._tray.stop()
