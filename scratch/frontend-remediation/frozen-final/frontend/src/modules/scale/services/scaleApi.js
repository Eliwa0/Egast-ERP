import API from '../../../services/api';

/**
 * Service methods for the Scale & Weighbridge module.
 * Wraps /api/scale/... endpoints.
 */
export const scaleApi = {
  // ── Live Weight & Ingestion
  getLiveWeight: async (deviceId) => {
    const params = deviceId ? { device_id: deviceId } : {};
    const res = await API.get('/scale/live-weight/', { params });
    return res.data;
  },

  receiveWeight: async (data) => {
    const res = await API.post('/scale/receive-weight/', data);
    return res.data;
  },

  // ── Devices
  getDevices: async () => {
    const res = await API.get('/scale/devices/');
    return res.data;
  },

  getDevice: async (deviceId) => {
    const res = await API.get(`/scale/devices/${deviceId}/`);
    return res.data;
  },

  createDevice: async (data) => {
    const res = await API.post('/scale/devices/', data);
    return res.data;
  },

  updateDevice: async (deviceId, data) => {
    const res = await API.put(`/scale/devices/${deviceId}/`, data);
    return res.data;
  },

  deleteDevice: async (deviceId) => {
    const res = await API.delete(`/scale/devices/${deviceId}/`);
    return res.data;
  },

  deployScaleAgent: async (scaleId = null) => {
    const rootBaseURL = (API.defaults.baseURL || '').replace(/\/api\/?$/, '');
    const res = await API.get('/scale-management/deploy/', {
      baseURL: rootBaseURL || undefined,
      params: scaleId ? { scale_id: scaleId } : {},
      responseType: 'blob',
    });
    return res;
  },

  // ── Vehicles & Movements
  getVehicles: async (params) => {
    const res = await API.get('/scale/vehicles/', { params });
    return res.data;
  },

  createVehicle: async (data) => {
    const res = await API.post('/scale/vehicles/', data);
    return res.data;
  },

  recordVehicleEntry: async (data) => {
    const res = await API.post('/scale/vehicles/entry/', data);
    return res.data;
  },

  recordVehicleExit: async (data) => {
    const res = await API.post('/scale/vehicles/exit/', data);
    return res.data;
  },

  // ── Item Elements (Tare)
  getItemElements: async (itemCode) => {
    const params = itemCode ? { item_code: itemCode } : {};
    const res = await API.get('/scale/item-elements/', { params });
    return res.data;
  },

  createItemElement: async (data) => {
    const res = await API.post('/scale/item-elements/', data);
    return res.data;
  },

  updateItemElement: async (elementId, data) => {
    const res = await API.put(`/scale/item-elements/${elementId}/`, data);
    return res.data;
  },

  // ── Receipts (إيصال الاستلام)
  getReceipts: async (params) => {
    const res = await API.get('/scale/receipts/', { params });
    return res.data;
  },

  getReceipt: async (receiptId) => {
    const res = await API.get(`/scale/receipts/${receiptId}/`);
    return res.data;
  },

  createReceipt: async (data) => {
    const res = await API.post('/scale/receipts/', data);
    return res.data;
  },

  updateReceipt: async (receiptId, data) => {
    const res = await API.put(`/scale/receipts/${receiptId}/`, data);
    return res.data;
  },

  deleteReceipt: async (receiptId) => {
    const res = await API.delete(`/scale/receipts/${receiptId}/`);
    return res.data;
  },

  // ── Entry & Exit Permits (تصاريح الدخول والخروج — EG.ST.F05/F06)
  getEntryExitPermits: async (params) => {
    const res = await API.get('/scale/entry-exit-permits/', { params });
    return res.data;
  },

  getEntryExitPermit: async (permitId) => {
    const res = await API.get(`/scale/entry-exit-permits/${permitId}/`);
    return res.data;
  },

  createEntryExitPermit: async (data) => {
    const res = await API.post('/scale/entry-exit-permits/', data);
    return res.data;
  },

  updateEntryExitPermit: async (permitId, data) => {
    const res = await API.put(`/scale/entry-exit-permits/${permitId}/`, data);
    return res.data;
  },

  deleteEntryExitPermit: async (permitId) => {
    const res = await API.delete(`/scale/entry-exit-permits/${permitId}/`);
    return res.data;
  },

  // ── Drafts Workflow
  getReceivingFarms: async () => {
    const res = await API.get('/scale/master-data/farms/');
    return res.data;
  },

  getReceivingItemGroups: async () => {
    const res = await API.get('/scale/master-data/item-groups/');
    return res.data;
  },

  getReceivingItems: async (itemGroupCode, params = {}) => {
    const requestParams = { ...params };
    if (itemGroupCode) {
      requestParams.item_group_code = itemGroupCode;
    }
    const res = await API.get('/scale/master-data/items/', {
      params: requestParams,
    });
    return res.data;
  },

  getAvailableQuotations: async (params = {}) => {
    const res = await API.get('/scale/available-quotations/', { params });
    return res.data;
  },

  getDrafts: async (params) => {
    const res = await API.get('/scale/drafts/', { params });
    return res.data;
  },

  getDraft: async (draftId) => {
    const res = await API.get(`/scale/drafts/${draftId}/`);
    return res.data;
  },

  recordFirstWeight: async (data) => {
    const res = await API.post('/scale/drafts/first-weight/', data);
    return res.data;
  },

  recordSecondWeight: async (draftId, data) => {
    const res = await API.post(`/scale/drafts/${draftId}/second-weight/`, data);
    return res.data;
  },

  updateDraftElements: async (draftId, data) => {
    const res = await API.post(`/scale/drafts/${draftId}/elements/`, data);
    return res.data;
  },

  updateDraftBatches: async (draftId, data) => {
    const res = await API.post(`/scale/drafts/${draftId}/batches/`, data);
    return res.data;
  },

  updateDraftAllocations: async (draftId, data) => {
    const res = await API.post(`/scale/drafts/${draftId}/allocations/`, data);
    return res.data;
  },

  sendToQuality: async (draftId) => {
    const res = await API.post(`/scale/drafts/${draftId}/send-to-quality/`);
    return res.data;
  },

  cancelDraft: async (draftId) => {
    const res = await API.post(`/scale/drafts/${draftId}/cancel/`);
    return res.data;
  },

  // ── Simulator (Dev & Testing)
  setSimulatorWeight: async (data) => {
    const res = await API.post('/scale/simulator/set/', data);
    return res.data;
  },

  getSimulatorStatus: async () => {
    const res = await API.get('/scale/simulator/status/');
    return res.data;
  },
};

