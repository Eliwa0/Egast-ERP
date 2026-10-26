/**
 * Service for Issue for Production workflow (Drafting and local review queue).
 */

import api from './api.js';

let _apiClient = null;

export function setApiClient(client) {
  _apiClient = client;
}

function getApi() {
  return _apiClient || api;
}

/**
 * Fetch open production orders eligible for issue (Released only).
 */
export async function fetchOpenProductionOrders() {
  const api = await getApi();
  const response = await api.get('/open-production-orders/');
  const data = response.data?.data || response.data || {};
  const rawOrders = data.orders || [];

  return rawOrders
    .filter((order) => {
      const status = String(order.status || '').trim();
      return status === 'R' || status === 'boposReleased';
    })
    .map((order) => ({
      docEntry: order.docEntry || order.DocEntry,
      orderNumber: String(order.orderNumber || order.DocNum || order.docEntry || ''),
      itemCode: order.itemCode || order.ItemCode || '',
      itemName: order.itemName || order.ProdName || order.productName || '',
      plannedQty: Number(order.plannedQty || order.PlannedQuantity || 0),
      completedQty: Number(order.completedQty || order.CompletedQuantity || 0),
      remainingQty: Number(
        order.remainingQty !== undefined
          ? order.remainingQty
          : Math.max(0, Number(order.plannedQty || 0) - Number(order.completedQty || 0))
      ),
      warehouse: order.warehouse || order.Warehouse || '',
      postDate: order.postDate || order.PostDate || '',
      dueDate: order.dueDate || order.DueDate || '',
      status: order.status || 'R',
      statusName: order.statusName || 'Released',
    }));
}

/**
 * Fetch full production order details from SAP (includes component lines).
 */
export async function fetchProductionOrderDetails(docEntry) {
  const api = await getApi();
  const response = await api.get(`/production-orders/${docEntry}/`);
  const data = response.data?.data || response.data || {};
  const order = data.order || data;

  const rawLines = order.ProductionOrderLines || [];
  const lines = rawLines.map((line) => {
    const planned = Number(line.PlannedQuantity || 0);
    const issued = Number(line.IssuedQuantity || 0);
    const remaining = Math.max(0, planned - issued);

    return {
      lineNumber: Number(line.LineNumber ?? 0),
      itemCode: String(line.ItemNo || line.ItemCode || '').trim(),
      itemName: String(line.ItemDescription || line.ItemName || '').trim(),
      plannedQuantity: planned,
      issuedQuantity: issued,
      remainingQuantity: remaining,
      uomCode: String(line.UoMCode || line.Uom || '').trim(),
      warehouseCode: String(line.Warehouse || '').trim(),
      issueType: String(line.ProductionOrderIssueType || 'Manual').replace('bopos', ''),
      manageBatchNumbers: line.ManageBatchNumbers === 'tYES' || line.ManageBatchNumbers === true,
      manageSerialNumbers: line.ManageSerialNumbers === 'tYES' || line.ManageSerialNumbers === true,
    };
  });

  return {
    docEntry: order.AbsoluteEntry || order.DocEntry || docEntry,
    orderNumber: String(order.DocumentNumber || order.DocNum || docEntry),
    itemCode: String(order.ItemNo || order.ItemCode || ''),
    itemName: String(order.ProductDescription || order.ProdName || ''),
    status: order.ProductionOrderStatus || order.Status || 'R',
    plannedQuantity: Number(order.PlannedQuantity || 0),
    completedQuantity: Number(order.CompletedQuantity || 0),
    dueDate: order.DueDate || '',
    postDate: order.PostingDate || order.PostDate || '',
    lines,
  };
}

/**
 * Fetch bin locations for a given warehouse.
 */
export async function fetchWarehouseBins(warehouseCode) {
  if (!warehouseCode) return [];
  try {
    const api = await getApi();
    const response = await api.get(`/bin-locations/${encodeURIComponent(warehouseCode)}/`);
    const data = response.data?.data || response.data || [];
    const list = Array.isArray(data) ? data : (data.locations || []);

    return list.map((loc) => ({
      absEntry: Number(loc.absEntry || loc.AbsEntry || 0),
      code: String(loc.code || loc.BinCode || '').trim(),
      name: String(loc.name || loc.Description || loc.BinCode || '').trim(),
      description: String(loc.description || '').trim(),
      isSystemBin: loc.IsSystemBin === 'tYES' || loc.is_system_bin === true || String(loc.BinCode || loc.code || '').toUpperCase().includes('SYSTEM-BIN'),
    })).filter((b) => b.absEntry > 0);
  } catch (err) {
    console.warn(`[ISSUE-WIZARD] Could not fetch bins for warehouse ${warehouseCode}:`, err.message);
    return [];
  }
}

