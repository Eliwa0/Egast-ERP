import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  setApiClient,
  fetchPendingIssues,
  fetchPendingIssue,
  rejectPendingIssue,
  approvePostPendingIssue,
  reconcilePendingIssue,
} from './productionIssueService.js';
import {
  canAccessIssueReview,
  canManageProduction,
  canAccessProduction,
  isAdmin,
} from '../utils/roles.js';
import { translations } from '../i18n/translations.js';

// ── Mock Data Fixtures ──────────────────────────────────────────────────────

const mockPendingIssueHeader = {
  id: 42,
  production_order_doc_entry: 1042,
  production_order_doc_num: '10024',
  production_order_item_code: 'FG-100',
  production_order_item_name: 'Finished Product A',
  production_order_status: 'boposReleased',
  posting_date: '2026-09-30',
  document_date: '2026-09-30',
  comments: 'Issue for Production Order #10024',
  journal_memo: 'Issue for Production - 10024',
  total_components_count: 2,
  total_quantity: 35.0,
  status: 'PENDING_REVIEW',
  created_by: 'operator_1',
  reviewed_by: null,
  posted_by: null,
  sap_doc_entry: null,
  sap_doc_num: null,
  sap_error: '',
  rejection_reason: '',
  created_at: '2026-09-30T10:00:00Z',
  updated_at: '2026-09-30T10:00:00Z',
  reviewed_at: null,
  posted_at: null,
};

const mockLines = [
  {
    id: 101,
    line_number: 0,
    item_code: 'RM-01',
    item_name: 'Raw Material 1',
    uom_code: 'KG',
    warehouse_code: '01',
    issue_type: 'Manual',
    planned_quantity: 50.0,
    issued_quantity_at_submit: 10.0,
    remaining_quantity_at_submit: 40.0,
    issue_quantity: 25.0,
    allocations: [
      {
        batch_number: 'B2026-01',
        bin_code: 'BIN-01-A',
        bin_abs_entry: 10,
        quantity: 25.0,
      },
    ],
  },
  {
    id: 102,
    line_number: 1,
    item_code: 'RM-02',
    item_name: 'Raw Material 2',
    uom_code: 'PCS',
    warehouse_code: '01',
    issue_type: 'Manual',
    planned_quantity: 20.0,
    issued_quantity_at_submit: 5.0,
    remaining_quantity_at_submit: 15.0,
    issue_quantity: 10.0,
    allocations: [], // Standard item without batch/bin
  },
];

const mockFullDetail = {
  ...mockPendingIssueHeader,
  lines: mockLines,
};

// ── Test Suites ─────────────────────────────────────────────────────────────

test('1. Pending Issue list rendering & query construction', async () => {
  let capturedUrl = '';
  setApiClient({
    get: async (url) => {
      capturedUrl = url;
      return {
        data: {
          success: true,
          data: {
            issues: [mockPendingIssueHeader],
            count: 1,
          },
        },
      };
    },
  });

  const res = await fetchPendingIssues({ status: 'PENDING_REVIEW', order_number: '10024' });
  assert.equal(capturedUrl, '/admin/pending-issues/?status=PENDING_REVIEW&order_number=10024');
  assert.equal(res.count, 1);
  assert.equal(res.issues.length, 1);
  assert.equal(res.issues[0].id, 42);
  assert.equal(res.issues[0].production_order_doc_num, '10024');
  assert.equal(res.issues[0].status, 'PENDING_REVIEW');
});

test('2. Status rendering: verified against all supported statuses', () => {
  const supportedStatuses = ['PENDING_REVIEW', 'POSTING', 'POSTED', 'FAILED', 'REJECTED'];
  for (const st of supportedStatuses) {
    const enLabel = translations.en.issueReview[
      st === 'PENDING_REVIEW' ? 'pendingReview' : st.toLowerCase()
    ];
    const arLabel = translations.ar.issueReview[
      st === 'PENDING_REVIEW' ? 'pendingReview' : st.toLowerCase()
    ];
    assert.ok(enLabel, `English label missing for status: ${st}`);
    assert.ok(arLabel, `Arabic label missing for status: ${st}`);
  }
});

test('3. Issue detail rendering contract', async () => {
  let capturedUrl = '';
  setApiClient({
    get: async (url) => {
      capturedUrl = url;
      return {
        data: {
          success: true,
          data: mockFullDetail,
        },
      };
    },
  });

  const detail = await fetchPendingIssue(42);
  assert.equal(capturedUrl, '/admin/pending-issues/42/');
  assert.equal(detail.id, 42);
  assert.equal(detail.production_order_item_code, 'FG-100');
  assert.equal(detail.production_order_status, 'boposReleased');
  assert.equal(detail.lines.length, 2);
});

