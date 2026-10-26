import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = (await readFile(new URL('./performanceMetrics.js', import.meta.url), 'utf8'))
  .replace("import.meta.env?.VITE_PERFORMANCE_METRICS === '1'", 'true');
const diagnosticsWindow = {};
globalThis.window = diagnosticsWindow;
const metrics = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
delete globalThis.window;

test('API measurements correlate requests without retaining sensitive arguments', () => {
  const config = { method: 'get', url: '/items/PRIVATE-CODE', params: { search: 'PRIVATE-NAME' }, data: { password: 'SECRET' } };
  const first = metrics.beginApiMeasurement({ ...config });
  const second = metrics.beginApiMeasurement({ ...config });
  assert.notEqual(first.headers['X-Request-ID'], second.headers['X-Request-ID']);
  metrics.finishApiMeasurement(first, 200);
  metrics.finishApiMeasurement(second, 500);
  const snapshot = metrics.getApiPerformanceSnapshot();
  assert.equal(snapshot[0].resource, 'items');
  assert.equal(snapshot[1].concurrentDuplicates, 1);
  assert.equal(snapshot[1].status, 500);
  assert.ok(snapshot[0].durationMs >= 0);
  assert.ok(!/PRIVATE|SECRET|password/.test(JSON.stringify(snapshot)));
  assert.equal(diagnosticsWindow.__EGAST_PERFORMANCE__.requests().length, 2);
  assert.ok(Object.isFrozen(diagnosticsWindow.__EGAST_PERFORMANCE__));
});

test('diagnostics are bounded and completed requests leave no duplicate count', () => {
  for (let index = 0; index < 210; index++) {
    const config = metrics.beginApiMeasurement({ method: 'get', url: '/items/' });
    metrics.finishApiMeasurement(config, 200);
  }
  const records = metrics.getApiPerformanceSnapshot();
  assert.equal(records.length, 200);
  assert.equal(records.at(-1).concurrentDuplicates, 0);
  records.at(-1).resource = 'mutated';
  assert.equal(metrics.getApiPerformanceSnapshot().at(-1).resource, 'items');
  metrics.recordLoadingState(true);
  assert.equal(metrics.getLoadingPerformanceSnapshot().active, true);
  metrics.recordLoadingState(false);
  assert.equal(metrics.getLoadingPerformanceSnapshot().active, false);
});
