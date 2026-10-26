import assert from 'node:assert/strict';
import { filterWarehouses, rulesForSelectedStage, staleRulesForSelectedStage } from './transferRulesSelection.js';

const stage1 = 'STAGE_1_TO_INTERMEDIATE';
const stage2 = 'STAGE_2_TO_FRIDGE';
const stage3 = 'STAGE_3_FROM_FRIDGE';
const stage4 = 'STAGE_4_TO_DESTINATION';
const rules = [
  { stage: 'BOTH', warehouse_code: 'LEGACY', direction: 'FROM', is_active: true },
  { stage: stage1, warehouse_code: 'ONE', direction: 'FROM', is_active: true },
  { stage: stage2, warehouse_code: 'TWO', direction: 'TO', is_active: true },
  { stage: stage3, warehouse_code: 'THREE', direction: 'FROM', is_active: true },
  { stage: stage4, warehouse_code: 'FOUR', direction: 'FROM', is_active: true },
];

assert.deepEqual(rulesForSelectedStage(rules, stage1).map((rule) => rule.warehouse_code), ['LEGACY', 'ONE']);
assert.deepEqual(rulesForSelectedStage(rules, stage2).map((rule) => rule.warehouse_code), ['LEGACY', 'TWO']);
assert.deepEqual(rulesForSelectedStage(rules, stage3).map((rule) => rule.warehouse_code), ['THREE']);
assert.deepEqual(rulesForSelectedStage(rules, stage4).map((rule) => rule.warehouse_code), ['FOUR']);
assert.deepEqual(staleRulesForSelectedStage(rules, stage4, new Set()).map((rule) => rule.warehouse_code), ['FOUR']);

const desired = new Set();
assert.deepEqual(staleRulesForSelectedStage(rules, stage1, desired).map((rule) => rule.warehouse_code), ['ONE']);
assert.deepEqual(staleRulesForSelectedStage(rules, stage2, desired).map((rule) => rule.warehouse_code), ['TWO']);
assert.deepEqual(staleRulesForSelectedStage(rules, stage3, desired).map((rule) => rule.warehouse_code), ['THREE']);

const warehouses = [
  { code: '20205', name: 'Desert Store', name_ar: 'مخازن صحراوي' },
  { code: '10102', name: 'مخازن مريم' },
  { code: '10201', name: 'Salehiya Store', name_ar: 'مخازن الصالحية' },
];
const codes = (items) => items.map((warehouse) => warehouse.code);
assert.deepEqual(codes(filterWarehouses(warehouses, '1020')), ['10201']);
assert.deepEqual(codes(filterWarehouses(warehouses, 'salehiya')), ['10201']);
assert.deepEqual(codes(filterWarehouses(warehouses, 'مريم')), ['10102']);
assert.deepEqual(codes(filterWarehouses(warehouses, 'DESERT')), ['20205']);
assert.deepEqual(codes(filterWarehouses(warehouses, '  ')), codes(warehouses));

const selectedCodes = ['20205', '10201', '10102'];
const visibleCodes = codes(filterWarehouses(warehouses, '1020'));
assert.deepEqual(selectedCodes, ['20205', '10201', '10102']);
assert.deepEqual(visibleCodes.filter((code) => selectedCodes.includes(code)), ['10201']);

for (const stage of [stage1, stage2, stage3]) {
  assert.deepEqual(codes(filterWarehouses(warehouses, 'مريم')), ['10102'], stage);
}
assert.deepEqual(codes(filterWarehouses(warehouses, 'مريم')), ['10102'], 'legacy BOTH selection does not affect search');
assert.deepEqual(codes(filterWarehouses(warehouses, 'SALEHIYA')), ['10201'], 'LTR query');
assert.deepEqual(codes(filterWarehouses(warehouses, 'الصالحية')), ['10201'], 'RTL query');

console.log('Transfer Rules selection and warehouse search: 19 assertions passed');