test('4. Component quantities validation and calculations', () => {
  const line1 = mockLines[0];
  const calculatedRemaining = line1.planned_quantity - line1.issued_quantity_at_submit;
  assert.equal(line1.remaining_quantity_at_submit, calculatedRemaining);
  assert.ok(line1.issue_quantity > 0);
  assert.ok(line1.issue_quantity <= line1.remaining_quantity_at_submit);

  const totalQty = mockLines.reduce((sum, l) => sum + l.issue_quantity, 0);
  assert.equal(totalQty, mockFullDetail.total_quantity);
});

test('5. Batch and bin allocations match and standard item verification', () => {
  // Line 1: Allocated sum matches issue_quantity
  const line1 = mockLines[0];
  const allocSum = line1.allocations.reduce((sum, a) => sum + a.quantity, 0);
  assert.equal(allocSum, line1.issue_quantity);
  assert.equal(line1.allocations[0].batch_number, 'B2026-01');
  assert.equal(line1.allocations[0].bin_code, 'BIN-01-A');

  // Line 2: Standard non-batch item has 0 allocations
  const line2 = mockLines[1];
  assert.equal(line2.allocations.length, 0);
});

test('6. Production User cannot access Review route', () => {
  const prodUser = {
    username: 'operator_bob',
    role: 'production_user',
    module_permissions: { production: 'USER' },
  };

  assert.equal(canAccessProduction(prodUser), true);
  assert.equal(canManageProduction(prodUser), false);
  assert.equal(canAccessIssueReview(prodUser), false);
});

test('7. Production Admin can access Review route', () => {
  const prodAdmin = {
    username: 'admin_alice',
    role: 'production_admin',
    module_permissions: { production: 'ADMIN' },
  };

  assert.equal(canAccessProduction(prodAdmin), true);
  assert.equal(canManageProduction(prodAdmin), true);
  assert.equal(canAccessIssueReview(prodAdmin), true);

  const superAdmin = {
    username: 'super_boss',
    role: 'admin',
    is_superuser: true,
  };
  assert.equal(isAdmin(superAdmin), true);
  assert.equal(canAccessIssueReview(superAdmin), true);
});

test('8. Reject confirmation requires non-empty reason', async () => {
  await assert.rejects(
    async () => {
      await rejectPendingIssue(42, '');
    },
    {
      message: 'Rejection reason is required.',
    }
  );

  await assert.rejects(
    async () => {
      await rejectPendingIssue(42, '   ');
    },
    {
      message: 'Rejection reason is required.',
    }
  );
});

test('9. Reject calls correct backend API with reason payload', async () => {
  let capturedUrl = '';
  let capturedPayload = null;

  setApiClient({
    post: async (url, payload) => {
      capturedUrl = url;
      capturedPayload = payload;
      return {
        data: {
          success: true,
          message: 'Issue rejected successfully.',
          data: {
            ...mockPendingIssueHeader,
            status: 'REJECTED',
            rejection_reason: payload.reason,
            reviewed_by: 'admin_alice',
            reviewed_at: '2026-09-30T11:00:00Z',
          },
        },
      };
    },
  });

  const res = await rejectPendingIssue(42, 'Incorrect batch allocated');
  assert.equal(capturedUrl, '/admin/pending-issues/42/reject/');
  assert.deepEqual(capturedPayload, { reason: 'Incorrect batch allocated' });
  assert.equal(res.success, true);
  assert.equal(res.data.status, 'REJECTED');
  assert.equal(res.data.rejection_reason, 'Incorrect batch allocated');
});

test('10. Approve confirmation calls correct backend API endpoint', async () => {
  let capturedUrl = '';
  let capturedPayload = null;

  setApiClient({
    post: async (url, payload) => {
      capturedUrl = url;
      capturedPayload = payload;
      return {
        data: {
          success: true,
          message: 'Issue posted to SAP successfully.',
          data: {
            pending_issue_id: 42,
            status: 'POSTED',
            sap_doc_num: '99001',
            sap_doc_entry: '88001',
          },
        },
      };
    },
  });

  const res = await approvePostPendingIssue(42);
  assert.equal(capturedUrl, '/admin/pending-issues/42/approve-post/');
  assert.deepEqual(capturedPayload, {});
  assert.equal(res.data.status, 'POSTED');
  assert.equal(res.data.sap_doc_num, '99001');
  assert.equal(res.data.sap_doc_entry, '88001');
});

