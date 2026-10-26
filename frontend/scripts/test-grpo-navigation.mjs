import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'src/pages/PurchaseGRPODraftPage.jsx'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/purchaseGrpoService.js'), 'utf8');
const costCenterHook = fs.readFileSync(path.join(root, 'src/hooks/useCostCenterOptions.js'), 'utf8');

const approveBlock = page.slice(
  page.indexOf('const handleApproveForPosting'),
  page.indexOf('const handlePostToSap'),
);
assert(!approveBlock.includes('saveDraft('), 'Approve must not send a redundant PATCH before approval');

const nextBlock = page.slice(
  page.indexOf('const handleNext'),
  page.indexOf('const handlePrevious'),
);
assert(!nextBlock.includes('else if (draft && canEdit)'), 'Intermediate GRPO steps must not save incomplete drafts');
assert.equal(
  (nextBlock.match(/saveDraft\(\{ silent: true \}\)/g) || []).length,
  2,
  'Manual and standard flows should each save once when entering Review',
);
assert(service.includes('loadCostCenters(1)') === false, 'Dimension selection belongs to the page loader');
assert(costCenterHook.includes('requestDimension(1);') && costCenterHook.includes('requestDimension(2);'), 'Location and General must load dimensions 1 and 2 independently');
assert(service.includes("dimension === 1 ? { timeout: 60000 } : undefined"), 'Only the larger Location dimension should receive the extended request budget');

console.log('GRPO navigation and cost-center loading checks passed.');
