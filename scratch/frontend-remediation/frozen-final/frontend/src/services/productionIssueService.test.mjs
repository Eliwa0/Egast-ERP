import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  setApiClient,
  validateIssueWizardState,
  buildPendingIssuePayload,
  fetchOpenProductionOrders,
  fetchProductionOrderDetails,
  submitPendingIssue,
} from './productionIssueService.js';
import { translations } from '../i18n/translations.js';

// ── Mock Data Fixtures ──────────────────────────────────────────────────────
const mockReleasedOrder = {
  docEntry: 1234,
  orderNumber: '5678',
  itemCode: 'FERT-001',
  itemName: 'Finished Product 1',
  plannedQty: 100,
  completedQty: 20,
  remainingQty: 80,
  warehouse: '01',
  postDate: '2026-09-01',
  dueDate: '2026-10-15',
  status: 'R',
  statusName: 'Released',
};

const mockComponents = {
  0: {
    lineNumber: 0,
    itemCode: 'RAW-001',
    itemName: 'Raw Material 1',
    plannedQuantity: 50,
    issuedQuantity: 10,
    remainingQuantity: 40,
    uomCode: 'KG',
    warehouseCode: '01',
    issueType: 'Manual',
    selected: true,
    issueQuantity: 15,
  },
  1: {
    lineNumber: 1,
    itemCode: 'RAW-002',
    itemName: 'Raw Material 2',
    plannedQuantity: 30,
    issuedQuantity: 5,
    remainingQuantity: 25,
    uomCode: 'PCS',
    warehouseCode: '01',
    issueType: 'Manual',
    selected: true,
    issueQuantity: 10,
  },
  2: {
    lineNumber: 2,
    itemCode: 'RAW-003',
    itemName: 'Raw Material 3',
    plannedQuantity: 10,
    issuedQuantity: 10,
    remainingQuantity: 0,
    uomCode: 'L',
    warehouseCode: '01',
    issueType: 'Manual',
    selected: false,
    issueQuantity: 0,
  },
};

const mockValidAllocations = {
  0: [
    { batchNumber: 'B001', binAbsEntry: 55, quantity: 10 },
    { batchNumber: 'B002', binAbsEntry: 56, quantity: 5 },
  ],
  1: [
    { batchNumber: 'B003', binAbsEntry: 55, quantity: 10 },
  ],
};

const mockDocumentInfo = {
  postingDate: '2026-09-30',
  documentDate: '2026-09-30',
  comments: 'Issue for Production Order #5678',
  journalMemo: 'Issue for Production - 5678',
};

// ── Test Suites ─────────────────────────────────────────────────────────────

test('1. Production Order and Component remaining quantity calculations', () => {
  const comp = mockComponents[0];
  const calculatedRemaining = comp.plannedQuantity - comp.issuedQuantity;
  assert.equal(comp.remainingQuantity, calculatedRemaining);
  assert.equal(comp.remainingQuantity, 40);
});

test('2. Released order selection requirement', () => {
  const stateNoOrder = {
    selectedOrder: null,
    selectedComponents: mockComponents,
    allocations: mockValidAllocations,
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateNoOrder);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /Production order must be selected/i);
});

test('3. Component selection validation: requires at least one selected component', () => {
  const unselectedComponents = {
    0: { ...mockComponents[0], selected: false },
    1: { ...mockComponents[1], selected: false },
  };
  const stateNoSelection = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: unselectedComponents,
    allocations: {},
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateNoSelection);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /At least one component must be selected/i);
});

test('4. Issue quantity validation: rejects zero or negative quantity', () => {
  const zeroQtyComponents = {
    0: { ...mockComponents[0], issueQuantity: 0 },
  };
  const stateZero = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: zeroQtyComponents,
    allocations: {},
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateZero);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /must be greater than zero/i);
});

test('5. Issue quantity validation: rejects quantity exceeding remaining', () => {
  const excessQtyComponents = {
    0: { ...mockComponents[0], issueQuantity: 45 }, // remaining is 40
  };
  const stateExcess = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: excessQtyComponents,
    allocations: {},
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateExcess);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /exceeds remaining/i);
});

test('6. Allocation total validation: blocks batch/bin allocation sum mismatch', () => {
  const mismatchedAllocations = {
    0: [
      { batchNumber: 'B001', binAbsEntry: 55, quantity: 10 },
      { batchNumber: 'B002', binAbsEntry: 56, quantity: 2 }, // sum 12 != issueQuantity 15
    ],
  };
  const stateMismatch = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: { 0: mockComponents[0] },
    allocations: mismatchedAllocations,
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateMismatch);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /does not match issue quantity/i);
});

