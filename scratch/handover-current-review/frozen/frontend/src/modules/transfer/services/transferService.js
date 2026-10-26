import API from '../../../services/api';



const FORCE_MOCK_MODE =

  String(import.meta.env.VITE_TRANSFER_USE_MOCK || '').toLowerCase() === 'true';



const MOCK_WAREHOUSES = [

  { code: 'WH-RAW', name: 'Raw Materials Warehouse' },

  { code: 'WH-PROD', name: 'Production Warehouse' },

  { code: 'WH-FG', name: 'Finished Goods Warehouse' },

  { code: 'WH-QA', name: 'Quality Hold Warehouse' },

];



const MOCK_BINS_BY_WAREHOUSE = {

  'WH-RAW': ['RAW-A-01', 'RAW-A-02', 'RAW-B-04'],

  'WH-PROD': ['PROD-LINE-01', 'PROD-LINE-02', 'PROD-STAGING'],

  'WH-FG': ['FG-A-11', 'FG-B-08', 'FG-DISPATCH'],

  'WH-QA': ['QA-HOLD-01', 'QA-HOLD-02', 'QA-RELEASE'],

};



const MOCK_BATCHES = [

  {

    item_code: 'FG-112000028',

    item_name: 'Finished Goods Batch 112000028',

    batch_number: '112000028-32',

    batch_abs_entry: 1001,

    available_quantity: 32,

    uom: 'CTN',

    expiry_date: '2027-02-28',

    from_warehouse: 'WH-PROD',

    from_bin: 'PROD-LINE-02',

    mock: true,

  },

  {

    item_code: 'FG-1407',

    item_name: 'Juice Multipack 12 x 250ml',

    batch_number: '24051407-08',

    batch_abs_entry: 1002,

    available_quantity: 315,

    uom: 'CASE',

    expiry_date: '2026-11-30',

    from_warehouse: 'WH-FG',

    from_bin: 'FG-B-08',

    mock: true,

  },

  {

    item_code: 'RM-2204',

    item_name: 'Packaging Film Roll',

    batch_number: '24052204-11',

    batch_abs_entry: 1003,

    available_quantity: 42,

    uom: 'ROLL',

    expiry_date: null,

    from_warehouse: 'WH-RAW',

    from_bin: 'RAW-A-02',

    mock: true,

  },

];



const waitForMock = (result, delay = 180) =>

  new Promise((resolve) => {

    window.setTimeout(() => resolve(result), delay);

  });



const normalizeBatchNumber = (bn) => bn.trim().replace(/\s+/g, '').toUpperCase();



const generateMockBatch = (batchNumber, fromWarehouse, fromBin) => {

  const normalized = normalizeBatchNumber(batchNumber);

  if (!/^\d{6,}-\d+$/.test(normalized)) return null;

  const numericSeed = Number(normalized.replace(/\D/g, '').slice(-5)) || 1;

  return {

    item_code: `FG-${normalized.split('-')[0]}`,

    item_name: `Mock SAP inventory item ${normalized}`,

    batch_number: normalized,

    batch_abs_entry: null,

    available_quantity: (numericSeed % 90) + 10,

    uom: 'CTN',

    expiry_date: '2027-12-31',

    from_warehouse: fromWarehouse || 'WH-PROD',

    from_bin: fromBin || 'PROD-STAGING',

    mock: true,

  };

};



// Convert snake_case API response to camelCase flat batch object