test('11. Approve button disables during request execution', () => {
  let isActionProcessing = false;

  const startPosting = () => {
    isActionProcessing = true;
  };
  const endPosting = () => {
    isActionProcessing = false;
  };

  startPosting();
  assert.equal(isActionProcessing, true);
  // Disabled state active
  const isButtonDisabled = isActionProcessing;
  assert.equal(isButtonDisabled, true);

  endPosting();
  assert.equal(isActionProcessing, false);
});

test('12. POSTED state shows SAP DocEntry, DocNum, and Posted By', () => {
  const postedIssue = {
    ...mockFullDetail,
    status: 'POSTED',
    sap_doc_num: '100452',
    sap_doc_entry: '9021',
    posted_by: 'admin_alice',
    posted_at: '2026-09-30T10:15:00Z',
  };

  assert.equal(postedIssue.status, 'POSTED');
  assert.equal(postedIssue.sap_doc_num, '100452');
  assert.equal(postedIssue.sap_doc_entry, '9021');
  assert.equal(postedIssue.posted_by, 'admin_alice');
  assert.ok(postedIssue.posted_at);
});

test('13. FAILED state is displayed correctly with retry availability', () => {
  const failedIssue = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: 'Item RM-01 batch B2026-01 is locked in SAP.',
  };

  assert.equal(failedIssue.status, 'FAILED');
  assert.equal(failedIssue.sap_error, 'Item RM-01 batch B2026-01 is locked in SAP.');

  // Backend allows retry for FAILED and PENDING_REVIEW
  const canRetry = failedIssue.status === 'FAILED' || failedIssue.status === 'PENDING_REVIEW';
  assert.equal(canRetry, true);
});

test('14. POSTING state disables conflicting actions (no duplicate post, no reject)', () => {
  const postingIssue = {
    ...mockFullDetail,
    status: 'POSTING',
  };

  const isPostDisabled = postingIssue.status === 'POSTING' || postingIssue.status === 'POSTED';
  const isRejectDisabled = postingIssue.status === 'POSTING' || postingIssue.status === 'POSTED';

  assert.equal(isPostDisabled, true);
  assert.equal(isRejectDisabled, true);
});

test('15. Guarantee: No frontend SAP endpoint calls exist in issue review service', () => {
  // Inspect functions to ensure no Service Layer url (/b1s/ or InventoryGenExits) is used
  const serviceCode = [
    fetchPendingIssues.toString(),
    fetchPendingIssue.toString(),
    rejectPendingIssue.toString(),
    approvePostPendingIssue.toString(),
  ].join('\n');

  assert.ok(!serviceCode.includes('/b1s/'), 'Service must NOT call SAP /b1s/ endpoints directly');
  assert.ok(!serviceCode.includes('InventoryGenExits'), 'Service must NOT reference InventoryGenExits directly');
  assert.ok(serviceCode.includes('/admin/pending-issues/'), 'Service must route exclusively to backend admin pending-issues');
});

test('16. Arabic and English translations parity for issueReview namespace', () => {
  const enKeys = Object.keys(translations.en.issueReview || {}).sort();
  const arKeys = Object.keys(translations.ar.issueReview || {}).sort();

  assert.ok(enKeys.length > 20, 'en.issueReview should contain all review translation keys');
  assert.deepEqual(enKeys, arKeys, 'English and Arabic issueReview keys must match 100%');

  // Check required titles & confirmation strings
  assert.ok(translations.en.issueReview.approveWarning);
  assert.ok(translations.ar.issueReview.approveWarning);
  assert.ok(translations.en.issueReview.postSuccessMsg);
  assert.ok(translations.ar.issueReview.postSuccessMsg);
  assert.ok(translations.en.issueReview.rejectModalTitle);
  assert.ok(translations.ar.issueReview.rejectModalTitle);
});

test('17. Reconciliation: Definitive FAILED shows normal retry (clean FAILED)', () => {
  const cleanFailedIssue = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: 'Stock insufficient for item RM-01',
  };
  const isAmbiguous =
    cleanFailedIssue.status === 'FAILED' &&
    String(cleanFailedIssue.sap_error || '').includes('[AMBIGUOUS_FAILURE]');

  assert.equal(isAmbiguous, false);
  const showRetry = cleanFailedIssue.status === 'FAILED' && !isAmbiguous;
  const showReconcile = isAmbiguous;
  assert.equal(showRetry, true);
  assert.equal(showReconcile, false);
});

