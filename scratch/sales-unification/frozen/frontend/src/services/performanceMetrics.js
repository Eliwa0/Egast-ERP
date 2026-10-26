// Bounded, opt-in diagnostics. Never retain query strings, payloads or identities.
const records = [];
const pending = new Map();
const enabled = import.meta.env?.VITE_PERFORMANCE_METRICS === '1';
let busySince = null;
let loadingDurationMs = 0;
const clock = () => performance.now();
const id = () => globalThis.crypto?.randomUUID?.() || `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function beginApiMeasurement(config) {
  const correlation = id();
  config.headers = config.headers || {};
  config.headers['X-Request-ID'] = correlation;
  if (!enabled) return config;
  // Key lives only while requests are in flight, and is never exported/logged.
  const key = JSON.stringify([config.method, config.url, config.params]);
  const concurrent = pending.get(key) || 0;
  pending.set(key, concurrent + 1);
  const first = String(config.url || '').replace(/^\//, '').split('/')[0];
  config.egastMeasurement = { correlation, start: clock(), key,
    resource: /^[a-z][a-z-]{0,63}$/.test(first) ? first : 'other', concurrent };
  return config;
}

export function finishApiMeasurement(config, status) {
  const measurement = config?.egastMeasurement;
  if (!measurement) return;
  delete config.egastMeasurement;
  const remaining = (pending.get(measurement.key) || 1) - 1;
  if (remaining) pending.set(measurement.key, remaining);
  else pending.delete(measurement.key);
  records.push({ requestId: measurement.correlation, resource: measurement.resource,
    status: status || 0, durationMs: Math.round((clock() - measurement.start) * 100) / 100,
    concurrentDuplicates: measurement.concurrent });
  if (records.length > 200) records.shift();
}

export function getApiPerformanceSnapshot() {
  return records.map(record => ({ ...record }));
}

export function recordLoadingState(isBusy) {
  if (!enabled) return;
  if (isBusy && busySince === null) busySince = clock();
  if (!isBusy && busySince !== null) {
    loadingDurationMs += clock() - busySince;
    busySince = null;
  }
}

export function getLoadingPerformanceSnapshot() {
  return { loadingDurationMs: Math.round(loadingDurationMs + (busySince === null ? 0 : clock() - busySince)),
    active: busySince !== null };
}

// Retain access to diagnostics in an opted-in production build as well as Vite.
// No console logging and no extra UI; snapshots are copies without request data.
if (enabled && typeof window !== 'undefined') {
  Object.defineProperty(window, '__EGAST_PERFORMANCE__', { configurable: true,
    value: Object.freeze({ requests: getApiPerformanceSnapshot, loading: getLoadingPerformanceSnapshot }) });
}
