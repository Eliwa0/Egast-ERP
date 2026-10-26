import API from './api';
import { deduplicatePendingRead } from './searchCache';

const BASE = 'customization-delivery/';
const readWorkflowPage = (path, params = {}) => {
  const stored = typeof window === 'undefined' ? '' : window.localStorage.getItem('auth_user') || '';
  let scope = stored;
  try { const actor = JSON.parse(stored); scope = JSON.stringify([API.defaults.baseURL, actor.id, actor.username]); } catch { /* Auth owns malformed session handling. */ }
  const key = JSON.stringify([scope, path, Object.keys(params).sort().map(name => [name, params[name]])]);
  return deduplicatePendingRead(key, () => API.get(path, { params }));
};
export async function fetchPostedDeliveryDocument(docEntry) {
  const { data } = await API.get(`${BASE}delivery/posted-documents/${docEntry}/`);
  return data.document;
}
export async function fetchQuotationPosting(requestKey) {
  const { data } = await API.get(`${BASE}quotations/posting/${encodeURIComponent(requestKey)}/`);
  return data;
}

// ── SAP READ-ONLY DOCUMENTS ─────────────────────────────────────────

export async function fetchCustomizationDocuments(params = {}) {
  const { data } = await API.get(`${BASE}documents/`, { params });
  return data;
}

export async function fetchCustomizationDocument(docEntry) {
  const { data } = await API.get(`${BASE}documents/${docEntry}/`);
  return data.document;
}

export async function fetchDeliveryDocuments(params = {}) {
  const { data } = await API.get(`${BASE}delivery-documents/`, { params });
  return data;
}

export async function fetchDeliveryDocument(docEntry) {
  const { data } = await API.get(`${BASE}delivery-documents/${docEntry}/`);
  return data.document;
}

export async function fetchWorkflowSalesOrders(params = {}) {
  const { data } = await readWorkflowPage(`${BASE}orders/`, params);
  return data;
}

export async function fetchSalesOrderDocument(docEntry) {
  const { data } = await API.get(`${BASE}orders/documents/${docEntry}/`);
  return data.document;
}

// ── CUSTOMIZATION DRAFTS & WORKFLOW ──────────────────────────────────

export async function fetchCustomizationDrafts(params = {}) {
  const { data } = await readWorkflowPage(`${BASE}customization/drafts/`, params);
  return Object.assign(data?.drafts || [], { pagination: data?.pagination, workflowCounts: data?.workflow_counts });
}

export async function fetchCustomizationDraft(draftId) {
  const { data } = await API.get(`${BASE}customization/drafts/${draftId}/`);
  return data?.draft || null;
}

export async function createCustomizationDraft(payload) {
  const { data } = await API.post(`${BASE}customization/drafts/`, payload);
  return data?.draft || null;
}

export async function updateCustomizationDraft(draftId, payload) {
  const { data } = await API.put(`${BASE}customization/drafts/${draftId}/`, payload);
  return data?.draft || null;
}

export async function submitCustomizationDraft(draftId) {
  const { data } = await API.post(`${BASE}customization/drafts/${draftId}/submit/`);
  return data?.draft || null;
}

export async function approveCustomizationDraft(draftId, notes = '') {
  const { data } = await API.post(`${BASE}customization/drafts/${draftId}/approve/`, { notes });
  return data?.draft || null;
}

export async function rejectCustomizationDraft(draftId, reason) {
  const { data } = await API.post(`${BASE}customization/drafts/${draftId}/reject/`, { reason });
  return data?.draft || null;
}

export async function patchQuotationToSap(draftId) {
  const { data } = await API.post(`${BASE}customization/drafts/${draftId}/patch-quotation/`);
  return data?.draft || null;
}

export async function recordCustomerApproval(draftId, payload) {
  const { data } = await API.post(`${BASE}customization/drafts/${draftId}/customer-approval/`, payload);
  return data?.draft || null;
}

export async function createSalesOrder(draftId, payload = {}) {
  const { data } = await API.post(`${BASE}customization/drafts/${draftId}/create-order/`, payload);
  return data?.draft || null;
}

// ── DELIVERY DRAFTS & WORKFLOW ───────────────────────────────────────

export async function fetchDeliveryDrafts(params = {}) {
  const { data } = await readWorkflowPage(`${BASE}delivery/drafts/`, params);
  return Object.assign(data?.drafts || [], { pagination: data?.pagination });
}

export async function fetchDeliveryDraft(draftId) {
  const { data } = await API.get(`${BASE}delivery/drafts/${draftId}/`);
  return data?.draft || null;
}

export async function createDeliveryDraft(payload) {
  const { data } = await API.post(`${BASE}delivery/drafts/`, payload);
  return data?.draft || null;
}