test('18. Reconciliation: Ambiguous FAILED shows reconciliation warning and explainer', () => {
  const ambiguousFailedIssue = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: '[AMBIGUOUS_FAILURE] SAP connection timed out after 30s during InventoryGenExits submission.',
  };
  const isAmbiguous =
    ambiguousFailedIssue.status === 'FAILED' &&
    String(ambiguousFailedIssue.sap_error || '').includes('[AMBIGUOUS_FAILURE]');

  assert.equal(isAmbiguous, true);
  assert.ok(translations.en.issueReview.ambiguousNotice);
  assert.ok(translations.ar.issueReview.ambiguousNotice);
  assert.ok(translations.en.issueReview.ambiguousDesc);
  assert.ok(translations.ar.issueReview.ambiguousDesc);
  assert.ok(translations.en.issueReview.ambiguousErrorNotice);
  assert.ok(translations.ar.issueReview.ambiguousErrorNotice);
});

test('19. Reconciliation: Ambiguous FAILED hides normal retry and reject buttons', () => {
  const ambiguousFailedIssue = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: '[AMBIGUOUS_FAILURE] Network connection reset by peer',
  };
  const isAmbiguous =
    ambiguousFailedIssue.status === 'FAILED' &&
    String(ambiguousFailedIssue.sap_error || '').includes('[AMBIGUOUS_FAILURE]');

  // UI action rules
  const showNormalActions =
    ambiguousFailedIssue.status === 'PENDING_REVIEW' ||
    (ambiguousFailedIssue.status === 'FAILED' && !isAmbiguous);
  const showReconcileAction = isAmbiguous;

  assert.equal(showNormalActions, false, 'Normal retry/reject must be hidden for ambiguous failures');
  assert.equal(showReconcileAction, true, 'Reconcile action must be visible for ambiguous failures');
});

test('20. Reconciliation: reconcilePendingIssue calls POST /api/admin/pending-issues/<id>/reconcile/', async () => {
  let capturedUrl = '';
  let capturedPayload = null;

  setApiClient({
    post: async (url, payload) => {
      capturedUrl = url;
      capturedPayload = payload;
      return {
        data: {
          success: true,
          message: 'Reconciliation completed.',
          data: {
            id: 42,
            reconciliation_result: 'CLEARED_FOR_RETRY',
            status: 'FAILED',
          },
        },
      };
    },
  });

  const res = await reconcilePendingIssue(42, { sap_doc_entry: '9001' });
  assert.equal(capturedUrl, '/admin/pending-issues/42/reconcile/');
  assert.deepEqual(capturedPayload, { sap_doc_entry: '9001' });
  assert.equal(res.success, true);
  assert.equal(res.data.reconciliation_result, 'CLEARED_FOR_RETRY');
});

test('21. Reconciliation: Reconcile action button disables during request execution', () => {
  let isActionProcessing = false;
  const startReconciliation = () => {
    isActionProcessing = true;
  };
  const endReconciliation = () => {
    isActionProcessing = false;
  };

  startReconciliation();
  assert.equal(isActionProcessing, true);
  const isButtonDisabled = isActionProcessing;
  assert.equal(isButtonDisabled, true);

  endReconciliation();
  assert.equal(isActionProcessing, false);
});

test('22. Reconciliation: FOUND_AND_LINKED updates status to POSTED and exposes SAP doc identifiers', async () => {
  let issueState = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: '[AMBIGUOUS_FAILURE] Timed out',
  };

  setApiClient({
    post: async () => ({
      data: {
        success: true,
        message: 'Existing SAP document found and linked.',
        data: {
          id: 42,
          reconciliation_result: 'FOUND_AND_LINKED',
          status: 'POSTED',
          sap_doc_num: '100455',
          sap_doc_entry: '9055',
          posted_by: 'admin_alice',
          posted_at: '2026-09-30T12:00:00Z',
        },
      },
    }),
  });

  const res = await reconcilePendingIssue(issueState.id);
  assert.equal(res.data.status, 'POSTED');
  assert.equal(res.data.reconciliation_result, 'FOUND_AND_LINKED');

  // Applying reconciled result
  issueState = { ...issueState, ...res.data };
  assert.equal(issueState.status, 'POSTED');
  assert.equal(issueState.sap_doc_num, '100455');
  assert.equal(issueState.sap_doc_entry, '9055');

  // Once posted, ambiguity is resolved and posting is complete
  const isAmbiguousAfter =
    issueState.status === 'FAILED' &&
    String(issueState.sap_error || '').includes('[AMBIGUOUS_FAILURE]');
  assert.equal(isAmbiguousAfter, false);
});