const toCamelBatch = (batch) => {

  if (!batch) return null;

  return {

    itemCode: batch.item_code ?? batch.itemCode ?? '',

    itemName: batch.item_name ?? batch.itemName ?? '',

    batchNumber: batch.batch_number ?? batch.batchNumber ?? '',
    productionPalletTypeName: batch.production_pallet_type_name || '',
    withoutPallet: batch.without_pallet === true,

    batchAbsEntry: batch.batch_abs_entry ?? batch.batchAbsEntry ?? null,

    availableQuantity: Number(batch.available_quantity ?? batch.availableQuantity ?? 0),

    uom: batch.uom ?? '',

    expiryDate: batch.expiry_date ?? batch.expiryDate ?? null,

    fromWarehouse: batch.from_warehouse ?? batch.fromWarehouse ?? '',

    fromBin: batch.from_bin ?? batch.fromBin ?? '',

    sourceType: batch.source_type ?? batch.sourceType ?? '',

    availabilityStatus: batch.availability_status ?? batch.availabilityStatus ?? '',

    sourceStatusLabel: batch.source_status_label ?? batch.sourceStatusLabel ?? '',

    sourceMessage: batch.source_message ?? batch.sourceMessage ?? '',

    canPostToSap: Boolean(batch.can_post_to_sap ?? batch.canPostToSap ?? true),

    receiptStatus: batch.receipt_status ?? batch.receiptStatus ?? '',

    pendingReceiptId: batch.pending_receipt_id ?? batch.pendingReceiptId ?? null,

    pendingReceiptBatchId: batch.pending_receipt_batch_id ?? batch.pendingReceiptBatchId ?? null,

    sourceTransferId: batch.source_transfer_id ?? batch.sourceTransferId ?? null,

    sourceTransferStatus: batch.source_transfer_status ?? batch.sourceTransferStatus ?? '',

    mock: Boolean(batch.mock),

  };

};



async function withApiFallback(apiCall, fallbackCall, options = {}) {

  if (FORCE_MOCK_MODE) return fallbackCall();

  try {

    return await apiCall();

  } catch (error) {

    const httpStatus = error?.response?.status;

    if (httpStatus && httpStatus < 500 && httpStatus !== 501) {

      if (options.onClientError) return options.onClientError(error);

      throw error;

    }

    console.warn('Transfer API unavailable, using mock fallback:', error?.message || error);

    return fallbackCall();

  }

}



export async function fetchDestinationWarehouses() {
  if (FORCE_MOCK_MODE) return waitForMock(MOCK_WAREHOUSES);
  const response = await API.get('/transfer/warehouses/');
  return response.data?.warehouses || response.data?.data?.warehouses || [];
}

export async function fetchDestinationBins(warehouseCode) {
  if (FORCE_MOCK_MODE) return waitForMock(MOCK_BINS_BY_WAREHOUSE[warehouseCode] || []);
  const response = await API.get(`/bin-locations/${encodeURIComponent(warehouseCode)}/`);
  const result = response.data?.data ?? response.data;
  if (result?.warehouse_code !== warehouseCode) throw new Error('Warehouse/bin response mismatch');
  return (result.locations || []).filter((loc) => !loc.inactive && !loc.is_system_bin)
    .map((loc) => loc.bin_code || loc.BinCode || loc.code).filter(Boolean);
}

export async function fetchDestinationSapBins(warehouseCode) {
  const response = await API.get(`/bin-locations/${encodeURIComponent(warehouseCode)}/`, {
    params: { transfer_destination: 'true' },
  });
  const data = response.data?.data ?? response.data;
  if (data?.warehouse_code !== warehouseCode || typeof data.requires_bin !== 'boolean' || !Array.isArray(data.locations)) {
    throw new Error('Invalid destination SAP bin metadata');
  }
  return data;
}

export async function fetchPhysicalBatch(batch) {
  const response = await API.get(`/transfer/physical/batches/${encodeURIComponent(batch)}/`);
  return response.data.data;
}

export async function confirmPhysicalTransfer(stage, batch, container, sourceWarehouse) {
  const payload = {
    batch_number: batch,
    ...(stage === 5 ? { container_number: container } : {}),
    ...(sourceWarehouse ? { source_warehouse: sourceWarehouse } : {}),
  };
  const response = await API.post(`/transfer/physical/${stage === 4 ? 'arrival' : 'load'}/`, payload);
  return response.data.data;
}

export async function fetchPhysicalEvents(offset = 0) {
  const response = await API.get('/transfer/physical/events/', { params: { offset } });
  return response.data.data;
}

export async function fetchColdStorageLayout(warehouseCode, refresh = false) {
  return withApiFallback(
    async () => {
      const response = await API.get(
        `/cold-storage/${encodeURIComponent(warehouseCode)}/layout/`,
        {
          params: refresh ? { refresh: 'true' } : {},
        },
      );
      return response.data?.data || response.data || null;
    },
    () => null,
  );
}

