import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import { useAuth } from '../../../contexts/AuthContext';
import { canManageTransfer } from '../../../utils/roles';
import {
  fetchBatchDetails,
  fetchDestinationBins,
  fetchDestinationWarehouses,
  fetchIntermediateWarehouses,
  fetchTransferWarehouseAccess,
  submitInventoryTransfer,
} from '../services/transferService';
import { TransferStage, TransferStatus } from '../types/transferTypes';
import useDestinationSapBins from './useDestinationSapBins';

export function useTransferWorkflow() {
  const { t } = useI18n();
  const { user } = useAuth();
  const adminUser = canManageTransfer(user);
  // ── Remote data ──────────────────────────────────────────────────────────────
  const [warehouses, setWarehouses] = useState([]);
  const [intermediateWarehouses, setIntermediateWarehouses] = useState([]);
  const [transferAccess, setTransferAccess] = useState(null);
  const [transferAccessLoading, setTransferAccessLoading] = useState(true);
  const [fromBins, setFromBins] = useState([]);
  const [policyToBins, setToBins] = useState([]);

  // ── Stage ────────────────────────────────────────────────────────────────────
  const [stage, setStageState] = useState(null);

  // ── Source / destination ─────────────────────────────────────────────────────
  const [fromWarehouse, setFromWarehouseState] = useState('');
  const [fromBin, setFromBinState] = useState('');
  const [sourcePalletPositionId, setSourcePalletPositionIdState] = useState(null);
  const [sourcePalletPositionCode, setSourcePalletPositionCodeState] = useState('');
  const [toDestType, setToDestTypeState] = useState(null); // 'intermediate' | 'fridge' | null (Stage 2 only)
  const [toWarehouse, setToWarehouseState] = useState('');
  const [toBin, setToBinState] = useState('');
  const [palletPositionId, setPalletPositionIdState] = useState(null);
  const [palletPositionCode, setPalletPositionCodeState] = useState('');

  // ── Batch scanning ───────────────────────────────────────────────────────────
  const [batchLines, setBatchLines] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [scanStatus, setScanStatus] = useState(TransferStatus.IDLE);
  const [scanError, setScanError] = useState('');

  // ── Submission ───────────────────────────────────────────────────────────────
  const [transferStatus, setTransferStatus] = useState(TransferStatus.IDLE);
  const [transferResult, setTransferResult] = useState(null);
  const [submitError, setSubmitError] = useState('');

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchDestinationWarehouses()
      .then(setWarehouses)
      .catch(() => setWarehouses([]));
    fetchIntermediateWarehouses()
      .then(setIntermediateWarehouses)
      .catch((err) => {
        console.error('[Transfer] intermediate warehouses fetch failed:', err);
        setIntermediateWarehouses([]);
      });
    fetchTransferWarehouseAccess()
      .then(setTransferAccess)
      .catch(() => setTransferAccess({
        allow_all: false,
        has_rules: false,
        allowed_from: [],
        allowed_to: [],
        rules: [],
        message: '',
      }))
      .finally(() => setTransferAccessLoading(false));
  }, []);

  const fromBinRequired = stage === TransferStage.STAGE_3_FROM_FRIDGE;
  const sourcePalletPositionRequired = fromBinRequired;
  const destinationTypeRequired = stage === TransferStage.STAGE_2_TO_FRIDGE;
  const policyToBinRequired = destinationTypeRequired && toDestType === 'fridge';
  const destinationPalletPositionRequired = policyToBinRequired && Boolean(toBin);
  const shouldFetchDestinationBins = policyToBinRequired;
  const dynamicDestination = stage === TransferStage.STAGE_3_FROM_FRIDGE || stage === TransferStage.STAGE_4_TO_DESTINATION;
  const destinationSap = useDestinationSapBins(toWarehouse, dynamicDestination);
  const toBinRequired = dynamicDestination ? destinationSap.required : policyToBinRequired;
  const toBins = dynamicDestination ? destinationSap.bins.map(bin => bin.code) : policyToBins;
  const destinationBinError = dynamicDestination && (destinationSap.error
    ? t('transfer.destinationSapLoadFailed')
    : destinationSap.required && !destinationSap.bins.length ? t('transfer.destinationSapBinsUnavailable') : '');

  const isWarehouseAllowed = useCallback((warehouse, direction, activeStage) => {
    if (adminUser) return true;
    if (!warehouse?.code) return false;
    if (!transferAccess) return false;
    if (transferAccess.allow_all) return true;
    const rules = Array.isArray(transferAccess.rules) ? transferAccess.rules : [];
    return rules.some((rule) => {
      if (!rule?.is_active) return false;
      if (rule.warehouse_code !== warehouse.code) return false;
      if (rule.direction !== direction && rule.direction !== 'BOTH') return false;
      if (!activeStage) return true;
      return rule.stage === activeStage || (rule.stage === 'BOTH' && activeStage !== TransferStage.STAGE_3_FROM_FRIDGE && activeStage !== TransferStage.STAGE_4_TO_DESTINATION && activeStage !== TransferStage.STAGE_5_TO_CONTAINER);
    });
  }, [transferAccess, adminUser]);

  const availableFromWarehouses = useMemo(() => {
    if (stage === TransferStage.STAGE_5_TO_CONTAINER) {
      if (adminUser) return warehouses.filter(warehouse => !warehouse.inactive);
      const sources = (transferAccess?.rules || []).filter(rule => rule.is_active
        && rule.stage === TransferStage.STAGE_5_TO_CONTAINER && rule.direction === 'FROM');
      return [...new Map(sources.map(rule => [rule.warehouse_code,
        {code: rule.warehouse_code, name: rule.warehouse_name || rule.warehouse_code}])).values()];
    }
    const intermediateCodes = new Set(intermediateWarehouses.map(warehouse => warehouse.code));
    let candidates = warehouses;
    if (stage === TransferStage.STAGE_1_TO_INTERMEDIATE) candidates = warehouses.filter(warehouse => !intermediateCodes.has(warehouse.code));
    if (stage === TransferStage.STAGE_2_TO_FRIDGE) candidates = intermediateWarehouses;
    if (stage === TransferStage.STAGE_3_FROM_FRIDGE) candidates = warehouses.filter(warehouse => !intermediateCodes.has(warehouse.code)
      && !['stock-in-transit', 'transit', 'تحت النقل', 'وسيط'].some(keyword => (warehouse.name || '').toLowerCase().includes(keyword)));
    return candidates.filter(warehouse => !warehouse.inactive && isWarehouseAllowed(warehouse, 'FROM', stage));
  }, [warehouses, intermediateWarehouses, isWarehouseAllowed, stage, transferAccess, adminUser]);

  const availableToWarehouses = useMemo(() => {
    if (stage === TransferStage.STAGE_5_TO_CONTAINER) return [];
    const intermediateCodes = new Set(intermediateWarehouses.map(warehouse => warehouse.code));
    let candidates = warehouses;
    if (stage === TransferStage.STAGE_1_TO_INTERMEDIATE
      || (stage === TransferStage.STAGE_2_TO_FRIDGE && toDestType === 'intermediate')) candidates = intermediateWarehouses;
    if (stage === TransferStage.STAGE_2_TO_FRIDGE && toDestType === 'fridge') candidates = warehouses.filter(warehouse => !intermediateCodes.has(warehouse.code)
      && !['stock-in-transit', 'transit', 'تحت النقل', 'وسيط'].some(keyword => (warehouse.name || '').toLowerCase().includes(keyword)));
    return candidates.filter(warehouse => !warehouse.inactive && warehouse.code !== fromWarehouse
      && isWarehouseAllowed(warehouse, 'TO', stage));
  }, [warehouses, intermediateWarehouses, fromWarehouse, toDestType, isWarehouseAllowed, stage]);

  // ── Auto-select when only one option is available ────────────────────────────
  useEffect(() => {
    if (stage !== TransferStage.STAGE_4_TO_DESTINATION && stage !== TransferStage.STAGE_5_TO_CONTAINER && availableFromWarehouses.length === 1 && !fromWarehouse) {
      queueMicrotask(() => setFromWarehouseState((current) => current || availableFromWarehouses[0].code));
    }
  }, [availableFromWarehouses, fromWarehouse, stage]);

  useEffect(() => {
    if (stage !== TransferStage.STAGE_4_TO_DESTINATION && availableToWarehouses.length === 1 && !toWarehouse) {
      queueMicrotask(() => setToWarehouseState((current) => current || availableToWarehouses[0].code));
    }
  }, [availableToWarehouses, toWarehouse, stage]);

  // Warehouse changes reset selection before fresh, policy-filtered discovery.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setFromBinState(''); setSourcePalletPositionIdState(null); setSourcePalletPositionCodeState('');
      setBatchLines([]); setScanInput(''); setScanError(''); setScanStatus(TransferStatus.IDLE); setFromBins([]);
      if (!fromWarehouse || !fromBinRequired) return;
      try {
        const bins = await fetchDestinationBins(fromWarehouse);
        if (!cancelled) setFromBins(bins);
      } catch { if (!cancelled) setFromBins([]); }
    });
    return () => { cancelled = true; };
  }, [fromWarehouse, fromBinRequired]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setToBinState(''); setPalletPositionIdState(null); setPalletPositionCodeState(''); setToBins([]);
      if (!toWarehouse || !shouldFetchDestinationBins || dynamicDestination) return;
      try {
        const bins = await fetchDestinationBins(toWarehouse);
        if (!cancelled) setToBins(bins);
      } catch { if (!cancelled) setToBins([]); }
    });
    return () => { cancelled = true; };
  }, [toWarehouse, toDestType, shouldFetchDestinationBins, dynamicDestination]);

  // ── Setters ──────────────────────────────────────────────────────────────────
  const setPalletPosition = useCallback((position) => {
    if (!position) {
      setPalletPositionIdState(null);
      setPalletPositionCodeState('');
    } else if (typeof position === 'object') {
      setPalletPositionIdState(position.id ?? position.position_id ?? null);
      setPalletPositionCodeState(position.code ?? position.position_code ?? '');
    } else {
      setPalletPositionIdState(position);
      setPalletPositionCodeState('');
    }
  }, []);

  const setSourcePalletPosition = useCallback((position) => {
    if (!position) {
      setSourcePalletPositionIdState(null);
      setSourcePalletPositionCodeState('');
    } else if (typeof position === 'object') {
      setSourcePalletPositionIdState(position.id ?? position.position_id ?? null);
      setSourcePalletPositionCodeState(position.code ?? position.position_code ?? '');
    } else {
      setSourcePalletPositionIdState(position);
      setSourcePalletPositionCodeState('');
    }
  }, []);

  const setStage = (newStage) => {
    setStageState(newStage);
    setFromWarehouseState('');
    setFromBinState('');
    setSourcePalletPositionIdState(null);
    setSourcePalletPositionCodeState('');
    setToDestTypeState(null);
    setToWarehouseState('');
    setToBinState('');
    setPalletPositionIdState(null);
    setPalletPositionCodeState('');
    setBatchLines([]);
    setScanInput('');
    setScanError('');
    setScanStatus(TransferStatus.IDLE);
    setTransferResult(null);
    setSubmitError('');
  };

  const setToDestType = (type) => {
    setToDestTypeState(type);
    setToWarehouseState('');
    setToBinState('');
    setToBins([]);
    setPalletPositionIdState(null);
    setPalletPositionCodeState('');
    setSubmitError('');
  };

  const setFromWarehouse = (code) => {
    setFromWarehouseState(code);
    setSourcePalletPositionIdState(null);
    setSourcePalletPositionCodeState('');
    setTransferResult(null);
    setSubmitError('');
  };

  const setFromBin = (code) => {
    setFromBinState(code);
    setSourcePalletPositionIdState(null);
    setSourcePalletPositionCodeState('');
    setBatchLines([]);
    setScanInput('');
    setScanError('');
    setScanStatus(TransferStatus.IDLE);
    setTransferResult(null);
    setSubmitError('');
  };

  const setToWarehouse = (code) => {
    setToWarehouseState(code);
    setToBinState('');
    setToBins([]);
    setPalletPositionIdState(null);
    setPalletPositionCodeState('');
    setSubmitError('');
  };

  const setToBin = (code) => {
    setToBinState(code);
    setPalletPositionIdState(null);
    setPalletPositionCodeState('');
    setSubmitError('');
  };

  // ── Batch scanning ───────────────────────────────────────────────────────────
  const scanBatch = useCallback(async (batchNumber = scanInput) => {
    const trimmed = String(batchNumber || '').trim();

    if (!fromWarehouse) {
      setScanError(t('transfer.errors.selectFromWarehouse'));
      return;
    }
    if (!trimmed) {
      setScanError(t('transfer.errors.enterBatch'));
      return;
    }

    const isDuplicate = batchLines.some(
      (l) => l.batchNumber.toUpperCase() === trimmed.toUpperCase(),
    );
    if (isDuplicate) {
      setScanError(t('transfer.errors.duplicateBatch', trimmed));
      return;
    }

    setScanStatus(TransferStatus.LOADING);
    setScanError('');

    try {
      const details = await fetchBatchDetails(trimmed, fromWarehouse, fromBin, stage);

      if (!details) {
        setScanStatus(TransferStatus.ERROR);
        setScanError(
          t('transfer.errors.notFound', trimmed, fromWarehouse),
        );
        return;
      }

      setBatchLines((prev) => [
        ...prev,
        {
          itemCode: details.itemCode,
          itemName: details.itemName,
          batchNumber: details.batchNumber,
          productionPalletTypeName: details.productionPalletTypeName,
          withoutPallet: details.withoutPallet,
          batchAbsEntry: details.batchAbsEntry ?? null,
          availableQuantity: details.availableQuantity,
          uom: details.uom,
          expiryDate: details.expiryDate,
          quantity: details.availableQuantity,
          sourceType: details.sourceType,
          availabilityStatus: details.availabilityStatus || 'SAP_AVAILABLE',
          sourceStatusLabel: details.sourceStatusLabel || t('transfer.status.sapAvailable'),
          sourceMessage: details.sourceMessage || '',
          canPostToSap: details.canPostToSap,
          receiptStatus: details.receiptStatus,
          pendingReceiptId: details.pendingReceiptId,
          pendingReceiptBatchId: details.pendingReceiptBatchId,
          sourceTransferId: details.sourceTransferId,
          sourceTransferStatus: details.sourceTransferStatus,
          mock: details.mock,
        },
      ]);

      setScanInput('');
      setScanStatus(TransferStatus.SUCCESS);
    } catch (err) {
      setScanStatus(TransferStatus.ERROR);
      setScanError(
        err?.response?.data?.error || t('transfer.errors.lookupFailed', trimmed),
      );
    }
  }, [scanInput, fromWarehouse, fromBin, stage, batchLines, t]);

  const updateLineQuantity = useCallback(() => {
    // Quantity is auto-set to available_quantity, no user modification allowed
  }, []);

  const removeLine = useCallback((batchNumber) => {
    setBatchLines((prev) => prev.filter((l) => l.batchNumber !== batchNumber));
  }, []);

  // ── Submit ───────────────────────────────────────────────────────────────────
  // Lines are valid if we have at least one batch and all have available_quantity > 0
  const linesValid =
    batchLines.length > 0 &&
    batchLines.every((l) => Number(l.quantity) > 0);

  // Stage 1 and Stage 2 do NOT use from_bin at all; Stage 3 requires from_bin (fridge)
  const routeAllowed = availableFromWarehouses.some((warehouse) => warehouse.code === fromWarehouse)
    && availableToWarehouses.some((warehouse) => warehouse.code === toWarehouse)
    && (!fromBin || fromBins.includes(fromBin))
    && (!toBin || toBins.includes(toBin));

  const canSubmit =
    Boolean(stage) &&
    (!dynamicDestination || (!destinationSap.loading && !destinationBinError)) &&
    routeAllowed &&
    Boolean(fromWarehouse) &&
    (!fromBinRequired || Boolean(fromBin)) &&
    (!sourcePalletPositionRequired || Boolean(sourcePalletPositionId)) &&
    (!destinationTypeRequired || Boolean(toDestType)) &&
    Boolean(toWarehouse) &&
    (!toBinRequired || Boolean(toBin)) &&
    (!destinationPalletPositionRequired || Boolean(palletPositionId)) &&
    linesValid &&
    transferStatus !== TransferStatus.LOADING;

  const submit = async () => {
    if (!canSubmit) {
      if (sourcePalletPositionRequired && !sourcePalletPositionId) {
        setSubmitError(t('transfer.pleaseSelectSourcePalletPosition'));
      }
      return;
    }

    setTransferStatus(TransferStatus.LOADING);
    setSubmitError('');

    try {
      const payload = {
        transfer_stage: stage,
        from_warehouse: fromWarehouse,
        ...(fromBin && { from_bin: fromBin }),
        to_warehouse: toWarehouse,
        ...(toDestType && { destination_type: toDestType }),
        ...(toBin && { to_bin: toBin }),
        ...(palletPositionId && { pallet_position_id: palletPositionId }),
        ...(sourcePalletPositionId && { source_pallet_position_id: sourcePalletPositionId }),
        lines: batchLines.map((l) => ({
          item_code: l.itemCode,
          item_name: l.itemName,
          batch_number: l.batchNumber,
          production_pallet_type_name: l.productionPalletTypeName,
          without_pallet: l.withoutPallet,
          quantity: Number(l.quantity),
          uom: l.uom,
          source_type: l.sourceType,
          availability_status: l.availabilityStatus,
          source_status_label: l.sourceStatusLabel,
          source_message: l.sourceMessage,
          can_post_to_sap: l.canPostToSap,
          receipt_status: l.receiptStatus,
          pending_receipt_id: l.pendingReceiptId,
          pending_receipt_batch_id: l.pendingReceiptBatchId,
          source_transfer_id: l.sourceTransferId,
          source_transfer_status: l.sourceTransferStatus,
        })),
      };
      const result = await submitInventoryTransfer(payload);
      setTransferResult({
        stage,
        fromWarehouse,
        fromBin,
        toWarehouse,
        toBin,
        palletPositionId,
        palletPositionCode,
        sourcePalletPositionId,
        sourcePalletPositionCode,
        lines: batchLines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
        docEntry: result.docEntry,
        docNum: result.docNum,
        pending: Boolean(result.pending),
        pendingTransferId: result.pendingTransferId,
        message: result.message,
        mock: result.mock,
      });
      setTransferStatus(TransferStatus.SUCCESS);
    } catch (err) {
      setTransferStatus(TransferStatus.ERROR);
      if (err?.response?.status === 409) {
        setSubmitError(t('transfer.positionConflictOutbound'));
        return;
      }
      // Show the real SAP error; no mock fallback masking.
      const sapError =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        err?.message ||
        t('transfer.errors.transferFailed');
      setSubmitError(sapError);
    }
  };

  const reset = () => {
    setStageState(null);
    setFromWarehouseState('');
    setFromBinState('');
    setSourcePalletPositionIdState(null);
    setSourcePalletPositionCodeState('');
    setToDestTypeState(null);
    setToWarehouseState('');
    setToBinState('');
    setPalletPositionIdState(null);
    setPalletPositionCodeState('');
    setBatchLines([]);
    setScanInput('');
    setScanStatus(TransferStatus.IDLE);
    setScanError('');
    setTransferStatus(TransferStatus.IDLE);
    setTransferResult(null);
    setSubmitError('');
  };

  return {
    // Config
    destinationBinError,
    destinationBinLoading: destinationSap.loading,
    destinationTypeRequired,
    allowedSourceMapBins: null,
    allowedDestinationMapBins: null,
    transferAccess,
    transferAccessLoading,
    // Stage
    stage,
    setStage,
    // Warehouses (raw + filtered by stage)
    warehouses,
    intermediateWarehouses,
    availableFromWarehouses,
    availableToWarehouses,
    fromBins,
    toBins,
    // Source
    fromWarehouse,
    setFromWarehouse,
    fromBin,
    setFromBin,
    sourcePalletPositionId,
    sourcePalletPositionCode,
    setSourcePalletPosition,
    sourcePalletPositionRequired,
    // Destination
    toDestType,
    setToDestType,
    toWarehouse,
    setToWarehouse,
    toBin,
    setToBin,
    palletPositionId,
    palletPositionCode,
    setPalletPosition,
    // Batch scanning
    batchLines,
    scanInput,
    setScanInput,
    scanStatus,
    scanError,
    scanBatch,
    updateLineQuantity,
    removeLine,
    // Submit
    fromBinRequired,
    toBinRequired,
    destinationPalletPositionRequired,
    canSubmit,
    transferStatus,
    submitError,
    transferResult,
    submit,
    reset,
  };
}