/**
 * Lookup batch details by batch number.
 */
export async function fetchBatchDetails(batchNumber) {
  if (!batchNumber) return null;
  try {
    const api = await getApi();
    const response = await api.get(`/batch-details/${encodeURIComponent(batchNumber.trim())}/`);
    return response.data?.data || response.data || null;
  } catch (err) {
    console.warn(`[ISSUE-WIZARD] Batch lookup error for ${batchNumber}:`, err.message);
    return null;
  }
}

/**
 * Fetch available in-stock batches for a component item and warehouse.
 */
export async function fetchAvailableBatchesForIssue(itemCode, warehouseCode) {
  if (!itemCode) return [];
  try {
    const api = await getApi();
    const params = new URLSearchParams();
    params.set('item_code', itemCode);
    if (warehouseCode) params.set('warehouse_code', warehouseCode);
    const response = await api.get(`/pending-issues/available-batches/?${params.toString()}`);
    const data = response.data?.batches || response.data?.data?.batches || [];
    return data;
  } catch (err) {
    console.warn(`[ISSUE-WIZARD] Could not fetch available batches for ${itemCode}:`, err.message);
    return [];
  }
}

/**
 * Validate wizard state before submitting draft.
 */
export function validateIssueWizardState(state) {
  const errors = [];

  if (!state.selectedOrder) {
    errors.push('Production order must be selected.');
  }

  const selectedLines = Object.values(state.selectedComponents || {}).filter((c) => c && c.selected);
  if (selectedLines.length === 0) {
    errors.push('At least one component must be selected for issue.');
  }

  for (const line of selectedLines) {
    const qty = Number(line.issueQuantity || 0);
    if (isNaN(qty) || qty <= 0) {
      errors.push(`Component ${line.itemCode} (Line ${line.lineNumber}): Quantity must be greater than zero.`);
    } else if (qty > line.remainingQuantity + 0.0001) {
      errors.push(
        `Component ${line.itemCode} (Line ${line.lineNumber}): Quantity (${qty}) exceeds remaining (${line.remainingQuantity}).`
      );
    }

    const isBatchManaged = line.manageBatchNumbers === true || line.ManageBatchNumbers === 'tYES';
    const isSerialManaged = line.manageSerialNumbers === true || line.ManageSerialNumbers === 'tYES';
    const isStandard = state.noBatchRequired && state.noBatchRequired[line.lineNumber];

    const allocations = (state.allocations && state.allocations[line.lineNumber]) || [];

    if (isBatchManaged && !isStandard && allocations.length === 0) {
      errors.push(`Component ${line.itemCode} (Line ${line.lineNumber}): Batch selection is required for batch-managed item.`);
    }

    if (isSerialManaged && !isStandard && allocations.length === 0) {
      errors.push(`Component ${line.itemCode} (Line ${line.lineNumber}): Serial selection is required for serial-managed item.`);
    }

    if (allocations.length > 0) {
      let allocTotal = 0;
      for (let i = 0; i < allocations.length; i++) {
        const a = allocations[i];
        const aQty = Number(a.quantity || 0);
        if (isNaN(aQty) || aQty <= 0) {
          errors.push(
            `Component ${line.itemCode}: Allocation row ${i + 1} quantity must be greater than zero.`
          );
        }
        if (isBatchManaged && !a.batchNumber && !a.batch_number) {
          errors.push(`Component ${line.itemCode}: Allocation row ${i + 1} must specify a batch number.`);
        }
        if (isSerialManaged && !a.serialNumber && !a.serial_number && !a.batchNumber && !a.batch_number) {
          errors.push(`Component ${line.itemCode}: Allocation row ${i + 1} must specify a serial number.`);
        }
        allocTotal += aQty;
      }

      if (Math.abs(allocTotal - qty) > 0.0001) {
        errors.push(
          `Component ${line.itemCode}: Total allocated quantity (${allocTotal}) does not match issue quantity (${qty}).`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format wizard state into authoritative Phase 1 POST /api/pending-issues/ payload.
 */
export function buildPendingIssuePayload(state) {
  const order = state.selectedOrder || {};
  const docInfo = state.documentInfo || {};
  const selectedLines = Object.values(state.selectedComponents || {})
    .filter((c) => c && c.selected)
    .sort((a, b) => a.lineNumber - b.lineNumber);

  const lines = selectedLines.map((comp) => {
    const rawAllocations = (state.allocations && state.allocations[comp.lineNumber]) || [];
    const formattedAllocations = rawAllocations
      .map((alloc) => ({
        batch_number: alloc.batchNumber ? String(alloc.batchNumber).trim() : (alloc.batch_number ? String(alloc.batch_number).trim() : undefined),
        serial_number: alloc.serialNumber ? String(alloc.serialNumber).trim() : (alloc.serial_number ? String(alloc.serial_number).trim() : undefined),
        bin_code: alloc.binCode ? String(alloc.binCode).trim() : (alloc.bin_code ? String(alloc.bin_code).trim() : undefined),
        bin_abs_entry: alloc.binAbsEntry ? Number(alloc.binAbsEntry) : (alloc.bin_abs_entry ? Number(alloc.bin_abs_entry) : undefined),
        quantity: Number(alloc.quantity || 0),
      }))
      .filter((a) => a.batch_number || a.serial_number || a.bin_code || a.bin_abs_entry || a.quantity > 0);

    return {
      line_number: comp.lineNumber,
      item_code: comp.itemCode,
      item_name: comp.itemName,
      uom_code: comp.uomCode,
      warehouse_code: comp.warehouseCode,
      issue_type: comp.issueType,
      issue_quantity: Number(comp.issueQuantity),
      allocations: formattedAllocations,
    };
  });

  return {
    production_order_doc_entry: order.docEntry,
    production_order_doc_num: String(order.orderNumber),
    production_order_item_code: order.itemCode,
    production_order_item_name: order.itemName,
    posting_date: docInfo.postingDate || new Date().toISOString().split('T')[0],
    document_date: docInfo.documentDate || docInfo.postingDate || new Date().toISOString().split('T')[0],
    comments: docInfo.comments || `Issue for Production Order #${order.orderNumber}`,
    journal_memo: docInfo.journalMemo || `Issue for Production - ${order.orderNumber}`,
    lines,
  };
}

/**
 * Submit draft issue to backend.
 * Calls ONLY POST /api/pending-issues/ (local DB record, DOES NOT call SAP write endpoint).
 */
export async function submitPendingIssue(state) {
  const validation = validateIssueWizardState(state);
  if (!validation.valid) {
    throw new Error(validation.errors[0] || 'Invalid wizard state');
  }

  const payload = buildPendingIssuePayload(state);
  const api = await getApi();
  const response = await api.post('/pending-issues/', payload);
  return response.data;
}

/**
 * Fetch pending issues list for review (Production Admin).
 * Calls GET /api/admin/pending-issues/
 * @param {Object} params - { status, order_number, include_lines }
 */
export async function fetchPendingIssues(params = {}) {
  const api = await getApi();
  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') {
    query.set('status', params.status);
  }
  if (params.order_number) {
    query.set('order_number', String(params.order_number).trim());
  }
  if (params.include_lines) {
    query.set('include_lines', '1');
  }

  const qs = query.toString();
  const url = `/admin/pending-issues/${qs ? `?${qs}` : ''}`;
  const response = await api.get(url);
  const data = response.data?.data || response.data || {};
  return {
    issues: data.issues || [],
    count: data.count || 0,
  };
}

/**
 * Fetch complete detail of a single pending issue.
 * Calls GET /api/admin/pending-issues/<id>/
 * @param {number|string} id
 */
export async function fetchPendingIssue(id) {
  if (!id) throw new Error('Issue ID is required');
  const api = await getApi();
  const response = await api.get(`/admin/pending-issues/${id}/`);
  return response.data?.data || response.data || null;
}

/**
 * Reject a pending issue with an explicit reason.
 * Calls POST /api/admin/pending-issues/<id>/reject/
 * @param {number|string} id
 * @param {string} reason
 */
export async function rejectPendingIssue(id, reason) {
  if (!id) throw new Error('Issue ID is required');
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new Error('Rejection reason is required.');
  }

  const api = await getApi();
  const response = await api.post(`/admin/pending-issues/${id}/reject/`, {
    reason: cleanReason,
  });
  return response.data;
}

/**
 * Approve and post a pending issue to SAP InventoryGenExits.
 * Calls ONLY POST /api/admin/pending-issues/<id>/approve-post/.
 * Frontend NEVER calls SAP Service Layer directly.
 * @param {number|string} id
 */
export async function approvePostPendingIssue(id) {
  if (!id) throw new Error('Issue ID is required');
  const api = await getApi();
  const response = await api.post(`/admin/pending-issues/${id}/approve-post/`, {});
  return response.data;
}

/**
 * Reconcile a pending issue in ambiguous failure state with SAP.
 * Calls ONLY POST /api/admin/pending-issues/<id>/reconcile/.
 * Frontend NEVER calls SAP Service Layer directly.
 * @param {number|string} id
 * @param {Object} [payload={}] - Optional manual SAP identifiers { sap_doc_entry, sap_doc_num }
 */
export async function reconcilePendingIssue(id, payload = {}) {
  if (!id) throw new Error('Issue ID is required');
  const api = await getApi();
  const response = await api.post(`/admin/pending-issues/${id}/reconcile/`, payload);
  return response.data;
}