export async function fetchBinPositions(absEntry) {
  return withApiFallback(
    async () => {
      const response = await API.get(
        `/cold-storage/bin/${absEntry}/positions/`,
      );
      return response.data?.data || response.data || null;
    },
    () => null,
  );
}

export async function reservePalletPosition(positionId, reference = '') {
  const response = await API.post(
    `/cold-storage/positions/${positionId}/reserve/`,
    { reference },
  );
  return response.data?.data || response.data || null;
}

export async function releasePalletPosition(positionId) {
  const response = await API.post(
    `/cold-storage/positions/${positionId}/release/`,
  );
  return response.data?.data || response.data || null;
}

export async function previewSequentialAllocation(payload) {
  const response = await API.post('/cold-storage/allocate-preview/', payload);
  return response.data?.data || response.data || null;
}

export async function allocateSequentially(payload) {
  const response = await API.post('/cold-storage/allocate-sequential/', payload);
  return response.data?.data || response.data || null;
}


export async function fetchColdStorageHierarchy(warehouseCode, refresh = false) {

  return withApiFallback(

    async () => {

      const response = await API.get(

        `/cold-storage/${encodeURIComponent(warehouseCode)}/hierarchy/`,

        {

          params: refresh ? { refresh: 'true' } : {},

        },

      );

      return response.data?.data || response.data || null;

    },

    () => {

      // Mock hierarchy for local test/mock mode if needed

      return null;

    },

  );

}



export async function fetchBatchDetails(batchNumber, fromWarehouse, fromBin, transferStage) {

  return withApiFallback(

    async () => {

      const response = await API.get(

        `/transfer/batches/${encodeURIComponent(batchNumber)}/`,

        {

          params: {

            from_warehouse: fromWarehouse,

            from_bin: fromBin,

            transfer_stage: transferStage,

          },

        },

      );

      return toCamelBatch(response.data?.batch || response.data?.data?.batch);

    },

    async () => {

      const normalized = normalizeBatchNumber(batchNumber);

      const found = MOCK_BATCHES.find(

        (b) => normalizeBatchNumber(b.batch_number) === normalized,

      );

      const batch = found || generateMockBatch(batchNumber, fromWarehouse, fromBin);

      if (!batch) return null;

      if (fromWarehouse && batch.from_warehouse !== fromWarehouse) return null;

      if (fromBin && batch.from_bin !== fromBin) return null;

      return toCamelBatch(batch);

    },

    {

      onClientError: (error) => {

        if (error?.response?.status === 404) return null;

        throw error;

      },

    },

  );

}



export async function fetchTransferWarehouseAccess() {

  const response = await API.get('/transfer/warehouse-access/me/');

  return response.data?.data?.access || response.data?.access || {

    allow_all: false,

    has_rules: false,

    allowed_from: [],

    allowed_to: [],

    rules: [],

    message: 'No Transfer warehouse route is configured. Contact admin.',

  };

}



/**

 * Submit a multi-line inventory transfer.

 *

 * payload shape:

 * {

 *   transfer_stage, from_warehouse, from_bin, to_warehouse, to_bin,

 *   lines: [{ item_code, batch_number, quantity }, ...]

 * }

 *

 * No mock fallback; SAP errors (e.g. exchange-rate issues) must reach the user.

 * If the API is unavailable the axios error propagates and the UI shows it.

 */

export async function submitInventoryTransfer(payload) {

  if (FORCE_MOCK_MODE) {

    const numericSeed = Date.now() % 10000;

    return waitForMock(

      { docEntry: 120000 + numericSeed, docNum: 450000 + numericSeed, mock: true },

      320,

    );

  }

  const response = await API.post('/transfer/move/', payload);

  if (response.data?.pending) {

    return {

      pending: true,

      pendingTransferId: response.data?.pending_transfer_id,

      status: response.data?.status,

      message: response.data?.message || 'Transfer submitted for admin review.',

      mock: false,

    };

  }

  return {

    docEntry: response.data?.sap_doc_entry,

    docNum: response.data?.sap_doc_num,

    pending: false,

    mock: false,

  };

}






export async function fetchIntermediateWarehouses() {

  const response = await API.get('/transfer/intermediate-warehouses/');

  return Array.isArray(response.data) ? response.data : [];

}

