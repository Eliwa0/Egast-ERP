"""Loopback HTTP/1.1 benchmark: TCP reuse, no SAP or business data involved."""
import json
import socket
import statistics
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import requests
from api.services.sap_transport import pooled_request, _local


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.server.accepted += 1

    def do_GET(self):
        body = b'{"value":[]}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Set-Cookie', 'B1SESSION=must-not-be-replayed; Path=/')
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        self.server.cookies.append(self.headers.get('Cookie'))

    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.accepted = 0
    server.cookies = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{server.server_port}/Items'
    results = []
    try:
        for mode in ('requests_each_call', 'thread_pool'):
            before = server.accepted
            samples = []
            for _ in range(30):
                began = time.perf_counter()
                response = (requests.request('GET', url, timeout=2) if mode == 'requests_each_call'
                            else pooled_request('fixture', 'GET', url, timeout=2))
                assert response.json() == {'value': []}
                samples.append((time.perf_counter() - began) * 1000)
                response.close()
            results.append({'mode': mode, 'samples': 30, 'connections': server.accepted - before,
                            'median_ms': round(statistics.median(samples), 3),
                            'p95_ms': round(sorted(samples)[28], 3), 'environment': 'loopback HTTP/1.1'})
        assert all(cookie is None for cookie in server.cookies), 'Stored cookies must not be replayed'
        target = Path(__file__).resolve().parents[1] / 'scratch/performance-transport.json'
        target.write_text(json.dumps(results, indent=2), encoding='utf-8')
        print(json.dumps(results, indent=2))
    finally:
        if getattr(_local, 'session', None):
            _local.session.close()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