test('7. Allocation row validation: blocks non-positive allocation quantity', () => {
  const negativeAllocations = {
    0: [
      { batchNumber: 'B001', binAbsEntry: 55, quantity: -5 },
      { batchNumber: 'B002', binAbsEntry: 56, quantity: 20 },
    ],
  };
  const stateNegative = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: { 0: mockComponents[0] },
    allocations: negativeAllocations,
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateNegative);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /must be greater than zero/i);
});

test('8. Full valid state passes validation with multiple components and allocations', () => {
  const validState = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: mockComponents,
    allocations: mockValidAllocations,
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(validState);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('9. Payload builder constructs exact Phase 1 backend contract', () => {
  const validState = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: mockComponents,
    allocations: mockValidAllocations,
    documentInfo: mockDocumentInfo,
  };
  const payload = buildPendingIssuePayload(validState);

  assert.equal(payload.production_order_doc_entry, 1234);
  assert.equal(payload.production_order_doc_num, '5678');
  assert.equal(payload.production_order_item_code, 'FERT-001');
  assert.equal(payload.production_order_item_name, 'Finished Product 1');
  assert.equal(payload.posting_date, '2026-09-30');
  assert.equal(payload.document_date, '2026-09-30');
  assert.equal(payload.comments, 'Issue for Production Order #5678');
  assert.equal(payload.journal_memo, 'Issue for Production - 5678');

  // Lines: only selected lines 0 and 1 (line 2 unselected)
  assert.equal(payload.lines.length, 2);

  const line0 = payload.lines[0];
  assert.equal(line0.line_number, 0);
  assert.equal(line0.item_code, 'RAW-001');
  assert.equal(line0.issue_quantity, 15);
  assert.equal(line0.allocations.length, 2);
  assert.equal(line0.allocations[0].batch_number, 'B001');
  assert.equal(line0.allocations[0].bin_abs_entry, 55);
  assert.equal(line0.allocations[0].quantity, 10);
  assert.equal(line0.allocations[1].batch_number, 'B002');
  assert.equal(line0.allocations[1].bin_abs_entry, 56);
  assert.equal(line0.allocations[1].quantity, 5);

  const line1 = payload.lines[1];
  assert.equal(line1.line_number, 1);
  assert.equal(line1.item_code, 'RAW-002');
  assert.equal(line1.issue_quantity, 10);
  assert.equal(line1.allocations.length, 1);
  assert.equal(line1.allocations[0].batch_number, 'B003');
});

test('10. Payload builder does NOT contain SAP Service Layer endpoint or headers', () => {
  const validState = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: mockComponents,
    allocations: mockValidAllocations,
    documentInfo: mockDocumentInfo,
  };
  const payload = buildPendingIssuePayload(validState);

  // Must NOT contain InventoryGenExits fields directly — those belong to backend approve-post
  assert.equal(payload.DocType, undefined);
  assert.equal(payload.DocumentLines, undefined);
  assert.equal(payload.status, undefined);
});

test('11. Standard non-batch components support empty allocations', () => {
  const stateNoAllocations = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: {
      0: { ...mockComponents[0], issueQuantity: 10, manageBatchNumbers: false, manageSerialNumbers: false },
    },
    allocations: { 0: [] },
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateNoAllocations);
  assert.equal(res.valid, true);

  const payload = buildPendingIssuePayload(stateNoAllocations);
  assert.equal(payload.lines[0].allocations.length, 0);
});

test('11b. Batch-managed component without allocations is rejected by validateIssueWizardState', () => {
  const stateBatchMissing = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: {
      0: { ...mockComponents[0], issueQuantity: 10, manageBatchNumbers: true },
    },
    allocations: { 0: [] },
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateBatchMissing);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /batch selection is required/i);
});

test('11c. Serial-managed component without serial numbers is rejected by validateIssueWizardState', () => {
  const stateSerialMissing = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: {
      0: { ...mockComponents[0], issueQuantity: 2, manageSerialNumbers: true },
    },
    allocations: { 0: [] },
    documentInfo: mockDocumentInfo,
  };
  const res = validateIssueWizardState(stateSerialMissing);
  assert.equal(res.valid, false);
  assert.match(res.errors[0], /serial selection is required/i);
});