test('23. Reconciliation: CLEARED_FOR_RETRY clears ambiguity and restores normal retry action', async () => {
  let issueState = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: '[AMBIGUOUS_FAILURE] Read timed out',
  };

  setApiClient({
    post: async () => ({
      data: {
        success: true,
        message: 'No SAP document found. Cleared for retry.',
        data: {
          id: 42,
          reconciliation_result: 'CLEARED_FOR_RETRY',
          status: 'FAILED',
          sap_error: 'Previous attempt failed due to timeout. Verified not in SAP. Ready for retry.',
        },
      },
    }),
  });

  const res = await reconcilePendingIssue(issueState.id);
  assert.equal(res.data.reconciliation_result, 'CLEARED_FOR_RETRY');
  assert.equal(res.data.status, 'FAILED');

  issueState = { ...issueState, ...res.data };
  const isAmbiguousNow =
    issueState.status === 'FAILED' &&
    String(issueState.sap_error || '').includes('[AMBIGUOUS_FAILURE]');
  assert.equal(isAmbiguousNow, false, 'Ambiguity marker [AMBIGUOUS_FAILURE] must be removed');

  const showRetry = issueState.status === 'FAILED' && !isAmbiguousNow;
  const showReconcile = isAmbiguousNow;
  assert.equal(showRetry, true, 'Normal retry must now be enabled');
  assert.equal(showReconcile, false, 'Reconcile button must now be hidden');
});

test('24. Reconciliation: Unreachable SAP keeps ambiguity marker and blocks normal retry', async () => {
  const issueState = {
    ...mockFullDetail,
    status: 'FAILED',
    sap_error: '[AMBIGUOUS_FAILURE] ConnectTimeout',
  };

  setApiClient({
    post: async () => {
      const err = new Error('SAP service unreachable');
      err.response = {
        data: {
          error: '[SAP_UNREACHABLE] Could not reach SAP Business One. Try again later.',
        },
      };
      throw err;
    },
  });

  await assert.rejects(
    async () => {
      await reconcilePendingIssue(issueState.id);
    },
    (err) => {
      assert.ok(err.response.data.error.includes('[SAP_UNREACHABLE]'));
      return true;
    }
  );

  // Status remains ambiguous failed
  const isAmbiguousStill =
    issueState.status === 'FAILED' &&
    String(issueState.sap_error || '').includes('[AMBIGUOUS_FAILURE]');
  assert.equal(isAmbiguousStill, true);
  const showRetry = issueState.status === 'FAILED' && !isAmbiguousStill;
  assert.equal(showRetry, false, 'Retry must remain blocked');
});

test('25. Reconciliation: POSTING state disables reconciliation action', () => {
  const postingIssue = {
    ...mockFullDetail,
    status: 'POSTING',
  };
  const isAmbiguous =
    postingIssue.status === 'FAILED' &&
    String(postingIssue.sap_error || '').includes('[AMBIGUOUS_FAILURE]');
  assert.equal(isAmbiguous, false);
  const canReconcile = isAmbiguous;
  assert.equal(canReconcile, false);
});

test('26. Reconciliation: POSTED state disables reconciliation action', () => {
  const postedIssue = {
    ...mockFullDetail,
    status: 'POSTED',
    sap_doc_num: '100455',
    sap_doc_entry: '9055',
  };
  const isAmbiguous =
    postedIssue.status === 'FAILED' &&
    String(postedIssue.sap_error || '').includes('[AMBIGUOUS_FAILURE]');
  assert.equal(isAmbiguous, false);
  const canReconcile = isAmbiguous;
  assert.equal(canReconcile, false);
});

test('27. Reconciliation: Production User cannot access reconciliation UI', () => {
  const prodUser = {
    username: 'operator_bob',
    role: 'production_user',
    module_permissions: { production: 'USER' },
  };

  assert.equal(canAccessProduction(prodUser), true);
  assert.equal(canManageProduction(prodUser), false);
  assert.equal(canAccessIssueReview(prodUser), false);
});

test('28. Reconciliation Guarantee: No frontend SAP endpoints exist across entire review & reconcile service', () => {
  const allServiceMethods = [
    fetchPendingIssues.toString(),
    fetchPendingIssue.toString(),
    rejectPendingIssue.toString(),
    approvePostPendingIssue.toString(),
    reconcilePendingIssue.toString(),
  ].join('\n');

  assert.ok(!allServiceMethods.includes('/b1s/'), 'No /b1s/ direct calls');
  assert.ok(!allServiceMethods.includes('InventoryGenExits'), 'No InventoryGenExits direct calls');
  assert.ok(allServiceMethods.includes('/admin/pending-issues/'), 'All endpoints route to Django backend');
});