/**
 * Local Scale Agent API helper methods.
 * Communicates directly with the local ScaleAgent daemon (http://127.0.0.1:8998).
 * Uses fetch() without credentials to comply with CORS (* origin).
 */
export const localAgentApi = {
  baseUrl: 'http://127.0.0.1:8998',

  checkHealth: async (timeoutMs = 2500) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${localAgentApi.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Agent health check returned HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  },

  getStatus: async (timeoutMs = 3000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${localAgentApi.baseUrl}/status`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Agent status returned HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  },

  getAvailablePorts: async (timeoutMs = 3000) => {
    try {
      const status = await localAgentApi.getStatus(timeoutMs);
      return status?.available_ports || [];
    } catch {
      return [];
    }
  },

  getLiveWeight: async (scaleId, timeoutMs = 2500) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const url = scaleId
      ? `${localAgentApi.baseUrl}/weight?scale_id=${encodeURIComponent(scaleId)}`
      : `${localAgentApi.baseUrl}/weight`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  },

  reloadConfig: async (timeoutMs = 5000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${localAgentApi.baseUrl}/reload-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  },

  syncScales: async (scales = [], timeoutMs = 5000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${localAgentApi.baseUrl}/sync-scales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scales }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

scaleApi.agent = localAgentApi;

export default scaleApi;

