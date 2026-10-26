import API from './api';
import { loadCostCenters } from './purchaseGrpoService';

export async function loadPurchaseQuotationDrafts(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const response = await API.get(`/purchase-quotations/drafts/${query}`);
  return response.data?.data?.drafts || [];
}

export async function createPurchaseQuotationDraft(payload = {}) {
  const response = await API.post('/purchase-quotations/create/', payload);
  return response.data?.data?.draft || null;
}

export async function loadPurchaseQuotationDraft(draftId) {
  const response = await API.get(`/purchase-quotations/${draftId}/`);
  return response.data?.data?.draft || null;
}

export async function savePurchaseQuotationDraft(draftId, payload) {
  const response = await API.patch(`/purchase-quotations/${draftId}/`, payload);
  return response.data?.data?.draft || null;
}

export async function approvePurchaseQuotationDraftForPosting(draftId) {
  const response = await API.post(`/purchase-quotations/${draftId}/approve/`);
  return response.data?.data?.draft || null;
}

export async function previewPurchaseQuotationPosting(draftId, verifySap = false) {
  const suffix = verifySap ? '?verify_sap=1' : '';
  const response = await API.post(`/purchase-quotations/${draftId}/prepare-posting/${suffix}`);
  return response.data?.data || null;
}

export async function postPurchaseQuotationToSAP(draftId) {
  const response = await API.post(`/purchase-quotations/${draftId}/post-to-sap/`);
  return response.data?.data || null;
}

export async function cancelPurchaseQuotationDraft(draftId, reason = '') {
  const response = await API.post(`/purchase-quotations/${draftId}/cancel/`, { reason });
  return response.data?.data?.draft || null;
}

export async function loadCompletedPurchaseQuotations(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const response = await API.get(`/purchase-quotations/review/${query}`);
  return response.data?.data?.records || [];
}

export async function loadLocations() {
  return loadCostCenters(1);
}

export async function loadCurrencies() {
  try {
    const response = await API.get('/purchase-quotations/currencies/');
    return response.data?.currencies || response.data?.data?.currencies || [];
  } catch (err) {
    console.error('Failed to load SAP currencies:', err);
    return [];
  }
}

export {
  loadWarehouses,
  loadCostCenters,
  loadQualityFarms,
  loadQualityItemGroups,
  loadQualityItemsByGroup,
} from './purchaseGrpoService';
