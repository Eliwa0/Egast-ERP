import API from './api';

export async function getGRPOFromInspection(inspectionId) {
  const response = await API.get(`/quality/inspections/${inspectionId}/grpo-draft/`);
  return response.data?.data?.draft || null;
}

export async function openPurchaseGRPODraft(inspectionId) {
  try {
    const response = await API.post(`/quality/inspections/${inspectionId}/grpo-draft/`);
    return response.data?.data?.draft || null;
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      try {
        const existing = await getGRPOFromInspection(inspectionId);
        if (existing?.id) return existing;
      } catch (checkErr) {
        console.warn('Failed to verify inspection draft after timeout:', checkErr);
      }
    }
    throw err;
  }
}

export async function getGRPOFromScaleDraft(scaleDraftId) {
  const response = await API.get(`/grpo/scale-drafts/${scaleDraftId}/grpo-draft/`);
  return response.data?.data?.draft || response.data?.data || null;
}

export async function createOrGetGRPOFromScaleDraft(scaleDraftId) {
  try {
    const response = await API.post(`/grpo/scale-drafts/${scaleDraftId}/grpo-draft/`);
    return response.data?.data?.draft || response.data?.data || null;
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      try {
        const existing = await getGRPOFromScaleDraft(scaleDraftId);
        if (existing?.id) return existing;
      } catch (checkErr) {
        console.warn('Failed to verify scale draft after timeout:', checkErr);
      }
    }
    throw err;
  }
}

export async function loadPurchaseGRPODraft(draftId) {
  const response = await API.get(`/quality/grpo-drafts/${draftId}/`);
  return response.data?.data?.draft || null;
}

export async function savePurchaseGRPODraft(draftId, payload) {
  const response = await API.patch(`/quality/grpo-drafts/${draftId}/`, payload);
  return response.data?.data?.draft || null;
}

export async function loadWarehouses() {
  const response = await API.get('/warehouses/');
  return response.data?.data?.warehouses || response.data?.warehouses || [];
}

export async function loadBinLocations(warehouseCode) {
  const response = await API.get(`/bin-locations/${warehouseCode}/`);
  return response.data?.data?.locations || response.data?.locations || [];
}

export async function previewPurchaseGRPOPosting(draftId, verifySap = false) {
  const suffix = verifySap ? '?verify_sap=1' : '';
  const response = await API.post(`/quality/grpo-drafts/${draftId}/prepare-posting/${suffix}`);
  return response.data?.data || null;
}

export async function approvePurchaseGRPODraftForPosting(draftId) {
  const response = await API.post(`/quality/grpo-drafts/${draftId}/approve-for-posting/`);
  return response.data?.data?.draft || null;
}

export async function postPurchaseGRPODraftToSAP(draftId) {
  const response = await API.post(`/quality/grpo-drafts/${draftId}/post-to-sap/`);
  return response.data?.data || null;
}

export async function cancelPurchaseGRPODraft(draftId, reason = '') {
  const response = await API.post(`/quality/grpo-drafts/${draftId}/cancel/`, { reason });
  return response.data?.data?.draft || null;
}

export async function loadPendingGrpoShipments(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const response = await API.get(`/grpo/pending-shipments/${query}`);
  return response.data?.data?.shipments || [];
}

export async function loadCompletedGrpoReviews(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const response = await API.get(`/grpo/review/${query}`);
  return response.data?.data?.records || [];
}

export async function createManualReceivingRequest(payload) {
  const response = await API.post('/grpo/manual-receiving/', payload);
  return response.data?.data || null;
}

export async function loadQualityFarms() {
  const response = await API.get('/quality/farms/');
  return response.data?.farms || [];
}

export async function loadQualityContractors() {
  const response = await API.get('/quality/contractors/');
  return response.data?.contractors || [];
}

let memoryItemGroups = null;

