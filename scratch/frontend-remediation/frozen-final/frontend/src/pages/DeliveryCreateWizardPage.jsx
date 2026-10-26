import '../styles/pages/sales-readiness.css';
import { warehouseSearch, binSearch } from '../services/masterDataSearch';
import API from '../services/api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  Package,
  Truck,
  Layers,
  Tag,
  Building2,
  Briefcase,
  ClipboardCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  AlertCircle,
  RotateCcw,
  FileText,
  Check,
  Send,
  Printer,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { canManageDelivery } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';
import ShippingManifestSummary from '../components/ShippingManifestSummary';
import '../styles/pages/shipping-loading.css';
import SearchableSelect from '../components/ui/SearchableSelect';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { getProductIcon } from '../utils/productIcon';
import EmptyState from '../components/ui/EmptyState';
import AppSpinner from '../components/ui/AppSpinner';
import SalesDocumentPrintable from '../components/print/SalesDocumentPrintable';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import {
  fetchDeliveryDocument,
  fetchPostedDeliveryDocument,
  fetchDeliveryDrafts,
  fetchDeliveryDraft,
  fetchAvailableBatches,
  createDeliveryDraft,
  updateDeliveryDraft,
  submitDeliveryDraft,
  approveDeliveryDraft,
  postDeliveryToSap,
  reconcileDeliveryDraft,
} from '../services/customizationDeliveryService';
import {
  loadCostCenters,
} from '../services/purchaseGrpoService';

import '../styles/pages/quality-inspection.css';

const formatSapError = (err) => {
  if (!err) return '';
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      return parsed.message || parsed.error?.message?.value || parsed.error?.message || err;
    } catch {
      const match = err.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/);
      if (match && match[1]) return match[1];
      return err;
    }
  }
  if (typeof err === 'object') {
    return err.message || err.error?.message?.value || err.error?.message || JSON.stringify(err);
  }
  return String(err);
};

const WIZARD_STEPS = [
  { id: 'order', icon: Package, labelKey: 'customizationDelivery.wizard.delivStep1Order' },
  { id: 'quantities', icon: Layers, labelKey: 'customizationDelivery.wizard.delivStep2Quantities' },
  { id: 'batches', icon: Tag, labelKey: 'customizationDelivery.wizard.delivStep3Batches' },
  { id: 'bins', icon: Building2, labelKey: 'customizationDelivery.wizard.delivStep4Bins' },
  { id: 'dimensions', icon: Briefcase, labelKey: 'customizationDelivery.wizard.delivStep5Dimensions' },
  { id: 'review', icon: ClipboardCheck, labelKey: 'customizationDelivery.wizard.delivStep6Review' },
];