export async function updateDeliveryDraft(draftId, payload) {
  const { data } = await API.put(`${BASE}delivery/drafts/${draftId}/`, payload);
  return data?.draft || null;
}

export async function submitDeliveryDraft(draftId) {
  const { data } = await API.post(`${BASE}delivery/drafts/${draftId}/submit/`);
  return data?.draft || null;
}

export async function approveDeliveryDraft(draftId) {
  const { data } = await API.post(`${BASE}delivery/drafts/${draftId}/approve/`);
  return data?.draft || null;
}

export async function rejectDeliveryDraft(draftId, reason) {
  const { data } = await API.post(`${BASE}delivery/drafts/${draftId}/reject/`, { reason });
  return data?.draft || null;
}

export async function postDeliveryToSap(draftId) {
  const { data } = await API.post(`${BASE}delivery/drafts/${draftId}/post/`);
  return data?.draft || null;
}

export async function reconcileDeliveryDraft(draftId) {
  const { data } = await API.post(`${BASE}delivery/drafts/${draftId}/reconcile/`);
  return data?.draft || null;
}

// ── 3-LAYER WORKFLOW METHODS ────────────────────────────────────────

// Query-scoped in-memory caches
const _customerCache = new Map();
const _itemCache = new Map();
const MASTER_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export async function createSalesQuotation(payload) {
  const { data } = await API.post(`${BASE}quotations/create/`, payload);
  return data;
}

export async function fetchSalesCustomers(params = {}) {
  const searchKey = (params.search || '').trim().toLowerCase();
  const page = params.page || 1;
  const pageSize = params.page_size || 5000;
  const requestParams = { page_size: pageSize, ...params };
  const cacheKey = `c_${searchKey}_${page}_${pageSize}`;
  const now = Date.now();
  const cached = _customerCache.get(cacheKey);
  if (cached && now < cached.expiry) {
    return cached.data;
  }
  const { data } = await API.get(`${BASE}customers/`, { params: requestParams });
  if (data?.success !== true || !Array.isArray(data?.customers)) {
    throw new Error(data?.error || 'Unable to load customers from SAP.');
  }
  const list = data.customers;
  if (list.length > 0) {
    _customerCache.set(cacheKey, { data: list, expiry: now + MASTER_CACHE_TTL });
  } else {
    _customerCache.delete(cacheKey);
  }
  return list;
}

export async function fetchSalesItems(params = {}) {
  const searchKey = (params.search || '').trim().toLowerCase();
  const priceList = params.price_list || '';
  const page = params.page || 1;
  const cacheKey = `i_${searchKey}_${priceList}_${page}`;
  const now = Date.now();
  const cached = _itemCache.get(cacheKey);
  if (cached && now < cached.expiry) {
    return cached.data;
  }
  const { data } = await API.get(`${BASE}items/`, { params });
  const list = data?.items || [];
  _itemCache.set(cacheKey, { data: list, expiry: now + MASTER_CACHE_TTL });
  return list;
}

export async function fetchSalesQuotationMetadata() {
  const { data } = await API.get(`${BASE}quotation-metadata/`);
  return data;
}

export async function fetchSalesQuotationContext(params) {
  const { data } = await API.get(`${BASE}quotation-context/`, { params });
  return data;
}

export function clearSalesMasterDataCache() {
  _customerCache.clear();
  _itemCache.clear();
}

export async function fetchEligibleDeliveryOrders(params = {}) {
  const { data } = await readWorkflowPage(`${BASE}delivery/eligible-orders/`, params);
  return data;
}

export async function fetchDeliveryReviewReport(params = {}) {
  const { data } = await API.get(`${BASE}delivery/report/`, { params });
  return data.report;
}

export async function fetchDeliveryReportPrint(params = {}) {
  const { data } = await API.get(`${BASE}delivery/report/`, { params: { ...params, output: 'print' }, responseType: 'text' });
  return data;
}

const _cachedBatches = new Map();
const BATCH_CACHE_TTL = 30 * 1000; // 30 seconds

export async function fetchAvailableBatches({ item_code, warehouse_code } = {}) {
  if (!item_code) return [];
  const cacheKey = `${item_code}__${warehouse_code || ''}`;
  const cached = _cachedBatches.get(cacheKey);
  const now = Date.now();
  if (cached && now < cached.expiry) {
    return cached.data;
  }
  const params = { item_code };
  if (warehouse_code) params.warehouse_code = warehouse_code;
  const { data } = await API.get(`${BASE}batches/`, { params });
  const batches = data?.batches || [];
  _cachedBatches.set(cacheKey, { data: batches, expiry: now + BATCH_CACHE_TTL });
  return batches;
}