export async function loadQualityItemGroups(attempt = 0) {
  if (memoryItemGroups && memoryItemGroups.length > 0) {
    return memoryItemGroups;
  }
  try {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem('quality_item_groups_receiving') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryItemGroups = parsed;
        API.get('/quality/item-groups/?workflow=receiving').then((res) => {
          const fresh = Array.isArray(res.data?.item_groups) ? res.data.item_groups : [];
          if (fresh.length > 0) {
            const mapped = fresh.map((g) => {
              const code = String(g.ItmsGrpCod ?? g.code ?? '').trim();
              const name = String(g.ItmsGrpNam ?? g.name ?? code).trim();
              return { ...g, code, name, ItmsGrpCod: g.ItmsGrpCod ?? code, ItmsGrpNam: g.ItmsGrpNam ?? name };
            });
            memoryItemGroups = mapped;
            sessionStorage.setItem('quality_item_groups_receiving', JSON.stringify(mapped));
          }
        }).catch(() => {});
        return parsed;
      }
    }
  } catch {
    // ignore storage parsing error
  }

  const response = await API.get('/quality/item-groups/?workflow=receiving');
  const groups = Array.isArray(response.data?.item_groups) ? response.data.item_groups : [];
  if (groups.length === 0 && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return loadQualityItemGroups(attempt + 1);
  }
  const mapped = groups.map((g) => {
    const code = String(g.ItmsGrpCod ?? g.code ?? '').trim();
    const name = String(g.ItmsGrpNam ?? g.name ?? code).trim();
    return {
      ...g,
      code,
      name,
      ItmsGrpCod: g.ItmsGrpCod ?? code,
      ItmsGrpNam: g.ItmsGrpNam ?? name,
    };
  });
  if (mapped.length > 0) {
    memoryItemGroups = mapped;
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('quality_item_groups_receiving', JSON.stringify(mapped));
      }
    } catch {
      // ignore storage quota error
    }
  }
  return mapped;
}

export async function loadQualityItemsByGroup(groupCode) {
  const cleanCode = String(groupCode || '').trim();
  if (!cleanCode || cleanCode === 'undefined' || cleanCode === 'null') return [];
  const response = await API.get(`/quality/items/?item_group_code=${encodeURIComponent(cleanCode)}`);
  const items = Array.isArray(response.data?.items) ? response.data.items : [];
  return items.map((item) => ({
    ...item,
    item_code: String(item.item_code || '').trim(),
    item_name: String(item.item_name || item.item_code || '').trim(),
    uom_code: String(item.uom_code || item.uom_name || 'KG').trim().toUpperCase() || 'KG',
    uom_name: String(item.uom_name || item.uom_code || 'KG').trim().toUpperCase() || 'KG',
  }));
}

export async function loadScalePendingDrafts() {
  try {
    const response = await API.get('/scale/quality/pending-drafts/');
    return Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (err) {
    console.error('Failed to load pending scale drafts:', err);
    return [];
  }
}

export async function checkBatchDetails(batchNumber) {
  if (!batchNumber) return null;
  try {
    const response = await API.get(`/quality/batches/${encodeURIComponent(batchNumber)}/`);
    return response.data?.batch || null;
  } catch {
    return null;
  }
}

export async function loadCostCenters(dimension = null) {
  if (dimension !== 1 && dimension !== 2 && dimension !== null) {
    throw new Error(`Unknown cost center dimension: ${dimension}`);
  }
  const query = dimension ? `?dimension=${encodeURIComponent(dimension)}` : '';
  // Dimension 1 is materially larger in SAP and can legitimately approach the
  // shared 30-second Axios limit on a cold cache. Keep Dimension 2 unchanged.
  const requestConfig = dimension === 1 ? { timeout: 60000 } : undefined;
  const response = await API.get(`/quality/cost-centers/${query}`, requestConfig);
  return Array.isArray(response.data?.cost_centers) ? response.data.cost_centers : [];
}

export async function loadTaxCodes(category = 'purchase') {
  try {
    const query = category === 'sales' ? '?category=sales' : '';
    const response = await API.get(`/tax-codes/${query}`);
    const rawList = response.data?.data?.tax_codes || response.data?.tax_codes || [];
    return rawList.map((tc) => {
      const code = String(tc.TaxCode || tc.code || '').trim();
      const rate = tc.VatPercent ?? tc.rate ?? 0;
      const name = String(tc.TaxName || tc.name || '').trim();
      const label = name && name !== code ? `${code} (${rate}%) - ${name}` : `${code} (${rate}%)`;
      return {
        value: code,
        label,
        code,
        name,
        rate,
        TaxCode: code,
        TaxName: name,
        VatPercent: rate,
      };
    });
  } catch (err) {
    console.error('Failed to load SAP tax codes:', err);
    return [];
  }
}
