import json
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Dict, Optional
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger("scale_agent.http_server")


class AgentRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the local Agent API.

    Binds to 127.0.0.1 only. Serves status, health, weight, and config endpoints.
    The agent_manager is attached as an attribute on the server instance.
    """

    def log_message(self, fmt, *args):
        logger.debug("HTTP %s", fmt % args)

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = parse_qs(parsed.query)

        manager = self.server.agent_manager
        if manager is None:
            self._send_json({"error": "Agent not initialized"}, 503)
            return

        if path == "/health":
            self._handle_health(manager)
        elif path == "/status":
            self._handle_status(manager)
        elif path == "/scales":
            self._handle_scales(manager)
        elif path == "/weight":
            self._handle_weight(manager, params)
        elif path == "/ports":
            self._handle_ports(manager)
        elif path == "/discovery":
            self._handle_discovery(manager)
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        manager = self.server.agent_manager
        if manager is None:
            self._send_json({"error": "Agent not initialized"}, 503)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = {}
        if content_length > 0:
            try:
                body = json.loads(self.rfile.read(content_length))
            except (json.JSONDecodeError, ValueError):
                self._send_json({"error": "Invalid JSON"}, 400)
                return

        if path == "/select-scale":
            self._handle_select_scale(manager, body)
        elif path == "/sync-scales":
            self._handle_sync_scales(manager, body)
        elif path == "/reload-config":
            self._handle_reload_config(manager)
        elif path == "/discover":
            self._handle_discover(manager)
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _handle_health(self, manager):
        self._send_json({
            "status": "ok",
            "agent_version": getattr(manager, "version", "unknown"),
            "uptime_seconds": manager.uptime_seconds,
        })

    def _handle_status(self, manager):
        cfg = getattr(manager, "config", None)
        server_url = getattr(cfg, "server_url", "") if cfg else ""
        available_ports = (
            manager.get_available_ports()
            if hasattr(manager, "get_available_ports")
            else []
        )
        self._send_json({
            "status": "ok",
            "uptime_seconds": manager.uptime_seconds,
            "scales_count": len(manager.readers),
            "connected_count": manager.connected_count,
            "server_url": server_url,
            "server_reachable": manager.django_client.check_server(),
            "django_push_stats": manager.django_client.stats,
            "available_ports": available_ports,
            "scales": manager.get_all_states(),
        })

    def _handle_ports(self, manager):
        available_ports = (
            manager.get_available_ports()
            if hasattr(manager, "get_available_ports")
            else []
        )
        self._send_json({"ports": available_ports})

    def _handle_discovery(self, manager):
        if hasattr(manager, "get_discovery_info"):
            self._send_json(manager.get_discovery_info())
        else:
            self._send_json({"status": "idle", "candidates": [], "error": ""})

    def _handle_discover(self, manager):
        if not hasattr(manager, "start_discovery_scan"):
            self._send_json({"error": "Discovery not supported"}, 501)
            return
        result = manager.start_discovery_scan()
        self._send_json(result)

    def _handle_scales(self, manager):
        self._send_json({"scales": manager.get_all_states()})

    def _handle_weight(self, manager, params):
        scale_id_list = params.get("scale_id", [])
        if scale_id_list:
            scale_id = scale_id_list[0]
            state = manager.get_scale_state(scale_id)
            if state is None:
                self._send_json({"error": f"Scale {scale_id} not found"}, 404)
                return
            self._send_json(state.to_dict())
        else:
            self._send_json({"scales": manager.get_all_states()})

    def _handle_select_scale(self, manager, body):
        scale_id = body.get("scale_id")
        if not scale_id:
            self._send_json({"error": "scale_id required"}, 400)
            return
        state = manager.get_scale_state(scale_id)
        if state is None:
            self._send_json({"error": f"Scale {scale_id} not found"}, 404)
            return
        self._send_json({"selected_scale": state.to_dict()})

    def _handle_sync_scales(self, manager, body):
        self._send_json({"scales": manager.get_all_states()})

    def _handle_reload_config(self, manager):
        try:
            manager.reload_config()
            self._send_json({"status": "reloaded", "scales_count": len(manager.readers)})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)


class AgentHTTPServer:
    """Threaded HTTP server bound to 127.0.0.1 only."""

    def __init__(self, host: str, port: int, agent_manager=None):
        self.host = host
        self.port = port
        self._httpd: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None

        class BoundHTTPServer(HTTPServer):
            allow_reuse_address = True
            daemon_threads = True

        self._httpd = BoundHTTPServer((host, port), AgentRequestHandler)
        self._httpd.agent_manager = agent_manager

    def start(self):
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="http-api", daemon=True)
        self._thread.start()
        logger.info("Agent HTTP API listening on %s:%d", self.host, self.port)

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            logger.info("Agent HTTP API stopped")

    def update_manager(self, manager):
        """Update the agent manager reference (e.g., after config reload)."""
        self._httpd.agent_manager = manager
