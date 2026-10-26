import assert from 'node:assert/strict';
import { createLatestRequestGuard } from '../src/utils/latestRequest.js';
import { isDefinitiveQuotationRejection } from '../src/utils/quotationPostingRecovery.js';

assert.equal(isDefinitiveQuotationRejection({ state: 'REJECTED', is_ambiguous: false }), true);
for (const data of [{ state: 'REJECTED', is_ambiguous: true }, { state: 'PENDING', is_ambiguous: true }, {}, null]) {
  assert.equal(isDefinitiveQuotationRejection(data), false);
}
const guard = createLatestRequestGuard();
let resolveApple, resolveBanana, visible;
const apply = async (query, promise) => {
  const identity = guard.begin();
  const result = await promise;
  if (guard.isCurrent(identity)) visible = { query, result };
};
const apple = apply('apple', new Promise(resolve => { resolveApple = resolve; }));
const banana = apply('banana', new Promise(resolve => { resolveBanana = resolve; }));
resolveBanana(['banana']); await banana;
resolveApple(['apple']); await apple;
assert.deepEqual(visible, { query: 'banana', result: ['banana'] });
const inFlight = guard.begin();
guard.invalidate(); // A changed filter/search or unmount invalidates even before its next request.
assert.equal(guard.isCurrent(inFlight), false);
console.log('PASS: definitive rejection classification and stale response race/invalidation');
