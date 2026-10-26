"""Real React hook lifecycle; isolated GET fixtures, no operational writes."""
import json
import os
import re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

origin = os.environ.get('TEST_FRONTEND_ORIGIN', 'http://127.0.0.1:5194').rstrip('/')
calls, pending, errors = [], [], []
mode = 'initial'
def respond(route, code):
    route.fulfill(status=200, content_type='application/json',
                  body=json.dumps({'cost_centers': [{'code': code, 'name': code}]}))
def route_request(route):
    request = route.request
    parsed = urlparse(request.url)
    if '/api/' in parsed.path:
        assert request.method == 'GET' and parsed.path.endswith('/quality/cost-centers/'), request.url
        dim = parse_qs(parsed.query)['dimension'][0]
        calls.append(dim)
        if mode == 'initial': respond(route, 'DIM' + dim)
        elif mode == 'pending': pending.append(route)
        elif mode == 'failure': route.fulfill(status=503, content_type='application/json', body='{"error":"Fixture failure"}')
        return
    assert request.url.startswith(origin + '/'), request.url
    if parsed.path == '/__cost-center-lifecycle__':
        response = route.fetch()
        html = re.sub(r'<script type="module" src="/src/main\.jsx[^"\n]*"></script>',
                      '<script type="module">import "/scripts/fixtures/lint-cost-center-harness.jsx";</script>', response.text())
        route.fulfill(response=response, body=html)
    else: route.continue_()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    page = browser.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/*', route_request)
    page.add_init_script('Date.now = () => 1234;')
    page.goto(origin + '/__cost-center-lifecycle__')
    state = page.get_by_test_id('cost-state')
    expect(state).to_contain_text('DIM1')
    expect(state).to_contain_text('DIM2')
    assert sorted(calls) == ['1', '2'], calls
    page.get_by_role('button', name='Render 0').click()
    expect(page.get_by_role('button', name='Render 1')).to_be_visible()
    assert len(calls) == 2, 'Rerender must not reload dimensions'
    mode = 'pending'
    page.get_by_role('button', name='Reload location').click()
    expect(state).to_contain_text('"costCentersLoading":true')
    page.wait_for_timeout(100)
    page.get_by_role('button', name='Reload location').click()
    page.wait_for_timeout(100)
    assert len(pending) == 2, len(pending)
    respond(pending[1], 'NEW')
    expect(state).to_contain_text('NEW')
    respond(pending[0], 'OLD')
    page.wait_for_timeout(100)
    assert 'OLD' not in state.inner_text() and 'NEW' in state.inner_text()
    assert len(calls) == 4, calls
    mode = 'failure'
    page.get_by_role('button', name='Reload location').click()
    expect(state).to_contain_text('"status":503', timeout=5000)
    data = json.loads(state.inner_text())
    assert data['costCentersDim1'][0]['code'] == 'NEW'
    assert data['costCentersDim2'][0]['code'] == 'DIM2'
    assert data['costCenterError2'] is None
    assert calls == ['1', '2', '1', '1', '1', '1'], calls
    assert not errors, errors
    browser.close()
print('PASS: initial two requests, rerender stability, manual loading, same-clock stale-response rejection, bounded retry and dimension isolation; GET fixtures only.')
