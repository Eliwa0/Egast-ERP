import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COST_CENTER_DIMENSIONS,
  parseCostCenterRows,
  mergeCostCenterLoad,
  loadWithRetry,
} from './costCenterLoader.js';

const okOutcome = (dimension, rows) => ({
  domain: 'cost-center',
  dimension,
  status: 'ok',
  rows,
});
const errorOutcome = (dimension, error) => ({
  domain: 'cost-center',
  dimension,
  status: 'error',
  error,
});

test('parseCostCenterRows maps backend rows and drops blank codes', () => {
  const parsed = parseCostCenterRows([
    { code: ' 210-DIM1 ', name: ' Dim 1 ' },
    { code: '   ', name: 'blank code' },
    null,
    { code: 'D2-01', name: '' },
  ]);
  assert.deepEqual(parsed, [
    { code: '210-DIM1', name: 'Dim 1' },
    { code: 'D2-01', name: 'D2-01' },
  ]);
});

test('parseCostCenterRows is safe for non-array input', () => {
  assert.deepEqual(parseCostCenterRows(null), []);
  assert.deepEqual(parseCostCenterRows({}), []);
});

test('dimension 2 ok keeps dimension 2 rows and never clears dimension 1', () => {
  const next = mergeCostCenterLoad(
    { costCentersDim1: [{ code: 'D1-01', name: 'D1' }], costCentersDim2: [], costCenterError1: null, costCenterError2: null },
    okOutcome(COST_CENTER_DIMENSIONS.GENERAL, [{ code: 'D2-01', name: 'D2' }]),
  );
  assert.deepEqual(next.costCentersDim1, [{ code: 'D1-01', name: 'D1' }]);
  assert.deepEqual(next.costCentersDim2, [{ code: 'D2-01', name: 'D2' }]);
  assert.equal(next.costCenterError2, null);
});

test('dimension 1 error keeps its previous rows and records the error only there', () => {
  const before = {
    costCentersDim1: [{ code: 'D1-01', name: 'D1' }],
    costCentersDim2: [{ code: 'D2-01', name: 'D2' }],
    costCenterError1: null,
    costCenterError2: null,
  };
  const err = new Error('network changed');
  const next = mergeCostCenterLoad(before, errorOutcome(COST_CENTER_DIMENSIONS.LOCATION, err));
  assert.deepEqual(next.costCentersDim1, before.costCentersDim1, 'loaded cost centers survive a dimension-1 failure');
  assert.deepEqual(next.costCentersDim2, before.costCentersDim2);
  assert.equal(next.costCenterError1, err);
  assert.equal(next.costCenterError2, null);
});

test('loadWithRetry retries once then throws on persistent failure', async () => {
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error('boom');
  };
  await assert.rejects(() => loadWithRetry(failing, { retries: 1, retryDelayMs: 1 }), /boom/);
  assert.equal(calls, 2);
});

test('loadWithRetry succeeds after a single transient failure', async () => {
  const flaky = (() => {
    let calls = 0;
    return async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return [{ code: 'D1-01', name: 'D1' }];
    };
  })();
  const rows = await loadWithRetry(flaky, { retries: 1, retryDelayMs: 1 });
  assert.deepEqual(rows, [{ code: 'D1-01', name: 'D1' }]);
});

test('merge ignores results from another domain (item-group failures never affect cost centers)', () => {
  const before = {
    costCentersDim1: [{ code: 'D1-01', name: 'D1' }],
    costCentersDim2: [{ code: 'D2-01', name: 'D2' }],
    costCenterError1: null,
    costCenterError2: null,
  };
  const next = mergeCostCenterLoad(before, { domain: 'item-group', status: 'error', error: new Error('nope') });
  assert.deepEqual(next, before);

  const withUnknownDimension = mergeCostCenterLoad(before, okOutcome(9, [{ code: 'x', name: 'x' }]));
  assert.deepEqual(withUnknownDimension, before);
});