test('12. Translation coverage: all required keys exist in en and ar', () => {
  assert.ok(translations.en.issueWizard, 'en.issueWizard namespace exists');
  assert.ok(translations.ar.issueWizard, 'ar.issueWizard namespace exists');
  assert.ok(translations.en.production.issueTitle, 'en.production.issueTitle exists');
  assert.ok(translations.ar.production.issueTitle, 'ar.production.issueTitle exists');
  assert.ok(translations.en.production.issueStart, 'en.production.issueStart exists');
  assert.ok(translations.ar.production.issueStart, 'ar.production.issueStart exists');

  const requiredKeys = [
    'title',
    'pageTitle',
    'pageDesc',
    'step1',
    'step1Desc',
    'step2',
    'step2Desc',
    'step3',
    'step3Desc',
    'step4',
    'step4Desc',
    'step5',
    'step5Desc',
    'orderNumber',
    'plannedQty',
    'remainingQty',
    'issueQty',
    'allocationTitle',
    'batchNumber',
    'binLocation',
    'allocatedQty',
    'reviewTitle',
    'reviewNotice',
    'submitForReview',
    'submitting',
    'successTitle',
    'pendingReview',
    'pendingIssueId',
    'backToProduction',
  ];

  for (const k of requiredKeys) {
    assert.ok(
      translations.en.issueWizard[k] && typeof translations.en.issueWizard[k] === 'string',
      `en.issueWizard.${k} missing or invalid`
    );
    assert.ok(
      translations.ar.issueWizard[k] && typeof translations.ar.issueWizard[k] === 'string',
      `ar.issueWizard.${k} missing or invalid`
    );
  }
});

test('13. fetchOpenProductionOrders filters for Released status only', async () => {
  const mockApi = {
    get: async (url) => {
      assert.equal(url, '/open-production-orders/');
      return {
        data: {
          data: {
            orders: [
              { docEntry: 1, orderNumber: '101', status: 'R', plannedQty: 10, completedQty: 0 },
              { docEntry: 2, orderNumber: '102', status: 'P', plannedQty: 20, completedQty: 0 }, // Planned - exclude
              { docEntry: 3, orderNumber: '103', status: 'boposReleased', plannedQty: 30, completedQty: 5 }, // Released - include
              { docEntry: 4, orderNumber: '104', status: 'C', plannedQty: 40, completedQty: 40 }, // Closed - exclude
            ],
          },
        },
      };
    },
  };
  setApiClient(mockApi);

  const orders = await fetchOpenProductionOrders();
  assert.equal(orders.length, 2);
  assert.equal(orders[0].docEntry, 1);
  assert.equal(orders[1].docEntry, 3);
});

test('14. fetchProductionOrderDetails normalizes SAP lines and calculates remaining', async () => {
  const mockApi = {
    get: async (url) => {
      assert.equal(url, '/production-orders/1234/');
      return {
        data: {
          data: {
            order: {
              DocEntry: 1234,
              DocNum: 5678,
              ItemNo: 'FERT-1',
              ProdName: 'Product 1',
              ProductionOrderStatus: 'boposReleased',
              ProductionOrderLines: [
                {
                  LineNumber: 0,
                  ItemNo: 'RAW-1',
                  ItemDescription: 'Component 1',
                  PlannedQuantity: 100,
                  IssuedQuantity: 30,
                  Warehouse: '01',
                  UoMCode: 'KG',
                  ProductionOrderIssueType: 'boposManual',
                },
              ],
            },
          },
        },
      };
    },
  };
  setApiClient(mockApi);

  const details = await fetchProductionOrderDetails(1234);
  assert.equal(details.docEntry, 1234);
  assert.equal(details.lines.length, 1);
  const line = details.lines[0];
  assert.equal(line.itemCode, 'RAW-1');
  assert.equal(line.plannedQuantity, 100);
  assert.equal(line.issuedQuantity, 30);
  assert.equal(line.remainingQuantity, 70);
  assert.equal(line.issueType, 'Manual');
});

test('15. submitPendingIssue calls POST /pending-issues/ and returns response without calling SAP', async () => {
  let postUrlCalled = null;
  let postPayloadPassed = null;

  const mockApi = {
    post: async (url, payload) => {
      postUrlCalled = url;
      postPayloadPassed = payload;
      return {
        data: {
          success: true,
          data: {
            pending_issue_id: 88,
            status: 'PENDING_REVIEW',
            total_components: 2,
            total_quantity: 25,
          },
        },
      };
    },
  };
  setApiClient(mockApi);

  const validState = {
    selectedOrder: mockReleasedOrder,
    selectedComponents: mockComponents,
    allocations: mockValidAllocations,
    documentInfo: mockDocumentInfo,
  };

  const res = await submitPendingIssue(validState);
  assert.equal(res.success, true);
  assert.equal(res.data.pending_issue_id, 88);
  assert.equal(res.data.status, 'PENDING_REVIEW');
  assert.equal(postUrlCalled, '/pending-issues/');

  // Verify that it only posts the pending issue payload, never calls SAP Service Layer
  assert.ok(postPayloadPassed.production_order_doc_entry);
  assert.equal(postPayloadPassed.DocType, undefined);
});