export default function DeliveryCreateWizardPage() {
  const { docEntry } = useParams();
  const [shippingParams] = useSearchParams();
  const requestedDraftId = shippingParams.get('draft_id');
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const isManager = canManageDelivery(user);
  const isRtl = lang === 'ar';

  const [step, setStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);

  // Loading states
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [initialError, setInitialError] = useState(null);

  // Sales Order & Draft Data
  const [orderDoc, setOrderDoc] = useState(null);
  const [activeDraft, setActiveDraft] = useState(null);

  // Master data
  const [warehouses, setWarehouses] = useState([]);
  const [binLocationsMap, setBinLocationsMap] = useState({});
  const [costCentersDim1, setCostCentersDim1] = useState([]);
  const [costCentersDim2, setCostCentersDim2] = useState([]);
  const [availableBatchesMap, setAvailableBatchesMap] = useState({});
  const loadingBatchesMap = {};
  const [pendingBatchMap, setPendingBatchMap] = useState({});


  // Form State
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [docDueDate, setDocDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [comments, setComments] = useState('');
  const [selectedCostCenter1, setSelectedCostCenter1] = useState('');
  const [selectedCostCenter2, setSelectedCostCenter2] = useState('');

  // Editable delivery lines
  // Structure: { id, line_number, item_code, item_description, uom, order_qty, open_qty, delivery_qty, warehouse_code, batches: [{ id, batch_number, quantity, bin_code, bin_abs_entry }] }
  const [lines, setLines] = useState([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [postedResult, setPostedResult] = useState(null);
  const [submittedReviewResult, setSubmittedReviewResult] = useState(null);

  // Direct print state for posted delivery
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const handlePrintDelivery = async () => {
    if (!postedResult) return;
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Please allow popups for printing.');
      return;
    }
    try {
      const document = await fetchPostedDeliveryDocument(postedResult.sap_doc_entry);
      setPrintRequest({ printWindow, document,
        generatedAt: new Date().toLocaleString(isRtl ? 'ar-EG' : 'en-US') });
    } catch (error) { printWindow.close(); toast.error(error.response?.data?.error || t('common.errorLoadingData')); }
  };

  useEffect(() => {
    if (!printRequest) return undefined;
    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []);
      const opened = writePrintDocument({
        printWindow: printRequest.printWindow,
        title: t('customizationDelivery.deliveryDocument') || 'Delivery Document',
        elements: sheets,
        orientation: 'landscape',
        direction: lang === 'ar' ? 'rtl' : 'ltr',
      });
      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(t('quality.printWindowBlocked') || 'Please allow popups for printing.');
      }
      setPrintRequest(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [printRequest, t, toast, isRtl, lang]);

  // Step bar scrolling on mobile
  const stepbarRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const activeStep = stepbarRef.current?.querySelector('.wizard-step--active');
    activeStep?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [step]);

  // Load Order, Draft, and Master Data
  const initialRequestRef = useRef(null);
  const initData = useCallback(async () => {
    if (!docEntry) {
      setLoadingInitial(false);
      return;
    }
    const requestIdentity = `${docEntry}:${requestedDraftId || ''}`;
    if (initialRequestRef.current === requestIdentity) return;
    initialRequestRef.current = requestIdentity;
    setLoadingInitial(true);
    setInitialError(null);
    try {
      const [orderData, draftsList, whsList] = await Promise.all([
        fetchDeliveryDocument(docEntry),
        fetchDeliveryDrafts({ sales_order_doc_entry: docEntry }),
        Promise.resolve([]),
      ]);

      setOrderDoc(orderData);
      setWarehouses(whsList || []);

      // Active draft lookup: only consider active workflow statuses (exclude POSTED and FAILED)
      const ACTIVE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'POSTING'];
      const activeDraftCandidate = (draftsList || []).find((d) => ACTIVE_STATUSES.includes(d.status));
      const failedDraftCandidate = !activeDraftCandidate
        ? (draftsList || []).filter((d) => d.status === 'FAILED').sort((a, b) => b.id - a.id)[0]
        : null;

      let currentDraft = activeDraftCandidate || failedDraftCandidate;
      if (requestedDraftId) {
        currentDraft = await fetchDeliveryDraft(requestedDraftId);
        if (Number(currentDraft.sales_order_doc_entry) !== Number(docEntry)) throw new Error('Delivery draft does not match this order.');
      }
      if (!currentDraft) {
        try {
          currentDraft = await createDeliveryDraft({ sales_order_doc_entry: parseInt(docEntry, 10) });
        } catch (createErr) {
          const refetched = await fetchDeliveryDrafts({ sales_order_doc_entry: docEntry }).catch(() => []);
          currentDraft = (refetched || []).find((d) => ACTIVE_STATUSES.includes(d.status));
          if (!currentDraft) throw createErr;
        }
      }
      setActiveDraft(currentDraft);
      if (currentDraft?.shipping_manifest && ['DRAFT', 'REJECTED'].includes(currentDraft.status)) {
        setStep(4);
        setMaxReachedStep(4);
      } else if (['PENDING_REVIEW', 'APPROVED', 'POSTING'].includes(currentDraft?.status)) {
        setStep(5);
        setMaxReachedStep(5);
      }

      // Populate line items from draft (or fallback to order)
      if (currentDraft && currentDraft.lines?.length > 0) {
        setLines(
          currentDraft.lines.map((l) => ({
            id: l.id || l.line_number,
            line_number: l.line_number,
            item_code: l.item_code,
            item_description: l.item_description,
            uom: l.uom || 'Unit',
            order_qty: Number(l.order_quantity) || 0,
            open_qty: Number(l.open_quantity_at_draft) || 0,
            delivery_qty: Number(l.delivery_quantity ?? l.open_quantity_at_draft ?? 0),
            warehouse_code: l.warehouse_code || (whsList[0]?.WarehouseCode || ''),
            batches: l.batches || [],
          }))
        );
        if (currentDraft.comments) setComments(currentDraft.comments);
        if (currentDraft.doc_date) setDocDate(String(currentDraft.doc_date).split('T')[0]);
        if (currentDraft.doc_due_date) setDocDueDate(String(currentDraft.doc_due_date).split('T')[0]);
        if (currentDraft.cost_center_1) setSelectedCostCenter1(currentDraft.cost_center_1);
        if (currentDraft.cost_center_2) setSelectedCostCenter2(currentDraft.cost_center_2);
      } else if (orderData && (orderData.DocumentLines || orderData.lines)) {
        const sourceLines = orderData.DocumentLines || orderData.lines || [];
        setLines(
          sourceLines.map((l) => {
            const rawOrdered = Number(l.Quantity ?? l.quantity ?? 0);
            const rawDelivered = Number(l.DeliveredQuantity ?? l.delivered_quantity ?? 0);
            const openQty = Number(
              l.RemainingOpenQuantity ??
              l.remaining_open_quantity ??
              l.OpenQuantity ??
              l.open_quantity ??
              l.OpenQty ??
              (rawOrdered - rawDelivered)
            );
            const lineNum = Number(l.LineNum ?? l.line_number ?? l.line_num ?? 0);
            return {
              id: lineNum,
              line_number: lineNum,
              item_code: l.ItemCode || l.item_code || '',
              item_description: l.ItemDescription || l.item_description || l.item_name || l.ItemCode || l.item_code || '',
              uom: l.MeasureUnit || l.SalesUnit || l.uom || 'Unit',
              order_qty: rawOrdered,
              open_qty: Math.max(0, openQty),
              delivery_qty: Math.max(0, openQty),
              warehouse_code: l.WarehouseCode || l.warehouse_code || (whsList[0]?.WarehouseCode || ''),
              batches: [],
            };
          })
        );
        if (orderData.DocDate) setDocDate(String(orderData.DocDate).split('T')[0]);
        if (orderData.DocDueDate) setDocDueDate(String(orderData.DocDueDate).split('T')[0]);
      }

    } catch (err) {
      console.error('Failed to initialize delivery wizard:', err);
      const msg = err.response?.data?.error || err.message || t('common.errorLoadingData');
      setInitialError(msg);
      toast.error(msg);
    } finally {
      if (initialRequestRef.current === requestIdentity) initialRequestRef.current = null;
      setLoadingInitial(false);
    }
  }, [docEntry, requestedDraftId, t, toast]);

  useEffect(() => {
    initData();
  }, [initData]);

  // Load bin locations when entering Step 4
  const loadBinsForLineWarehouses = useCallback(async () => {
    const whsCodes = [...new Set(lines.map((l) => l.warehouse_code).filter(Boolean))];
    for (const code of whsCodes) {
      if (!binLocationsMap[code]) {
        try {
          const response = await API.get(`/bin-locations/${encodeURIComponent(code)}/`, { params: { lookup: 1, probe: 1, limit: 1 } });
          const bins = response.data?.data?.locations || [];
          setBinLocationsMap((prev) => ({ ...prev, [code]: bins || [] }));
        } catch (err) {
          console.error(`Failed to load bins for ${code}:`, err);
        }
      }
    }
  }, [lines, binLocationsMap]);

  useEffect(() => {
    if (step === 3) {
      loadBinsForLineWarehouses();
    }
  }, [step, loadBinsForLineWarehouses]);

  // Load cost centers lazily when entering Step 4 (Dimensions)
  const [loadingCostCenters, setLoadingCostCenters] = useState(false);
  const loadCostCentersForDimensions = useCallback(async () => {
    if (costCentersDim1.length > 0 || costCentersDim2.length > 0 || loadingCostCenters) return;
    setLoadingCostCenters(true);
    try {
      const [cc1, cc2] = await Promise.all([
        loadCostCenters(1).catch(() => []),
        loadCostCenters(2).catch(() => []),
      ]);
      setCostCentersDim1(cc1 || []);
      setCostCentersDim2(cc2 || []);
    } catch (err) {
      console.error('Failed to load cost centers:', err);
    } finally {
      setLoadingCostCenters(false);
    }
  }, [costCentersDim1.length, costCentersDim2.length, loadingCostCenters]);

  useEffect(() => {
    if (step === 4) {
      loadCostCentersForDimensions();
    }
  }, [step, loadCostCentersForDimensions]);


  // Options memoization
  const warehouseOptions = useMemo(() => {
    return warehouses.map((w) => {
      const code = w.WarehouseCode || w.code || '';
      const name = w.WarehouseName || w.name || code;
      return {
        value: code,
        label: `${code} - ${name}`,
      };
    });
  }, [warehouses]);

  const costCenterOptions1 = useMemo(() => {
    return (costCentersDim1 || []).map((cc) => ({
      value: cc.code,
      label: `${cc.code} - ${cc.name || cc.code}`,
    }));
  }, [costCentersDim1]);

  const costCenterOptions2 = useMemo(() => {
    return (costCentersDim2 || []).map((cc) => ({
      value: cc.code,
      label: `${cc.code} - ${cc.name || cc.code}`,
    }));
  }, [costCentersDim2]);

  // Line Qty handlers
  const handleDeliveryQtyChange = (lineNum, value) => {
    const parsed = value === '' ? '' : Math.max(0, parseFloat(value) || 0);
    setLines((prev) =>
      prev.map((l) => {
        if (l.line_number !== lineNum) return l;
        const capped = typeof parsed === 'number' ? Math.min(parsed, l.open_qty) : parsed;
        return { ...l, delivery_qty: capped };
      })
    );
  };

  const handleDeliverAllRemaining = () => {
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        delivery_qty: l.open_qty,
      }))
    );
  };

  const handleWarehouseChange = (lineNum, whsCode) => {
    setLines((prev) =>
      prev.map((l) => (l.line_number === lineNum && l.warehouse_code !== whsCode ? { ...l, warehouse_code: whsCode, batches: [] } : l))
    );
    setPendingBatchMap((previous) => ({ ...previous, [lineNum]: null }));
  };

  // Batch allocation handlers
  const handleAddBatch = (
    lineNum,
    batchNumber,
    quantity,
    binCode = '',
    binAbsEntry = null,
    existingBatchId = null
  ) => {
    if (!batchNumber || !quantity || Number(quantity) <= 0) return;
    setLines((prev) =>
      prev.map((l) => {
        if (l.line_number !== lineNum) return l;
        const cleanNum = String(batchNumber).trim();
        const currentBatches = l.batches || [];

        // Check if batch already exists by ID or by batch number
        const matchIdx = currentBatches.findIndex(
          (b) => (existingBatchId && b.id === existingBatchId) || b.batch_number === cleanNum
        );

        if (matchIdx >= 0) {
          const updated = currentBatches.map((b, idx) =>
            idx === matchIdx
              ? {
                  ...b,
                  quantity: Number(quantity),
                  bin_code: binCode || b.bin_code,
                  bin_abs_entry: binAbsEntry ?? b.bin_abs_entry,
                }
              : b
          );
          return { ...l, batches: updated };
        }

        const newBatch = {
          id: existingBatchId || Date.now() + Math.random(),
          batch_number: cleanNum,
          quantity: Number(quantity),
          bin_code: binCode,
          bin_abs_entry: binAbsEntry,
        };
        return { ...l, batches: [...currentBatches, newBatch] };
      })
    );
  };

  const handleRemoveBatch = (lineNum, batchId) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.line_number !== lineNum) return l;
        return { ...l, batches: (l.batches || []).filter((b) => b.id !== batchId) };
      })
    );
    setPendingBatchMap((prev) => {
      const current = prev[lineNum];
      if (current && (current.committed_batch_id === batchId || !current.committed_batch_id)) {
        return {
          ...prev,
          [lineNum]: {
            batch_number: '',
            quantity: '',
            max_qty: 0,
            bin_code: '',
            bin_abs_entry: null,
            committed_batch_id: null,
          },
        };
      }
      return prev;
    });
  };

  const handleAutoFillBatch = async (lineNum) => {
    const selectedLine = lines.find((line) => line.line_number === lineNum);
    if (!selectedLine) return;
    let inventory;
    try {
      inventory = await fetchAvailableBatches({ item_code: selectedLine.item_code, warehouse_code: selectedLine.warehouse_code });
    } catch (error) {
      toast.error(error?.message || t('common.error'));
      return;
    }
    setAvailableBatchesMap((previous) => ({ ...previous, [`${selectedLine.item_code}__${selectedLine.warehouse_code || ''}`]: inventory }));
    setLines((prev) =>
      prev.map((l) => {
        if (l.line_number !== lineNum) return l;
        if (!l.delivery_qty || Number(l.delivery_qty) <= 0) return l;

        const avail = inventory;
        if (avail.length > 0) {
          let needed = Number(l.delivery_qty);
          const allocated = [];
          for (const b of avail) {
            if (needed <= 0) break;
            const take = Math.min(needed, b.on_hand_qty);
            allocated.push({
              id: Date.now() + Math.random(),
              batch_number: b.batch_number,
              quantity: take,
              bin_code: b.bin_code || '',
              bin_abs_entry: b.bin_abs_entry || null,
            });
            needed -= take;
          }
          return { ...l, batches: allocated };
        }
        const autoBatchNum = `BAT-${orderDoc?.DocumentNumber || docEntry}-${l.line_number + 1}`;
        return {
          ...l,
          batches: [
            {
              id: Date.now(),
              batch_number: autoBatchNum,
              quantity: Number(l.delivery_qty),
              bin_code: '',
              bin_abs_entry: null,
            },
          ],
        };
      })
    );
    setPendingBatchMap((prev) => ({
      ...prev,
      [lineNum]: {
        batch_number: '',
        quantity: '',
        max_qty: 0,
        bin_code: '',
        bin_abs_entry: null,
        committed_batch_id: null,
      },
    }));
  };

  // Defensive commit of any pending batch in pendingBatchMap
  const commitPendingBatches = (sourceLines = lines, sourcePendingMap = pendingBatchMap) => {
    let changed = false;
    const updated = sourceLines.map((l) => {
      const pending = sourcePendingMap[l.line_number];
      if (!pending || !pending.batch_number || Number(pending.quantity) <= 0) {
        return l;
      }

      const cleanBatchNumber = String(pending.batch_number).trim();
      const existingBatches = l.batches || [];
      const matchIdx = existingBatches.findIndex(
        (b) =>
          (pending.committed_batch_id && b.id === pending.committed_batch_id) ||
          b.batch_number === cleanBatchNumber
      );

      // Validate quantities: cannot exceed batch on-hand or sales order open quantity
      const maxBatchOnHand = Number(pending.max_qty) > 0 ? Number(pending.max_qty) : Infinity;
      const openLimit = Number(l.open_qty) > 0 ? Number(l.open_qty) : Number(l.delivery_qty || 0);
      const deliveryLimit = Number(l.delivery_qty) > 0 ? Number(l.delivery_qty) : openLimit;
      const targetMax = Math.min(maxBatchOnHand, openLimit, deliveryLimit);
      const safeQty = Math.max(0, Math.min(Number(pending.quantity), targetMax));

      if (safeQty <= 0) return l;

      changed = true;
      if (matchIdx >= 0) {
        const newBatches = existingBatches.map((b, i) =>
          i === matchIdx
            ? {
                ...b,
                quantity: safeQty,
                bin_code: pending.bin_code || b.bin_code,
                bin_abs_entry: pending.bin_abs_entry ?? b.bin_abs_entry,
              }
            : b
        );
        return { ...l, batches: newBatches };
      }

      const newBatchEntry = {
        id: pending.committed_batch_id || Date.now() + Math.random(),
        batch_number: cleanBatchNumber,
        quantity: safeQty,
        bin_code: pending.bin_code || '',
        bin_abs_entry: pending.bin_abs_entry || null,
      };
      return {
        ...l,
        batches: [...existingBatches, newBatchEntry],
      };
    });

    return { updatedLines: updated, hasChanges: changed };
  };

  // Grand totals
  const totalDeliveringUnits = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.delivery_qty) || 0), 0),
    [lines]
  );

  const activeLinesCount = useMemo(
    () => lines.filter((l) => Number(l.delivery_qty) > 0).length,
    [lines]
  );

  // Step Validation
  const validateStep = (currentIdx, linesToCheck = lines) => {
    if (currentIdx === 0) {
      const hasAnyOpen = linesToCheck.some((l) => l.open_qty > 0);
      if (!hasAnyOpen) {
        toast.warning(
          lang === 'ar'
            ? 'هذا الأمر مكتمل التسليم بالكامل في SAP ولا توجد كميات متبقية'
            : 'This sales order is already fully delivered in SAP.'
        );
        return false;
      }
      return true;
    }
    if (currentIdx === 1) {
      const deliveringUnits = linesToCheck.reduce((sum, l) => sum + (Number(l.delivery_qty) || 0), 0);
      if (deliveringUnits <= 0) {
        toast.error(
          lang === 'ar'
            ? 'يجب تحديد كمية تسليم أكبر من صفر لبند واحد على الأقل'
            : 'At least one line must have a delivery quantity greater than zero'
        );
        return false;
      }
      for (const l of linesToCheck) {
        if (Number(l.delivery_qty) > l.open_qty + 0.0001) {
          toast.error(
            lang === 'ar'
              ? `كمية التسليم للصنف ${l.item_code} تتجاوز الكمية المتبقية`
              : `Delivery quantity for item ${l.item_code} exceeds remaining open quantity`
          );
          return false;
        }
      }
      return true;
    }
    if (currentIdx === 2) {
      // Validate batch allocation for active lines
      for (const l of linesToCheck) {
        if (Number(l.delivery_qty) > 0) {
          const key = `${l.item_code}__${l.warehouse_code || ''}`;
          const avail = availableBatchesMap[key] || [];
          const batches = l.batches || [];

          // If available batches exist in SAP for this item/whs, a batch MUST be allocated
          if (avail.length > 0 && batches.length === 0) {
            toast.error(
              lang === 'ar'
                ? `يرجى اختيار وتخصيص تشغيلة للصنف ${l.item_code} قبل المتابعة`
                : `Please allocate a batch for item ${l.item_code} before continuing`
            );
            return false;
          }

          if (batches.length > 0) {
            const batchSum = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
            if (Math.abs(batchSum - Number(l.delivery_qty)) > 0.001) {
              toast.error(
                lang === 'ar'
                  ? `مجموع التشغيلات (${batchSum}) لا يطابق كمية التسليم (${l.delivery_qty}) للصنف ${l.item_code}`
                  : `Batch sum (${batchSum}) does not match delivery quantity (${l.delivery_qty}) for ${l.item_code}`
              );
              return false;
            }
          }
        }
      }
      return true;
    }
    return true;
  };

  const goToStep = (targetIdx) => {
    if (activeDraft?.shipping_manifest && targetIdx < 4) return;
    let activeLines = lines;
    if (step === 2) {
      const { updatedLines, hasChanges } = commitPendingBatches(lines, pendingBatchMap);
      if (hasChanges) {
        activeLines = updatedLines;
        setLines(updatedLines);
      }
    }
    if (targetIdx > step) {
      if (!validateStep(step, activeLines)) return;
    }
    setStep(targetIdx);
    setMaxReachedStep((prev) => Math.max(prev, targetIdx));
  };

  const nextStep = () => {
    let activeLines = lines;
    if (step === 2) {
      const { updatedLines, hasChanges } = commitPendingBatches(lines, pendingBatchMap);
      if (hasChanges) {
        activeLines = updatedLines;
        setLines(updatedLines);
      }
    }
    if (!validateStep(step, activeLines)) return;
    const nextIdx = step + 1;
    setStep(nextIdx);
    setMaxReachedStep((prev) => Math.max(prev, nextIdx));
  };

  const prevStep = () => {
    if (activeDraft?.shipping_manifest && step <= 4) return;
    if (step > 0) {
      setStep(step - 1);
    }
  };

  // Helper to build payload and save draft with costing dimensions
  const buildAndSaveDraft = async () => {
    if (!activeDraft || activeDraft.status === 'FAILED') {
      throw new Error(
        lang === 'ar'
          ? 'لا يمكن تعديل مسودة بحالة FAILED. يرجى بدء مسودة جديدة.'
          : 'Cannot modify a draft in FAILED status. Please start a new draft.'
      );
    }

    let activeLines = lines;
    const { updatedLines, hasChanges } = commitPendingBatches(lines, pendingBatchMap);
    if (hasChanges) {
      activeLines = updatedLines;
      setLines(updatedLines);
    }

    const payloadLines = activeLines.map((l) => ({
      line_number: l.line_number,
      delivery_quantity: Number(l.delivery_qty) || 0,
      warehouse_code: l.warehouse_code,
      cost_center_code: selectedCostCenter1 || '',
      cost_center_code2: selectedCostCenter2 || '',
      batches: (l.batches || []).map((b) => ({
        batch_number: b.batch_number,
        quantity: Number(b.quantity),
        bin_abs_entry: b.bin_abs_entry,
        bin_code: b.bin_code,
      })),
    }));

    const fullComments = [
      comments,
      selectedCostCenter1 ? `Dim1: ${selectedCostCenter1}` : '',
      selectedCostCenter2 ? `Dim2: ${selectedCostCenter2}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    return await updateDeliveryDraft(activeDraft.id, {
      lines: payloadLines,
      comments: fullComments,
      doc_date: docDate,
      doc_due_date: docDueDate,
      cost_center_1: selectedCostCenter1,
      cost_center_2: selectedCostCenter2,
    });
  };

  // Recovery action for FAILED drafts: Start a fresh new draft referencing the same order
  const [creatingNewDraft, setCreatingNewDraft] = useState(false);
  const handleStartNewDraft = async () => {
    setCreatingNewDraft(true);
    try {
      const newDraft = await createDeliveryDraft({ sales_order_doc_entry: parseInt(docEntry, 10) });
      setActiveDraft(newDraft);

      if (newDraft && newDraft.lines?.length > 0) {
        setLines(
          newDraft.lines.map((l) => ({
            id: l.id || l.line_number,
            line_number: l.line_number,
            item_code: l.item_code,
            item_description: l.item_description,
            uom: l.uom || 'Unit',
            order_qty: Number(l.order_quantity) || 0,
            open_qty: Number(l.open_quantity_at_draft) || 0,
            delivery_qty: Number(l.delivery_quantity ?? l.open_quantity_at_draft ?? 0),
            warehouse_code: l.warehouse_code || (warehouses[0]?.WarehouseCode || ''),
            batches: l.batches || [],
          }))
        );
        if (newDraft.comments) setComments(newDraft.comments);
        if (newDraft.doc_date) setDocDate(String(newDraft.doc_date).split('T')[0]);
        if (newDraft.doc_due_date) setDocDueDate(String(newDraft.doc_due_date).split('T')[0]);
      } else if (orderDoc && (orderDoc.DocumentLines || orderDoc.lines)) {
        const sourceLines = orderDoc.DocumentLines || orderDoc.lines || [];
        setLines(
          sourceLines.map((l) => {
            const rawOrdered = Number(l.Quantity ?? l.quantity ?? 0);
            const rawDelivered = Number(l.DeliveredQuantity ?? l.delivered_quantity ?? 0);
            const openQty = Number(
              l.RemainingOpenQuantity ??
              l.remaining_open_quantity ??
              l.OpenQuantity ??
              l.open_quantity ??
              l.OpenQty ??
              (rawOrdered - rawDelivered)
            );
            const lineNum = Number(l.LineNum ?? l.line_number ?? l.line_num ?? 0);
            return {
              id: lineNum,
              line_number: lineNum,
              item_code: l.ItemCode || l.item_code || '',
              item_description: l.ItemDescription || l.item_description || l.item_name || l.ItemCode || l.item_code || '',
              uom: l.MeasureUnit || l.SalesUnit || l.uom || 'Unit',
              order_qty: rawOrdered,
              open_qty: Math.max(0, openQty),
              delivery_qty: Math.max(0, openQty),
              warehouse_code: l.WarehouseCode || l.warehouse_code || (warehouses[0]?.WarehouseCode || ''),
              batches: [],
            };
          })
        );
      }
      setStep(0);
      toast.success(
        lang === 'ar'
          ? `تم بدء مسودة تسليم جديدة #${newDraft.id}`
          : `Started new delivery draft #${newDraft.id}`
      );
    } catch (err) {
      console.error('Failed to start new delivery draft:', err);
      const msg =
        err.response?.data?.error ||
        err.message ||
        (lang === 'ar' ? 'فشل إنشاء مسودة جديدة' : 'Failed to start new draft');
      toast.error(msg);
    } finally {
      setCreatingNewDraft(false);
    }
  };

  // Delivery Operator / Manager action: Save & Submit for Review
  const handleSaveAndSubmit = async () => {
    if (!activeDraft) {
      toast.error('No active draft found');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const updatedDraft = ['PENDING_REVIEW', 'APPROVED'].includes(activeDraft.status)
        ? activeDraft : await buildAndSaveDraft();

      let readyDraft = updatedDraft;
      if (['DRAFT', 'REJECTED'].includes(readyDraft.status)) {
        readyDraft = await submitDeliveryDraft(readyDraft.id);
      }

      setSubmittedReviewResult(readyDraft);
      toast.success(
        lang === 'ar'
          ? `تم تقديم مسودة التسليم #${readyDraft.id} للاعتماد بنجاح!`
          : `Delivery draft #${readyDraft.id} submitted for review!`
      );
    } catch (err) {
      console.error('Failed to submit delivery draft:', err);
      const msg =
        err.response?.data?.error ||
        err.message ||
        (lang === 'ar' ? 'فشل تقديم مسودة التسليم للاعتماد' : 'Failed to submit delivery draft for review');
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Manager-only action: Approve & Post directly to SAP
  const handlePostDelivery = async () => {
    if (!activeDraft) {
      toast.error('No active draft found');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const updatedDraft = ['PENDING_REVIEW', 'APPROVED'].includes(activeDraft.status)
        ? activeDraft : await buildAndSaveDraft();

      let readyDraft = updatedDraft;
      if (['DRAFT', 'REJECTED'].includes(readyDraft.status)) {
        readyDraft = await submitDeliveryDraft(readyDraft.id);
      }

      // Manager approval
      if (readyDraft.status === 'PENDING_REVIEW') {
        readyDraft = await approveDeliveryDraft(readyDraft.id);
      }

      // Native SAP Delivery Note posting
      const posted = await postDeliveryToSap(readyDraft.id);
      setPostedResult(posted);
      toast.success(
        lang === 'ar'
          ? `تم إنشاء وترحيل إذن التسليم #${posted.sap_doc_num || ''} بنجاح في SAP!`
          : `SAP Delivery Note #${posted.sap_doc_num || ''} posted successfully!`
      );
    } catch (err) {
      console.error('Failed to post delivery to SAP:', err);
      try { setActiveDraft(await fetchDeliveryDraft(activeDraft.id)); } catch { /* Preserve the original posting error. */ }
      const msg =
        err.response?.data?.error ||
        err.message ||
        (lang === 'ar' ? 'فشل إنشاء إذن التسليم في SAP' : 'Failed to post delivery note');
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconcile = async () => {
    setSubmitting(true);
    try {
      const result = await reconcileDeliveryDraft(activeDraft.id);
      setActiveDraft(result);
      if (result.status === 'POSTED') setPostedResult(result);
      else setSubmitError(lang === 'ar'
        ? 'لم يتم تأكيد إنشاء المستند في SAP. لا تُعد الترحيل؛ راجع المسؤول.'
        : 'SAP creation is still unconfirmed. Do not repost; contact your administrator.');
    } catch (error) { setSubmitError(error.response?.data?.error || error.message); }
    finally { setSubmitting(false); }
  };

  const ArrowNext = isRtl ? ArrowLeft : ArrowRight;
  const ArrowPrev = isRtl ? ArrowRight : ArrowLeft;

  if (loadingInitial) {
    return (
      <div className="shipping-delivery-page page-shell sales-readiness-workflow" style={{ padding: '40px 24px' }}>
        <LoadingSkeleton count={4} />
      </div>
    );
  }

  if (initialError || !orderDoc) {
    return (
      <div className="shipping-delivery-page page-shell sales-readiness-workflow">
        <PageHeader
          eyebrow={lang === 'ar' ? 'المرحلة ٣: التسليم' : 'Layer 3: Delivery'}
          title={lang === 'ar' ? 'إنشاء إذن تسليم جديد' : 'Create Delivery Note'}
        />
        <section className="card-panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '20px' }}>
            {initialError || 'Order not found'}
          </div>
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => navigate('/customization-delivery/deliveries')}
          >
            {lang === 'ar' ? '← العودة للتسليمات' : '← Back to Deliveries'}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="shipping-delivery-page page-shell sales-readiness-workflow">
      <PageHeader
        eyebrow={lang === 'ar' ? 'المرحلة ٣: معالج التسليم' : 'Layer 3: Delivery Wizard'}
        title={`${lang === 'ar' ? 'إنشاء إذن تسليم لأمر البيع' : 'Create Delivery Note for Order'} #${orderDoc?.DocumentNumber || orderDoc?.document_number || docEntry}`}
        description={

          lang === 'ar'
            ? 'معالج تدريجي للتحقق من الكميات المتبقية وتخصيص التشغيلات ومواقع التخزين وإنشاء إذن التسليم الأصلي في SAP'
            : 'Step-by-step wizard to verify open quantities, allocate batches & bins, and post native SAP Delivery Notes'
        }
        actions={
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => navigate('/customization-delivery/deliveries')}
          >
            <ArrowPrev size={16} />
            <span style={{ marginInlineStart: '6px' }}>
              {lang === 'ar' ? 'العودة للتسليمات' : 'Back to Deliveries'}
            </span>
          </button>
        }
      />

      {activeDraft?.status === 'POSTING' && (
        <div role="alert" className="app-card" style={{ padding: 20, marginBottom: 20 }}>
          <p>{lang === 'ar' ? 'نتيجة الترحيل إلى SAP غير مؤكدة. تحقق من المستند قبل أي محاولة أخرى.' : 'SAP posting is unconfirmed. Check the document before attempting another delivery.'}</p>
          <button type="button" className="app-button" onClick={handleReconcile} disabled={submitting}>
            {lang === 'ar' ? 'التحقق من SAP بدون إعادة الترحيل' : 'Check SAP without reposting'}
          </button>
        </div>
      )}
      {activeDraft?.shipping_manifest && <ShippingManifestSummary manifest={activeDraft.shipping_manifest} commercial />}
      {/* FAILED DRAFT RECOVERY BANNER */}
      {activeDraft?.status === 'FAILED' && (
        <div
          className="feedback-message feedback-message--error"
          style={{
            marginBottom: '20px',
            padding: '16px 20px',
            borderRadius: '10px',
            border: '1px solid var(--accent-danger, #ef4444)',
            background: 'rgba(239, 68, 68, 0.08)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flex: '1 1 320px' }}>
            <AlertCircle size={24} style={{ color: 'var(--accent-danger, #ef4444)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <h4 style={{ margin: 0, color: 'var(--accent-danger, #ef4444)', fontSize: '1rem', fontWeight: 600 }}>
                  {lang === 'ar'
                    ? `فشلت محاولة الترحيل السابقة للمسودة #${activeDraft.id}`
                    : `Previous posting attempt failed for Draft #${activeDraft.id}`}
                </h4>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: 'var(--accent-danger, #ef4444)',
                  }}
                >
                  FAILED
                </span>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem', color: 'var(--text-body, inherit)' }}>
                {lang === 'ar'
                  ? 'تم تسجيل هذه المسودة بحالة FAILED بعد رفضها من قِبل SAP Business One، ولا يمكن تعديلها أو إعادة ترحيلها مباشرة. يرجى مراجعة سبب الفشل أدناه ثم النقر على "بدء مسودة جديدة" لإعادة المحاولة.'
                  : 'This draft was marked as FAILED after being rejected by SAP Business One, and cannot be edited or reposted directly. Please review the SAP error below and click "Start New Draft" to retry.'}
              </p>
              {activeDraft.sap_error && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    color: 'var(--accent-danger, #ef4444)',
                    wordBreak: 'break-word',
                  }}
                >
                  <strong>{lang === 'ar' ? 'رسالة خطأ SAP: ' : 'SAP Error: '}</strong>
                  {formatSapError(activeDraft.sap_error)}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={handleStartNewDraft}
            disabled={creatingNewDraft}
            style={{
              whiteSpace: 'nowrap',
              alignSelf: 'center',
              padding: '10px 18px',
            }}
          >
            {creatingNewDraft ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <>
                <RotateCcw size={16} />
                <span style={{ marginInlineStart: '6px' }}>
                  {lang === 'ar' ? 'بدء مسودة جديدة' : 'Start New Draft'}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* STEP BAR */}
      <div className="wizard-stepbar-wrap" ref={stepbarRef} style={{ marginBottom: '24px' }}>
        {WIZARD_STEPS.map((s, idx) => {
          const isDone = idx < step || (step === 5 && !!postedResult);
          const isActive = idx === step;
          const canClick = idx <= maxReachedStep && !submitting && !postedResult
            && !['PENDING_REVIEW', 'APPROVED', 'POSTING'].includes(activeDraft?.status);
          const IconComp = s.icon;
          const cls = [
            'wizard-step',
            isDone ? 'wizard-step--done' : '',
            isActive ? 'wizard-step--active' : '',
            canClick ? 'wizard-step--clickable' : 'wizard-step--locked',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <React.Fragment key={s.id}>
              <div
                className={cls}
                onClick={() => canClick && goToStep(idx)}
                style={{ cursor: canClick ? 'pointer' : 'default' }}
              >
                <div className="wizard-step__circle">
                  {isDone ? <CheckCircle2 size={18} /> : <IconComp size={18} />}
                </div>
                <span className="wizard-step__label">{t(s.labelKey)}</span>
              </div>
              {idx < WIZARD_STEPS.length - 1 && (
                <div className={`wizard-connector${isDone ? ' wizard-connector--done' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* STEP 1: ORDER DETAILS & REMAINING QUANTITY CHECK */}
      {step === 0 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Package size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ١: مراجعة أمر البيع والكميات المتبقية' : 'Step 1: Order Details & Live Open Quantities'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'تحقق من بيانات أمر البيع وتأكد من توفر كميات مفتوحة جاهزة للتسليم في SAP Business One.'
              : 'Inspect base Sales Order headers and verify live remaining open quantities available for delivery.'}
          </p>

          {/* Header Card */}
          <div
            style={{
              padding: '18px 20px',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: '14px',
                fontSize: '0.9rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">🧾</span>
                  {lang === 'ar' ? 'أمر البيع: ' : 'Sales Order: '}
                </span>
                <strong style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>
                  #{orderDoc?.DocumentNumber || orderDoc?.document_number || docEntry}
                </strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginInlineStart: '6px' }}>
                  (DocEntry: {docEntry})
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">🏢</span>
                  {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                </span>
                <strong>{orderDoc?.CardName || orderDoc?.customer_name || orderDoc?.CardCode || orderDoc?.customer_code || '—'}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginInlineStart: '6px' }}>
                  ({orderDoc?.CardCode || orderDoc?.customer_code || '—'})
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">📅</span>
                  {lang === 'ar' ? 'تاريخ الأمر: ' : 'Order Date: '}
                </span>
                <strong>{orderDoc?.DocDate || orderDoc?.document_date || '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">📅</span>
                  {lang === 'ar' ? 'تاريخ التسليم المطلوب: ' : 'Delivery Date: '}
                </span>
                <strong>{orderDoc?.DocDueDate || orderDoc?.due_date || '—'}</strong>
              </div>

            </div>
          </div>

          {/* Lines Table */}
          <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ marginBottom: '20px' }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>{lang === 'ar' ? 'الصنف' : 'Item'}</th>
                  <th>{lang === 'ar' ? 'الكمية المطلوبة' : 'Ordered Qty'}</th>
                  <th>{lang === 'ar' ? 'الكمية المتبقية' : 'Open Qty'}</th>
                  <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.id}>
                    <td>{idx + 1}</td>
                    <td>
                      <strong style={{ color: 'var(--text-heading)' }}>
                        <span className="meta-label-icon" aria-hidden="true">{getProductIcon(l.item_description || l.item_code)}</span>{' '}
                        {l.item_description}
                      </strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l.item_code}</div>
                    </td>
                    <td>
                      {l.order_qty} {l.uom}
                    </td>
                    <td>
                      <strong style={{ color: l.open_qty > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                        {l.open_qty} {l.uom}
                      </strong>
                    </td>
                    <td>
                      {l.open_qty > 0 ? (
                        <span className="badge badge--success">
                          {lang === 'ar' ? 'متاح للتسليم' : 'Deliverable'}
                        </span>
                      ) : (
                        <span className="badge badge--neutral">
                          {lang === 'ar' ? 'مكتمل' : 'Fulfilled'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginTop: '28px',
              borderTop: '1px solid var(--border)',
              paddingTop: '20px',
            }}
          >
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={lines.every((l) => l.open_qty <= 0)}
              onClick={nextStep}
            >
              <span>{lang === 'ar' ? 'المتابعة لتحديد كميات التسليم' : 'Continue to Quantities'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: DELIVERY QUANTITIES SELECTION */}
      {step === 1 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Layers size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٢: تحديد كميات التسليم والمستودع' : 'Step 2: Delivery Quantities & Warehouse'}
            </h2>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              {lang === 'ar'
                ? 'حدد الكمية التي سيتم تسليمها فعلياً من كل بند (لا يمكن أن تتجاوز الكمية المتبقية).'
                : 'Enter delivery quantities for each line (must be <= remaining open quantity).'}
            </p>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={handleDeliverAllRemaining}
            >
              {lang === 'ar' ? '⚡ تسليم كل الكميات المتبقية' : '⚡ Deliver All Remaining'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {lines.map((l, idx) => (
              <div
                key={l.id}
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: l.delivery_qty > 0 ? 'var(--bg-primary-soft, rgba(59, 130, 246, 0.04))' : 'var(--bg-muted)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700 }}>#{idx + 1}</span>
                    <strong style={{ fontSize: '0.95rem', color: 'var(--text-heading)' }}>
                      <span className="meta-label-icon" aria-hidden="true">{getProductIcon(l.item_description || l.item_code)}</span>{' '}
                      {l.item_description}
                    </strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({l.item_code})</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {lang === 'ar' ? 'المتبقي المفتوح: ' : 'Open Qty: '}
                    </span>
                    <strong>
                      {l.open_qty} {l.uom}
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                    gap: '14px',
                    alignItems: 'flex-end',
                  }}
                >
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                      {lang === 'ar' ? 'كمية التسليم الحالية *' : 'Delivery Quantity *'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={l.open_qty}
                      step="any"
                      className="app-input"
                      value={l.delivery_qty}
                      onChange={(e) => handleDeliveryQtyChange(l.line_number, e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                      {lang === 'ar' ? 'مستودع الصرف' : 'Issuing Warehouse'}
                    </label>
                    <SearchableSelect
                      searchSource={warehouseSearch}
                      options={warehouseOptions}
                      value={l.warehouse_code}
                      onChange={(value) => handleWarehouseChange(l.line_number, value)}
                    />
                  </div>

                  <div style={{ paddingBottom: '8px' }}>
                    {l.delivery_qty > l.open_qty ? (
                      <span style={{ color: 'var(--accent-danger)', fontSize: '0.82rem' }}>
                        ⚠️ {lang === 'ar' ? 'تتجاوز الكمية المتبقية!' : 'Exceeds open quantity!'}
                      </span>
                    ) : l.delivery_qty > 0 ? (
                      <span style={{ color: 'var(--success)', fontSize: '0.82rem' }}>
                        ✓ {lang === 'ar' ? 'مدرج في إذن التسليم' : 'Included in delivery'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {lang === 'ar' ? 'مستبعد من هذا التسليم' : 'Excluded from this delivery'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Running Totals */}
          <div
            style={{
              marginTop: '20px',
              padding: '16px 20px',
              borderRadius: '8px',
              background: 'var(--bg-elevated, rgba(255, 255, 255, 0.04))',
              border: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>
                {lang === 'ar' ? 'البنود النشطة: ' : 'Active Lines: '}
              </span>
              <strong>{activeLinesCount}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>
                {lang === 'ar' ? 'إجمالي كميات التسليم: ' : 'Total Delivery Units: '}
              </span>
              <strong style={{ fontSize: '1.15rem', color: 'var(--primary)' }}>
                {totalDeliveringUnits}
              </strong>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '28px',
              borderTop: '1px solid var(--border)',
              paddingTop: '20px',
            }}
          >
            <button type="button" className="app-button app-button--secondary" onClick={prevStep}>
              <ArrowPrev size={16} />
              <span style={{ marginInlineStart: '6px' }}>{lang === 'ar' ? 'السابق' : 'Back'}</span>
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={totalDeliveringUnits <= 0}
              onClick={nextStep}
            >
              <span>{lang === 'ar' ? 'المتابعة لتخصيص التشغيلات' : 'Continue to Batches'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 3: BATCH ALLOCATION */}
      {step === 2 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Tag size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٣: تخصيص أرقام التشغيلات (Batches)' : 'Step 3: Batch Allocation'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'قم بتخصيص رقم التشغيلة والكمية لكل بند خاضع لإدارة التشغيلات في SAP.'
              : 'Allocate batch numbers and quantities for items tracked by batch in SAP.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {lines
              .filter((l) => Number(l.delivery_qty) > 0)
              .map((l, idx) => {
                const batchKey = `${l.item_code}__${l.warehouse_code || ''}`;
                const availableBatches = availableBatchesMap[batchKey] || [];
                const isBatchesLoading = Boolean(loadingBatchesMap[batchKey]);
                const currentAllocated = l.batches || [];
                const batchSum = currentAllocated.reduce(
                  (sum, b) => sum + (Number(b.quantity) || 0),
                  0
                );
                const isMatched = Math.abs(batchSum - Number(l.delivery_qty)) < 0.001;
                const pending = pendingBatchMap[l.line_number] || {
                  batch_number: '',
                  quantity: '',
                  max_qty: 0,
                  bin_code: '',
                  bin_abs_entry: null,
                  committed_batch_id: null,
                };
                const alreadyAllocatedNumbers = new Set(
                  currentAllocated
                    .filter((b) => b.id !== pending.committed_batch_id)
                    .map((b) => b.batch_number)
                );

                const batchOptions = availableBatches.map((b) => {
                  const isAlreadyAdded = alreadyAllocatedNumbers.has(b.batch_number);
                  return {
                    value: b.batch_number,
                    label: `${b.batch_number} - ${lang === 'ar' ? 'المتاح' : 'On-Hand'}: ${b.on_hand_qty} ${l.uom}${b.bin_code ? ` [${b.bin_code}]` : ''}`,
                    disabled: isAlreadyAdded,
                  };
                });

                return (
                  <div
                    key={l.id}
                    style={{
                      padding: '16px 20px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '10px',
                        marginBottom: '12px',
                        borderBottom: '1px solid var(--border)',
                        paddingBottom: '8px',
                      }}
                    >
                      <div>
                        <strong>#{idx + 1} <span className="meta-label-icon" aria-hidden="true">{getProductIcon(l.item_description || l.item_code)}</span> {l.item_description}</strong> ({l.item_code})
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '0.85rem' }}>
                          {lang === 'ar' ? 'المطلوب تسليمه: ' : 'Required: '}
                          <strong>{l.delivery_qty} {l.uom}</strong>
                        </span>
                        <button
                          type="button"
                          className="app-button app-button--secondary app-button--compact"
                          onClick={() => handleAutoFillBatch(l.line_number)}
                        >
                          {lang === 'ar' ? '⚡ تخصيص تلقائي للتشغيلات' : '⚡ Auto-Allocate'}
                        </button>
                      </div>
                    </div>

                    {/* Batches List */}
                    {l.batches && l.batches.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                        {l.batches.map((b) => (
                          <div
                            key={b.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              background: 'var(--bg-elevated, rgba(255,255,255,0.05))',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                                {b.batch_number}
                              </span>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {b.quantity} {l.uom}
                              </span>
                              {b.bin_code && (
                                <span className="badge badge--neutral">
                                  {lang === 'ar' ? 'الموقع: ' : 'Bin: '} {b.bin_code}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="app-button app-button--danger app-button--compact"
                              onClick={() => handleRemoveBatch(l.line_number, b.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        {lang === 'ar'
                          ? 'لم يتم تخصيص تشغيلات لهذا البند بعد. اختر تشغيلة من القائمة أدناه أو استخدم التخصيص التلقائي.'
                          : 'No batches allocated yet. Select an available batch from the list below or use Auto-Allocate.'}
                      </div>
                    )}

                    {/* Searchable Batch Selection from SAP */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                        gap: '12px',
                        alignItems: 'flex-end',
                        background: 'var(--bg-elevated, rgba(255, 255, 255, 0.03))',
                        padding: '14px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ flex: '1 1 240px' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                          {lang === 'ar' ? 'اختر التشغيلة من رصيد المستودع في SAP *' : 'Select Batch from SAP Inventory *'}
                        </label>
                        <SearchableSelect
                          searchSource={{ endpoint: '/customization-delivery/batches/', collection: 'batches',
                            params: { item_code: l.item_code, warehouse_code: l.warehouse_code },
                            mapOption: (row) => ({ value: row.batch_number, label: `${row.batch_number} - ${row.on_hand_qty} ${l.uom}${row.bin_code ? ` [${row.bin_code}]` : ''}`, disabled: alreadyAllocatedNumbers.has(row.batch_number), raw: row }) }}
                          onSearchResults={(rows) => setAvailableBatchesMap((previous) => ({ ...previous, [batchKey]: [...new Map([...(previous[batchKey] || []), ...rows].map((row) => [row.batch_number, row])).values()] }))}
                          options={batchOptions}
                          value={pending.batch_number}
                          loading={isBatchesLoading}
                          placeholder={
                            isBatchesLoading
                              ? (lang === 'ar' ? 'جاري فحص التشغيلات في SAP...' : 'Checking SAP inventory...')
                              : availableBatches.length === 0
                              ? (lang === 'ar' ? 'لا توجد تشغيلات برصيد متاح' : 'No available batches with balance')
                              : (lang === 'ar' ? 'ابحث عن رقم التشغيلة...' : 'Search batch number...')
                          }
                          onChange={(selectedNum) => {
                            const found = availableBatches.find((b) => b.batch_number === selectedNum);
                            if (found) {
                              // 1. Prevent duplicate batch selection if already in l.batches under a different ID
                              const existing = (l.batches || []).find(
                                (b) => b.batch_number === found.batch_number && b.id !== pending.committed_batch_id
                              );
                              if (existing) {
                                toast.info(
                                  lang === 'ar'
                                    ? `التشغيلة ${found.batch_number} مخصصة بالفعل لهذا السطر`
                                    : `Batch ${found.batch_number} is already allocated for this line`
                                );
                                setPendingBatchMap((prev) => ({
                                  ...prev,
                                  [l.line_number]: {
                                    batch_number: found.batch_number,
                                    quantity: existing.quantity,
                                    max_qty: found.on_hand_qty,
                                    bin_code: existing.bin_code || found.bin_code || '',
                                    bin_abs_entry: existing.bin_abs_entry ?? found.bin_abs_entry ?? null,
                                    committed_batch_id: existing.id,
                                  },
                                }));
                                return;
                              }

                              // 2. Validate quantity: cannot exceed batch on_hand or remaining needed or open_qty
                              const currentAllocatedExcludingThis = (l.batches || [])
                                .filter((b) => b.id !== pending.committed_batch_id)
                                .reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
                              const lineNeeded = Math.max(0, Number(l.delivery_qty || l.open_qty || 0) - currentAllocatedExcludingThis);
                              const maxBatchOnHand = Number(found.on_hand_qty) || 0;
                              const openOrderQty = Number(l.open_qty) > 0 ? Number(l.open_qty) : Number(l.delivery_qty || 0);

                              const allocatable = lineNeeded > 0 ? lineNeeded : (Number(l.delivery_qty) || openOrderQty);
                              const safeQty = Math.max(0, Math.min(allocatable, maxBatchOnHand, openOrderQty));

                              const targetBatchId = pending.committed_batch_id || (Date.now() + Math.random());
                              const newBatch = {
                                id: targetBatchId,
                                batch_number: found.batch_number,
                                quantity: safeQty,
                                bin_code: found.bin_code || '',
                                bin_abs_entry: found.bin_abs_entry || null,
                              };

                              // 3. Immediately commit to line's actual batches array!
                              setLines((prev) =>
                                prev.map((line) => {
                                  if (line.line_number !== l.line_number) return line;
                                  const currentList = line.batches || [];
                                  const existingIdx = currentList.findIndex((b) => b.id === targetBatchId);
                                  if (existingIdx >= 0) {
                                    return {
                                      ...line,
                                      batches: currentList.map((b, idx) => (idx === existingIdx ? newBatch : b)),
                                    };
                                  }
                                  return {
                                    ...line,
                                    batches: [...currentList, newBatch],
                                  };
                                })
                              );

                              // 4. Update pending state for interactive editing / confirmation
                              setPendingBatchMap((prev) => ({
                                ...prev,
                                [l.line_number]: {
                                  batch_number: found.batch_number,
                                  quantity: safeQty,
                                  max_qty: maxBatchOnHand,
                                  bin_code: found.bin_code || '',
                                  bin_abs_entry: found.bin_abs_entry || null,
                                  committed_batch_id: targetBatchId,
                                },
                              }));
                            } else {
                              if (pending.committed_batch_id) {
                                setLines((prev) =>
                                  prev.map((line) => {
                                    if (line.line_number !== l.line_number) return line;
                                    return {
                                      ...line,
                                      batches: (line.batches || []).filter((b) => b.id !== pending.committed_batch_id),
                                    };
                                  })
                                );
                              }
                              setPendingBatchMap((prev) => ({
                                ...prev,
                                [l.line_number]: {
                                  batch_number: '',
                                  quantity: '',
                                  max_qty: 0,
                                  bin_code: '',
                                  bin_abs_entry: null,
                                  committed_batch_id: null,
                                },
                              }));
                            }
                          }}
                        />
                      </div>

                      <div style={{ width: '140px' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                          {lang === 'ar' ? 'الكمية *' : 'Quantity *'}
                        </label>
                        <input
                          type="number"
                          min="0.0001"
                          max={pending.max_qty || undefined}
                          step="any"
                          placeholder={lang === 'ar' ? 'الكمية...' : 'Quantity...'}
                          className="app-input"
                          value={pending.quantity}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const num = parseFloat(raw) || 0;
                            const maxLimit = Math.min(
                              pending.max_qty || Infinity,
                              Number(l.open_qty) > 0 ? Number(l.open_qty) : Infinity,
                              Number(l.delivery_qty) > 0 ? Number(l.delivery_qty) : Infinity
                            );
                            const capped = num > maxLimit ? maxLimit : raw;
                            const validNum = parseFloat(capped) || 0;

                            setPendingBatchMap((prev) => ({
                              ...prev,
                              [l.line_number]: {
                                ...prev[l.line_number],
                                quantity: capped,
                              },
                            }));

                            if (pending.committed_batch_id) {
                              setLines((prev) =>
                                prev.map((line) => {
                                  if (line.line_number !== l.line_number) return line;
                                  return {
                                    ...line,
                                    batches: (line.batches || []).map((b) =>
                                      b.id === pending.committed_batch_id ? { ...b, quantity: validNum } : b
                                    ),
                                  };
                                })
                              );
                            }
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="app-button app-button--primary app-button--compact"
                          disabled={
                            !pending.batch_number ||
                            !pending.quantity ||
                            Number(pending.quantity) <= 0 ||
                            (pending.max_qty && Number(pending.quantity) > pending.max_qty + 0.0001)
                          }
                          onClick={() => {
                            const cleanBatchNum = String(pending.batch_number).trim();
                            const inputQty = Number(pending.quantity) || 0;
                            if (!cleanBatchNum || inputQty <= 0) return;

                            handleAddBatch(
                              l.line_number,
                              cleanBatchNum,
                              inputQty,
                              pending.bin_code,
                              pending.bin_abs_entry,
                              pending.committed_batch_id
                            );

                            setPendingBatchMap((prev) => ({
                              ...prev,
                              [l.line_number]: {
                                batch_number: '',
                                quantity: '',
                                max_qty: 0,
                                bin_code: '',
                                bin_abs_entry: null,
                                committed_batch_id: null,
                              },
                            }));
                            toast.success(lang === 'ar' ? 'تم تأكيد تخصيص التشغيلة' : 'Batch allocation confirmed');
                          }}
                        >
                          <Plus size={14} />
                          <span style={{ marginInlineStart: '4px' }}>
                            {lang === 'ar' ? 'تأكيد التخصيص' : 'Confirm Allocation'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {pending.max_qty > 0 && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                        ℹ {lang === 'ar' ? 'الرصيد المتاح للتشغيلة: ' : 'Batch on-hand balance: '}
                        <strong style={{ color: 'var(--text-heading)' }}>{pending.max_qty} {l.uom}</strong>
                        {pending.bin_code && (
                          <span>
                            {' '}— {lang === 'ar' ? 'الموقع الافتراضي: ' : 'Default Bin: '}
                            <span className="badge badge--neutral">{pending.bin_code}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {!isBatchesLoading && availableBatches.length === 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-warning, #f59e0b)', fontSize: '0.82rem', marginTop: '8px' }}>
                        <AlertCircle size={14} />
                        <span>
                          {lang === 'ar'
                            ? `لا توجد تشغيلات برصيد متاح في المستودع ${l.warehouse_code} لهذا الصنف في SAP.`
                            : `No available batches with positive balance in warehouse ${l.warehouse_code} in SAP.`}
                        </span>
                      </div>
                    )}

                    {/* Balance Status */}
                    {l.batches && l.batches.length > 0 && (
                      <div style={{ marginTop: '10px', fontSize: '0.82rem' }}>
                        {isMatched ? (
                          <span style={{ color: 'var(--success)' }}>
                            ✓ {lang === 'ar' ? 'مجموع كميات التشغيلات مطابق تماماً للكمية المطلوبة' : 'Batch sum perfectly matches delivery quantity'}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--accent-danger)' }}>
                            ⚠️ {lang === 'ar' ? `المجموع (${batchSum}) لا يطابق المطلوب (${l.delivery_qty})` : `Batch sum (${batchSum}) differs from required (${l.delivery_qty})`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '28px',
              borderTop: '1px solid var(--border)',
              paddingTop: '20px',
            }}
          >
            <button type="button" className="app-button app-button--secondary" onClick={prevStep}>
              <ArrowPrev size={16} />
              <span style={{ marginInlineStart: '6px' }}>{lang === 'ar' ? 'السابق' : 'Back'}</span>
            </button>
            <button type="button" className="app-button app-button--primary" onClick={nextStep}>
              <span>{lang === 'ar' ? 'المتابعة لتخصيص مواقع التخزين' : 'Continue to Bin Locations'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 4: BIN LOCATIONS ALLOCATION */}
      {step === 3 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Building2 size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٤: مواقع التخزين (Bin Locations)' : 'Step 4: Bin Locations Allocation'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'إذا كان المستودع مفعلاً به إدارة المواقع في SAP، حدد موقع التخزين لصرف الأصناف.'
              : 'Select issuing bin locations if the warehouse is bin-managed in SAP Business One.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {lines
              .filter((l) => Number(l.delivery_qty) > 0)
              .map((l, idx) => {
                const whBins = binLocationsMap[l.warehouse_code] || [];
                const isBinManaged = whBins.length > 0;
                const currentBinVal = String(l.batches?.[0]?.bin_abs_entry || l.batches?.[0]?.bin_code || '');

                return (
                  <div
                    key={l.id}
                    style={{
                      padding: '16px 20px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <strong>#{idx + 1} <span className="meta-label-icon" aria-hidden="true">{getProductIcon(l.item_description || l.item_code)}</span> {l.item_description} ({l.item_code})</strong>
                      <span className="badge badge--neutral">
                        <span className="meta-label-icon" aria-hidden="true">🏭</span>{' '}
                        {lang === 'ar' ? 'المستودع: ' : 'Warehouse: '} {l.warehouse_code}
                      </span>
                    </div>

                    {isBinManaged ? (
                      <div>
                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                          {lang === 'ar' ? 'اختر موقع التخزين في المستودع' : 'Select Bin Location'}
                        </label>
                        <SearchableSelect
                          searchSource={binSearch(l.warehouse_code, { valueKey: 'absEntry' })}
                          onSearchResults={(rows) => setBinLocationsMap((previous) => ({ ...previous, [l.warehouse_code]: [...new Map([...(previous[l.warehouse_code] || []), ...rows].map((row) => [row.absEntry, row])).values()] }))}
                          options={whBins.map((b) => ({
                            value: String(b.AbsEntry || b.absEntry || b.abs_entry || b.BinCode || b.code),
                            label: `${b.BinCode || b.bin_code || b.code} (Entry: ${b.AbsEntry || b.absEntry || b.abs_entry})`,
                          }))}
                          placeholder={lang === 'ar' ? 'اختر موقع التخزين...' : 'Select bin location...'}
                          value={currentBinVal}
                          onChange={(val) => {
                            const matched = whBins.find((b) => (
                              String(b.AbsEntry || b.absEntry || b.abs_entry || b.BinCode || b.code) === val
                              || b.BinCode === val
                              || b.code === val
                            ));
                            if (matched && l.batches && l.batches.length > 0) {
                              setLines((prev) =>
                                prev.map((line) => {
                                  if (line.line_number !== l.line_number) return line;
                                  return {
                                    ...line,
                                    batches: line.batches.map((b) => ({
                                      ...b,
                                      bin_code: matched.BinCode || matched.bin_code || matched.code || val,
                                      bin_abs_entry: matched.AbsEntry || matched.absEntry || matched.abs_entry || null,
                                    })),
                                  };
                                })
                              );
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ padding: '10px 14px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        ✓ {lang === 'ar' ? 'المستودع عادي (صرف مباشر دون إدارة مواقع تخزين دقيقة)' : 'Standard warehouse: No bin tracking required for this location.'}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>


          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '28px',
              borderTop: '1px solid var(--border)',
              paddingTop: '20px',
            }}
          >
            <button type="button" className="app-button app-button--secondary" onClick={prevStep}>
              <ArrowPrev size={16} />
              <span style={{ marginInlineStart: '6px' }}>{lang === 'ar' ? 'السابق' : 'Back'}</span>
            </button>
            <button type="button" className="app-button app-button--primary" onClick={nextStep}>
              <span>{lang === 'ar' ? 'المتابعة لمراكز التكلفة' : 'Continue to Cost Centers'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 5: COST CENTER DIMENSIONS */}
      {step === 4 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Briefcase size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٥: أبعاد مراكز التكلفة وملاحظات التسليم' : 'Step 5: Cost Centers & Remarks'}
            </h2>
            {loadingCostCenters && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <CircularProgress size={14} />
                <span>{lang === 'ar' ? 'جاري تحميل المراكز...' : 'Loading centers...'}</span>
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'حدد مراكز التكلفة المحاسبية (البُعد ١ والموقع، البُعد ٢ والإدارة) وملاحظات إذن التسليم.'
              : 'Specify accounting cost centers (Dimension 1 - Location, Dimension 2 - Department) and delivery remarks.'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
              gap: '20px',
            }}
          >
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                {lang === 'ar' ? 'مركز التكلفة (البُعد ١ - الموقع)' : 'Cost Center (Dimension 1 - Location)'}
              </label>
              <SearchableSelect
                options={costCenterOptions1}
                placeholder={
                  loadingCostCenters
                    ? (lang === 'ar' ? 'جاري تحميل مراكز التكلفة...' : 'Loading cost centers...')
                    : (lang === 'ar' ? 'اختر مركز التكلفة...' : 'Select Dimension 1...')
                }
                value={selectedCostCenter1}
                onChange={(value) => setSelectedCostCenter1(value)}
              />
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                {lang === 'ar' ? 'مركز التكلفة (البُعد ٢ - الإدارة/النشاط)' : 'Cost Center (Dimension 2 - Department)'}
              </label>
              <SearchableSelect
                options={costCenterOptions2}
                placeholder={
                  loadingCostCenters
                    ? (lang === 'ar' ? 'جاري تحميل مراكز التكلفة...' : 'Loading cost centers...')
                    : (lang === 'ar' ? 'اختر مركز التكلفة...' : 'Select Dimension 2...')
                }
                value={selectedCostCenter2}
                onChange={(value) => setSelectedCostCenter2(value)}
              />
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                {lang === 'ar' ? 'تاريخ الترحيل' : 'Posting Date'}
              </label>
              <input
                type="date"
                className="app-input"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                {lang === 'ar' ? 'تاريخ الاستحقاق' : 'Due Date'}
              </label>
              <input
                type="date"
                className="app-input"
                value={docDueDate}
                onChange={(e) => setDocDueDate(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                {lang === 'ar' ? 'ملاحظات إذن التسليم' : 'Delivery Remarks / Journal Notes'}
              </label>
              <textarea
                className="app-input"
                rows={3}
                placeholder={
                  lang === 'ar'
                    ? 'أدخل أي ملاحظات على إذن التسليم أو شاحنة النقل أو السائق...'
                    : 'Enter delivery remarks, driver details, truck number...'
                }
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '28px',
              borderTop: '1px solid var(--border)',
              paddingTop: '20px',
            }}
          >
            <button type="button" className="app-button app-button--secondary" onClick={prevStep}>
              <ArrowPrev size={16} />
              <span style={{ marginInlineStart: '6px' }}>{lang === 'ar' ? 'السابق' : 'Back'}</span>
            </button>
            <button type="button" className="app-button app-button--primary" onClick={nextStep}>
              <span>{lang === 'ar' ? 'المتابعة للمراجعة والترحيل' : 'Continue to Review'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 6: REVIEW & NATIVE SAP POSTING */}
      {step === 5 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          {submitting ? (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <CircularProgress size={48} thickness={4} />
              <h3 style={{ marginTop: '20px', color: 'var(--text-heading)' }}>
                {lang === 'ar'
                  ? 'جاري إنشاء إذن التسليم الأصلي في SAP Business One...'
                  : 'Posting Native Delivery Note to SAP Business One Service Layer...'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {lang === 'ar'
                  ? 'يتم التحقق من الكميات المفتوحة وبناء العلاقة الأصلية (BaseType: 17).'
                  : 'Validating open quantities and establishing native relationship (BaseType: 17).'}
              </p>
            </div>
          ) : postedResult ? (
            <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
              <div
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: 'rgba(34, 197, 94, 0.12)',
                  color: 'var(--accent-success, #22c55e)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <CheckCircle2 size={40} />
              </div>
              <h2 style={{ color: 'var(--text-heading)', margin: '0 0 10px' }}>
                {lang === 'ar'
                  ? 'تم إنشاء إذن التسليم بنجاح في SAP Business One!'
                  : 'Delivery Note Created Successfully in SAP!'}
              </h2>

              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  background: 'var(--bg-muted, rgba(255, 255, 255, 0.03))',
                  border: '1px solid var(--border)',
                  margin: '20px 0',
                  textAlign: 'start',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
                    gap: '12px',
                    fontSize: '0.95rem',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🚚</span>
                      {lang === 'ar' ? 'رقم إذن التسليم: ' : 'Delivery #: '}
                    </span>
                    <strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>
                      #{postedResult.sap_doc_num}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🔢</span>
                      SAP DocEntry:{' '}
                    </span>
                    <strong>{postedResult.sap_doc_entry}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🧾</span>
                      {lang === 'ar' ? 'مبني على أمر البيع: ' : 'Based on Order: '}
                    </span>
                    <strong>#{orderDoc.DocumentNumber || docEntry}</strong>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  fontSize: '0.85rem',
                  color: 'var(--text)',
                  marginBottom: '24px',
                  textAlign: 'start',
                }}
              >
                ℹ {lang === 'ar'
                  ? `تم توثيق العلاقة الأصلية في SAP Business One: أمر البيع #${orderDoc.DocumentNumber || docEntry} ──[BaseType: 17]──> إذن التسليم #${postedResult.sap_doc_num}. يظهر المستند مباشرة في خريطة العلاقات (Relationship Map) في SAP.`
                  : `Native SAP link confirmed: Sales Order #${orderDoc.DocumentNumber || docEntry} ──[BaseType: 17]──> Delivery Note #${postedResult.sap_doc_num}. Visible in SAP Relationship Map.`}
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={handlePrintDelivery}
                  style={{
                    padding: '12px 24px',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Printer size={18} />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar' ? 'طباعة إذن التسليم' : 'Print Delivery Note'}
                  </span>
                </button>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() => navigate('/customization-delivery/deliveries')}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                >
                  <Truck size={18} />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar' ? 'العودة لقائمة التسليمات' : 'Back to Deliveries List'}
                  </span>
                </button>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() => navigate(`/customization-delivery/delivery/documents/${docEntry}`)}
                >
                  <FileText size={16} />
                  <span style={{ marginInlineStart: '6px' }}>
                    {lang === 'ar' ? 'عرض تفاصيل المستند وسجل التسليم' : 'View Delivery History'}
                  </span>
                </button>
              </div>
            </div>
          ) : submittedReviewResult ? (
            <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
              <div
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  background: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <ClipboardCheck size={40} />
              </div>
              <h2 style={{ color: 'var(--text-heading)', margin: '0 0 10px' }}>
                {lang === 'ar'
                  ? 'تم تقديم مسودة التسليم للمراجعة بنجاح!'
                  : 'Delivery Draft Submitted for Review!'}
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '24px' }}>
                {lang === 'ar'
                  ? `تم حفظ وتحديث مسودة التسليم رقم #${submittedReviewResult.id} وتعيين حالتها بانتظار اعتماد المدير لترحيلها إلى SAP.`
                  : `Delivery draft #${submittedReviewResult.id} has been submitted for manager review. It will be posted to SAP once approved.`}
              </p>

              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  background: 'var(--bg-muted, rgba(255, 255, 255, 0.03))',
                  border: '1px solid var(--border)',
                  margin: '20px 0',
                  textAlign: 'start',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
                    gap: '12px',
                    fontSize: '0.95rem',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🔢</span>
                      {lang === 'ar' ? 'رقم المسودة: ' : 'Draft #: '}
                    </span>
                    <strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>
                      #{submittedReviewResult.id}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">✅</span>
                      {lang === 'ar' ? 'الحالة: ' : 'Status: '}
                    </span>
                    <span className="badge badge--warning">
                      {lang === 'ar' ? 'بانتظار الاعتماد' : 'Pending Review'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🧾</span>
                      {lang === 'ar' ? 'أمر البيع: ' : 'Order: '}
                    </span>
                    <strong>#{orderDoc.DocumentNumber || docEntry}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={() => navigate('/customization-delivery/deliveries')}
                >
                  <Truck size={18} />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar' ? 'العودة لقائمة التسليمات' : 'Back to Deliveries List'}
                  </span>
                </button>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() => navigate(`/customization-delivery/delivery/documents/${docEntry}`)}
                >
                  <FileText size={16} />
                  <span style={{ marginInlineStart: '6px' }}>
                    {lang === 'ar' ? 'عرض تفاصيل المستند' : 'View Document Details'}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <ClipboardCheck size={22} color="var(--primary)" />
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
                  {lang === 'ar' ? 'الخطوة ٦: المراجعة النهائية والترحيل إلى SAP' : 'Step 6: Review & Native SAP Posting'}
                </h2>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
                {lang === 'ar'
                  ? 'راجع تفاصيل التسليم بالكامل قبل الإرسال لإنشاء إذن التسليم الأصلي في SAP Business One.'
                  : 'Review all delivery details before posting to create native ODLN / DLN1 document in SAP.'}
              </p>

              {submitError && (
                <div
                  className="feedback-message feedback-message--error"
                  style={{ marginBottom: '20px' }}
                >
                  {submitError}
                </div>
              )}

              {/* Order & Customer Summary */}
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))',
                  marginBottom: '20px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                  gap: '12px',
                  fontSize: '0.9rem',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                    <span className="meta-label-icon" aria-hidden="true">🧾</span>
                    {lang === 'ar' ? 'أمر البيع المصدر: ' : 'Source Order: '}
                  </span>
                  <strong>#{orderDoc.DocumentNumber || docEntry}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                    <span className="meta-label-icon" aria-hidden="true">🏢</span>
                    {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                  </span>
                  <strong>{orderDoc.CardName || orderDoc.CardCode}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                    <span className="meta-label-icon" aria-hidden="true">📅</span>
                    {lang === 'ar' ? 'تاريخ الترحيل: ' : 'Posting Date: '}
                  </span>
                  <strong>{docDate}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                    <span className="meta-label-icon" aria-hidden="true">🔗</span>
                    {lang === 'ar' ? 'العلاقة في SAP: ' : 'SAP Relationship: '}
                  </span>
                  <span className="badge badge--info">BaseType = 17</span>
                </div>
              </div>

              {/* Deliverable Lines Table */}
              <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ marginBottom: '20px' }}>
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>{lang === 'ar' ? 'الصنف' : 'Item'}</th>
                      <th>{lang === 'ar' ? 'كمية التسليم' : 'Delivery Qty'}</th>
                      <th>{lang === 'ar' ? 'المستودع' : 'Warehouse'}</th>
                      <th>{lang === 'ar' ? 'التشغيلات' : 'Batches'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines
                      .filter((l) => Number(l.delivery_qty) > 0)
                      .map((l, idx) => (
                        <tr key={l.id}>
                          <td>{idx + 1}</td>
                          <td>
                            <strong>
                              <span className="meta-label-icon" aria-hidden="true">{getProductIcon(l.item_description || l.item_code)}</span>{' '}
                              {l.item_description}
                            </strong>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l.item_code}</div>
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                            {l.delivery_qty} {l.uom}
                          </td>
                          <td>{l.warehouse_code}</td>
                          <td>
                            {l.batches?.length > 0 ? (
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {l.batches.map((b, bIdx) => (
                                  <span
                                    key={bIdx}
                                    style={{
                                      background: 'rgba(255,255,255,0.05)',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      border: '1px solid var(--border)',
                                      fontSize: '0.78rem',
                                    }}
                                  >
                                    <strong>{b.batch_number}</strong>: {b.quantity}
                                    {b.bin_code ? ` (${b.bin_code})` : ''}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '8px',
                  background: 'var(--bg-elevated, rgba(255, 255, 255, 0.04))',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '14px',
                  marginBottom: '24px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ar' ? 'عدد البنود المسلمة: ' : 'Delivering Lines: '}
                  </span>
                  <strong>{activeLinesCount}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ar' ? 'إجمالي الكميات المسلمة: ' : 'Total Units Delivering: '}
                  </span>
                  <strong style={{ fontSize: '1.25rem', color: 'var(--success)' }}>
                    {totalDeliveringUnits}
                  </strong>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid var(--border)',
                  paddingTop: '20px',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <button type="button" className="app-button app-button--secondary" onClick={prevStep}
                  disabled={['PENDING_REVIEW', 'APPROVED', 'POSTING'].includes(activeDraft?.status)}>
                  <ArrowPrev size={16} />
                  <span style={{ marginInlineStart: '6px' }}>{lang === 'ar' ? 'السابق' : 'Back'}</span>
                </button>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {activeDraft?.status === 'FAILED' ? (
                    <button
                      type="button"
                      className="app-button app-button--primary"
                      onClick={handleStartNewDraft}
                      disabled={creatingNewDraft}
                      style={{
                        minWidth: '220px',
                        padding: '12px 24px',
                        fontSize: '0.95rem',
                      }}
                    >
                      {creatingNewDraft ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <>
                          <RotateCcw size={18} />
                          <span style={{ marginInlineStart: '8px' }}>
                            {lang === 'ar' ? 'بدء مسودة جديدة' : 'Start New Draft'}
                          </span>
                        </>
                      )}
                    </button>
                  ) : (
                    <>
                      {/* Operator & Manager: Save & Submit for Review */}
                      <button
                        type="button"
                        className={isManager ? 'app-button app-button--secondary' : 'app-button app-button--primary'}
                        onClick={handleSaveAndSubmit}
                        disabled={submitting || activeDraft?.status === 'POSTING'}
                        aria-busy={submitting ? 'true' : 'false'}
                        style={{
                          minWidth: isManager ? '180px' : '220px',
                          padding: '12px 20px',
                          fontSize: '0.95rem',
                          cursor: submitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {submitting ? (
                          <>
                            <AppSpinner size="sm" />
                            <span style={{ marginInlineStart: '8px' }}>
                              {lang === 'ar' ? 'جاري تقديم المسودة للاعتماد...' : 'Submitting Draft for Review...'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            <span style={{ marginInlineStart: '8px' }}>
                              {lang === 'ar' ? 'حفظ وتقديم للمراجعة' : 'Submit Draft for Review'}
                            </span>
                          </>
                        )}
                      </button>

                      {/* Manager only: Direct Approve & Post to SAP */}
                      {isManager && (
                        <button
                          type="button"
                          className="app-button app-button--primary"
                          onClick={handlePostDelivery}
                          disabled={submitting || activeDraft?.status === 'POSTING'}
                          aria-busy={submitting ? 'true' : 'false'}
                          style={{
                            minWidth: '220px',
                            padding: '12px 24px',
                            fontSize: '0.95rem',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {submitting ? (
                            <>
                              <AppSpinner size="sm" />
                              <span style={{ marginInlineStart: '8px' }}>
                                {lang === 'ar' ? 'جاري الاعتماد والترحيل إلى SAP...' : 'Posting Delivery Note to SAP...'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Truck size={18} />
                              <span style={{ marginInlineStart: '8px' }}>
                                {lang === 'ar' ? 'اعتماد وترحيل إلى SAP' : 'Approve & Post to SAP'}
                              </span>
                            </>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {printRequest && postedResult && (
        <div ref={printContainerRef} aria-hidden="true" style={{ display: 'none' }}>
          <SalesDocumentPrintable
            document={{
              documentType: 'DELIVERY',
              docNum: printRequest.document.document_number,
              docEntry: printRequest.document.document_entry,
              customerName: printRequest.document.customer_name,
              customerCode: printRequest.document.customer_code,
              docDate: printRequest.document.document_date,
              dueDate: printRequest.document.due_date,
              currency: printRequest.document.currency,
              remarks: printRequest.document.remarks,
              baseDocumentNum: orderDoc?.document_number,
              lines: printRequest.document.lines,
              totalQuantity: printRequest.document.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
              totalAmount: printRequest.document.total_amount,
            }}
            generatedAt={printRequest.generatedAt}
            t={t}
          />
        </div>
      )}
    </div>
  );
}
