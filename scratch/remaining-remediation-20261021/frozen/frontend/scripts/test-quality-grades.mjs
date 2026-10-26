import assert from 'node:assert/strict';
import { adaptInspectionCriteriaCategories, createDefectTemplate } from '../src/utils/qualityCriteriaAdapter.js';
import { calculateQualityMetrics } from '../src/utils/qualityCalculations.js';

const categories = adaptInspectionCriteriaCategories([{ category: { code: 'GRADE', name_ar: 'درجات الجودة', name_en: 'Quality Grades' }, criteria: [
  { id: 25, calculation_key: 'grade_1', name_ar: 'درجة أولى', name_en: 'Grade 1' },
  { id: 26, calculation_key: 'grade_2', name_ar: 'درجة ثانية', name_en: 'Grade 2' },
] }]);
assert.deepEqual(categories.grades.items.map((item) => item.key), ['grade_1', 'grade_2']);
assert.equal(categories.others, undefined);
assert.equal(createDefectTemplate(categories).grade_1, 0);
assert.equal(createDefectTemplate(categories).grade_2, 0);
assert.equal(createDefectTemplate({}).grade_1, undefined);
assert.equal(createDefectTemplate({}).grade_2, undefined);
// Workbook 22-12-2025!F11:AH27, including its 12 empty sample rows.
const samples = [
  { defects: { acarus: 1, fall_drop: 1, grade_1: 2, grade_2: 2 } },
  { defects: { vegetable_defects: 1, cuts: 1, navel_blight: 1 } },
  { defects: { citrus_rust: 1, tearing: 1, molds: 1 } },
  ...Array.from({ length: 12 }, () => ({ defects: {} })),
];
const metrics = calculateQualityMetrics(samples, 15);
assert.equal(metrics.sumAF, 3);
assert.equal(metrics.sumAG, 5);
assert.equal(metrics.sumAH, 12);
assert.equal(metrics.pctBruisesCuts, '8.33');
assert.equal(metrics.pctHighCut, '0.00');
assert.deepEqual([metrics.totals.grade_1, metrics.totals.grade_2, metrics.sumAF, metrics.sumAG]
  .map((value) => (value / metrics.sumAH * 100).toFixed(2)), ['16.67', '16.67', '25.00', '41.67']);
assert.equal(calculateQualityMetrics([{ defects: { high_cut: 3, grade_1: 6 } }], 1).sumAH, 6);
assert.equal(calculateQualityMetrics([], 0).pctBruisesCuts, '0.00');
console.log('Quality grades and workbook percentages passed.');
