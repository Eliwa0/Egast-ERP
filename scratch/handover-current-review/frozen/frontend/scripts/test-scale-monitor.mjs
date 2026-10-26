import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { selectMonitorDevice } from '../src/modules/scale/services/monitorSelection.js';

const devices = [
  { device_id: 'scale_virtual_001', device_type: 'virtual', is_active: true },
  { device_id: 'SCALE_02', device_type: 'local', is_active: true },
];
assert.equal(selectMonitorDevice(devices, null), 'SCALE_02');
assert.equal(selectMonitorDevice(devices, 'SCALE_02'), 'SCALE_02');
assert.equal(selectMonitorDevice(devices, 'scale_virtual_001'), 'scale_virtual_001');
assert.equal(selectMonitorDevice([], 'SCALE_02'), null);

// Exercise the actual polling hook with controlled requests and hook lifecycle.
const states = [];
const refs = [];
const pending = [];
let stateIndex = 0;
let refIndex = 0;
let effect;
let cleanup;
let initialTimer;
const context = vm.createContext({
  useState(initial) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value) => { states[index] = value; }];
  },
  useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
  useCallback: (callback) => callback,
  useEffect(callback) { effect = callback; },
  setTimeout(callback) { initialTimer = callback; return 1; },
  clearTimeout() {}, setInterval() { return 2; }, clearInterval() {},
  scaleApi: { getLiveWeight(id) {
    return new Promise((resolve, reject) => pending.push({ id, resolve, reject }));
  } },
});
const source = readFileSync(new URL('../src/modules/scale/hooks/useLiveScaleWeight.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export function', 'function')
  .replace('export default useLiveScaleWeight;', '');
vm.runInContext(source, context);
function select(id) {
  cleanup?.();
  stateIndex = 0; refIndex = 0;
  context.useLiveScaleWeight(id);
  cleanup = effect();
  initialTimer();
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
select(null);
assert.equal(pending.length, 0, 'Do not poll the backend default without a selection');
select('scale_virtual_001');
select('SCALE_02');
assert.deepEqual(pending.map((request) => request.id), ['scale_virtual_001', 'SCALE_02']);
pending[1].resolve({ success: true, data: { weight: 25, is_online: true, is_stable: true } });
await flush();
assert.equal(states[0], 25);
pending[0].resolve({ success: true, data: { weight: 999, is_online: true } });
await flush();
assert.equal(states[0], 25, 'A late virtual response must not replace the real reading');
select('scale_virtual_001');
assert.equal(states[0], 0);
assert.equal(states[3], false, 'Switching devices clears online status');
cleanup();
pending[2].reject(new Error('Late request error'));
await flush();
assert.equal(states[6], null, 'Ignore errors from a stopped poll');
console.log('Scale monitor selection and polling regressions passed.');
