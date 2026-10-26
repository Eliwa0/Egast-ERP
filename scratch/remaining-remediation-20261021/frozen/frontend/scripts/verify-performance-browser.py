"""Production build navigation and JS transfer measurements with isolated fixtures."""
import gzip
import importlib.util
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('responsive_fixtures', Path(__file__).with_name('verify-responsive-interactions.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
ORIGIN = os.environ.get('VERIFY_PERFORMANCE_ORIGIN', 'http://127.0.0.1:5174')


def main():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{os.environ.get('AUDIT_CHROME_PORT', '9888')}")
        for lang in ('en', 'ar'):
            context = browser.new_context(viewport={'width': 1440, 'height': 900})
            context.add_init_script("localStorage.setItem('auth_user',JSON.stringify({username:'Fixture',role:'admin',is_superuser:true}));localStorage.setItem('app-lang'," + json.dumps(lang) + ");")
            requests, scripts, failures, writes = [], set(), [], []
            def route_http(route):
                request = route.request
                u = urlparse(request.url)
                if f'{u.scheme}://{u.netloc}' == ORIGIN and not u.path.startswith('/api/'):
                    route.continue_()
                    return
                if request.method not in ('GET', 'OPTIONS'):
                    writes.append({'method': request.method, 'path': u.path})
                requests.append({'resource': u.path.split('/')[2:3], 'hasCorrelation': bool(request.headers.get('x-request-id'))})
                route.fulfill(status=200, json=fixtures.fixture(u.path), headers={
                    'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Credentials': 'true',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID, X-CSRFToken, X-Requested-With, Authorization',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS, POST'})
            context.route('**/*', route_http)
            page = context.new_page()
            page.on('pageerror', lambda error: failures.append(str(error)))
            page.on('response', lambda response: scripts.add(urlparse(response.url).path) if '/assets/' in response.url and response.url.endswith('.js') else None)
            started = time.perf_counter()
            page.goto(ORIGIN + '/login', wait_until='networkidle')
            initial = list(scripts)
            sizes = [ROOT / os.environ.get('VERIFY_PERFORMANCE_DIST', 'frontend/dist') / path.lstrip('/') for path in initial]
            results.append({'lang': lang, 'route': '/login', 'kind': 'cold-production-fixture',
                'elapsed_ms': round((time.perf_counter() - started) * 1000, 1),
                'js_files': initial, 'js_bytes': sum(path.stat().st_size for path in sizes),
                'js_gzip_bytes': sum(len(gzip.compress(path.read_bytes())) for path in sizes)})
            for route in ('/', '/scale/devices', '/customization-delivery/orders', '/receipt', '/issue'):
                previous = set(scripts)
                started = time.perf_counter()
                page.evaluate('(route)=>{history.pushState({}, "", route);dispatchEvent(new PopStateEvent("popstate"));}', route)
                page.wait_for_function("document.querySelector('main')?.innerText.length>30 && !document.querySelector('.page-transition > .app-spinner')")
                page.wait_for_load_state('networkidle')
                results.append({'lang': lang, 'route': route, 'kind': 'SPA-production-fixture',
                    'elapsed_ms': round((time.perf_counter() - started) * 1000, 1),
                    'new_js_files': sorted(scripts - previous), 'body_chars': len(page.locator('main').inner_text())})
            assert not failures, failures
            assert all(row['hasCorrelation'] for row in requests if row['resource']), 'Missing request correlation'
            assert not writes, writes
            if os.environ.get('VERIFY_EXPECT_METRICS') == '1':
                captured = page.evaluate('window.__EGAST_PERFORMANCE__.requests()')
                assert captured and all(row['requestId'] and row['durationMs'] >= 0 for row in captured), captured
                assert not any('PRIVATE' in json.dumps(row) for row in captured)
                results.append({'lang': lang, 'instrumented_api_records': len(captured), 'bounded': len(captured) <= 200})
            results.append({'lang': lang, 'API_fixture_requests': len(requests), 'uncaught': failures, 'writes': writes})
            context.close()
    output = os.environ.get('PERFORMANCE_BROWSER_OUTPUT', 'performance-production-browser')
    (ROOT / 'scratch' / (output + '.json')).write_text(json.dumps({'completed': True, 'results': results}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'completed': True, 'checks': len(results)}))


if __name__ == '__main__':
    main()
