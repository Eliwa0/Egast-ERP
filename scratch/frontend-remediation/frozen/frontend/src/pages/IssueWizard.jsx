import SearchableSelect from '../components/ui/SearchableSelect';
import { binSearch } from '../services/masterDataSearch';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PackageMinus,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Search,
  Plus,
  Trash2,
  Info,
  Calendar,
  Layers,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import {
  fetchOpenProductionOrders,
  fetchProductionOrderDetails,
  fetchBatchDetails,
  fetchAvailableBatchesForIssue,
  fetchWarehouseBins,
  submitPendingIssue,
} from '../services/productionIssueService';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { getProductIcon } from '../utils/productIcon';
import '../styles/pages/IssueWizard.css';

const STEP_COUNT = 5;

export default function IssueWizard() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const stepbarRef = useRef(null);

  // Wizard navigation state
  const [currentStep, setCurrentStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);

  // Step 1: Orders state
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);

  // Step 2: Components selection state
  // Map of line_number -> { ...componentLine, selected: boolean, issueQuantity: number }
  const [selectedComponents, setSelectedComponents] = useState({});

  // Step 3: Allocations state
  // Map of line_number -> Array of { batchNumber, binAbsEntry, quantity, availableQty }
  const [allocations, setAllocations] = useState({});
  // Map of line_number -> boolean (if true, user flagged as standard item without batch/bin)
  const [noBatchRequired, setNoBatchRequired] = useState({});
  // Cache of line_number -> array of in-stock batches from SAP
  const [availableBatchesCache, setAvailableBatchesCache] = useState({});
  const [loadingAvailableBatches, setLoadingAvailableBatches] = useState({});
  // Cache of warehouseCode -> bin list
  const [warehouseBinsCache, setWarehouseBinsCache] = useState({});
  const [loadingBins, setLoadingBins] = useState(false);
  // Batch lookup loading states
  const [batchLookupLoading, setBatchLookupLoading] = useState({});

  // Step 4: Document Info state
  const [documentInfo, setDocumentInfo] = useState({
    postingDate: new Date().toISOString().split('T')[0],
    documentDate: new Date().toISOString().split('T')[0],
    comments: '',
    journalMemo: '',
  });

  // Step 5 & Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submissionResult, setSubmissionResult] = useState(null);

  // ── Step Definitions ──────────────────────────────────────────────────────
  const steps = useMemo(
    () => [
      {
        id: 0,
        title: t('issueWizard.step1'),
        desc: t('issueWizard.step1Desc'),
        icon: '📦',
      },
      {
        id: 1,
        title: t('issueWizard.step2'),
        desc: t('issueWizard.step2Desc'),
        icon: '⚖️',
      },
      {
        id: 2,
        title: t('issueWizard.step3'),
        desc: t('issueWizard.step3Desc'),
        icon: '🏷️',
      },
      {
        id: 3,
        title: t('issueWizard.step4'),
        desc: t('issueWizard.step4Desc'),
        icon: '📋',
      },
      {
        id: 4,
        title: t('issueWizard.step5'),
        desc: t('issueWizard.step5Desc'),
        icon: '🎉',
      },
    ],
    [t]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const activeStep = stepbarRef.current?.querySelector('.wizard-step--active');
    activeStep?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentStep]);

  // ── Load Open Released Production Orders on Mount ──────────────────────────
  useEffect(() => {
    let mounted = true;
    async function loadOrders() {
      setOrdersLoading(true);
      setOrdersError('');
      try {
        const orderList = await fetchOpenProductionOrders();
        if (mounted) {
          setOrders(orderList);
        }
      } catch (err) {
        if (mounted) {
          console.error('[ISSUE-WIZARD] Error loading orders:', err);
          setOrdersError(err.response?.data?.error || err.message || 'Failed to load open production orders.');
        }
      } finally {
        if (mounted) setOrdersLoading(false);
      }
    }
    loadOrders();
    return () => {
      mounted = false;
    };
  }, []);

  // ── Filtered Orders ────────────────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        String(o.orderNumber).toLowerCase().includes(q) ||
        String(o.itemCode).toLowerCase().includes(q) ||
        String(o.itemName).toLowerCase().includes(q) ||
        String(o.warehouse).toLowerCase().includes(q)
    );
  }, [orders, searchFilter]);

  // ── Handle Order Selection ─────────────────────────────────────────────────
  const handleSelectOrder = async (order) => {
    if (!order?.docEntry) return;
    if (selectedOrder?.docEntry === order.docEntry) return;

    const timingEnabled = import.meta.env.DEV && typeof performance !== 'undefined';
    const selectionStartedAt = timingEnabled ? performance.now() : 0;
    const logTiming = (stage) => {
      if (!timingEnabled) return;
      console.debug(`[ISSUE-WIZARD TIMING] ${stage}: ${(performance.now() - selectionStartedAt).toFixed(1)}ms`);
    };

    logTiming('order click');

    setSelectedOrder(order);
    setLoadingOrderDetails(true);
    setSubmitError('');

    // Reset dependent steps
    setSelectedComponents({});
    setAllocations({});
    setNoBatchRequired({});

    // Reset document info defaults for new order
    setDocumentInfo({
      postingDate: new Date().toISOString().split('T')[0],
      documentDate: new Date().toISOString().split('T')[0],
      comments: `Issue for Production Order #${order.orderNumber}`,
      journalMemo: `Issue for Production - ${order.orderNumber}`,
    });

    try {
      logTiming('fetchProductionOrderDetails request');
      const details = await fetchProductionOrderDetails(order.docEntry);
      logTiming('fetchProductionOrderDetails response');
      if (!Array.isArray(details?.lines) || details.lines.length === 0) {
        setOrdersError('Failed to load order component lines.');
        logTiming('details validation failed');
        return;
      }
      const initialComponents = {};

      (details.lines || []).forEach((line) => {
        const remaining = line.remainingQuantity;
        // Pre-select lines with remaining quantity > 0
        const isEligible = remaining > 0;
        initialComponents[line.lineNumber] = {
          ...line,
          selected: isEligible,
          issueQuantity: isEligible ? remaining : 0,
        };
      });

      logTiming('details transformed');
      setSelectedComponents(initialComponents);
      setCurrentStep(1);
      setMaxReachedStep((prev) => Math.max(prev, 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      logTiming('Step 2 state queued');
      if (timingEnabled) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => logTiming('Step 2 visible'));
        });
      }

    } catch (err) {
      logTiming('fetchProductionOrderDetails failed');
      console.error('[ISSUE-WIZARD] Failed to load order lines:', err);
      setOrdersError(err.response?.data?.error || err.message || 'Failed to load order component lines.');
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  // ── Step Navigation ────────────────────────────────────────────────────────
  const goToStep = (stepIdx) => {
    if (stepIdx < 0 || stepIdx >= STEP_COUNT) return;
    if (stepIdx > maxReachedStep) return;
    setCurrentStep(stepIdx);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNext = () => {
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    setMaxReachedStep((prev) => Math.max(prev, nextStep));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // ── Step 2 Component Selection Helpers ─────────────────────────────────────
  const activeComponentsList = useMemo(() => {
    return Object.values(selectedComponents).sort((a, b) => a.lineNumber - b.lineNumber);
  }, [selectedComponents]);

  const selectedComponentsCount = useMemo(() => {
    return Object.values(selectedComponents).filter((c) => c.selected).length;
  }, [selectedComponents]);

  const toggleComponentSelect = (lineNum) => {
    setSelectedComponents((prev) => {
      const current = prev[lineNum];
      if (!current) return prev;
      const nextSelected = !current.selected;
      const nextQty = nextSelected && current.issueQuantity <= 0 ? current.remainingQuantity : current.issueQuantity;
      return {
        ...prev,
        [lineNum]: {
          ...current,
          selected: nextSelected,
          issueQuantity: nextQty,
        },
      };
    });
  };

  const updateComponentQty = (lineNum, val) => {
    const numVal = val === '' ? '' : Number(val);
    setSelectedComponents((prev) => {
      const current = prev[lineNum];
      if (!current) return prev;
      return {
        ...prev,
        [lineNum]: {
          ...current,
          issueQuantity: numVal,
        },
      };
    });

    // Invalidate existing allocations if quantity changed
    setAllocations((prev) => {
      if (!prev[lineNum]) return prev;
      return {
        ...prev,
        [lineNum]: prev[lineNum].map((alloc) => ({ ...alloc, mismatchFlag: true })),
      };
    });
  };

  const handleSelectAllComponents = () => {
    setSelectedComponents((prev) => {
      const updated = {};
      Object.keys(prev).forEach((k) => {
        const c = prev[k];
        updated[k] = {
          ...c,
          selected: c.remainingQuantity > 0,
          issueQuantity: c.issueQuantity > 0 ? c.issueQuantity : c.remainingQuantity,
        };
      });
      return updated;
    });
  };

  const handleDeselectAllComponents = () => {
    setSelectedComponents((prev) => {
      const updated = {};
      Object.keys(prev).forEach((k) => {
        updated[k] = { ...prev[k], selected: false };
      });
      return updated;
    });
  };

  // Step 2 Validation: at least one selected, all selected have 0 < qty <= remaining
  const isStep2Valid = useMemo(() => {
    const selected = Object.values(selectedComponents).filter((c) => c.selected);
    if (selected.length === 0) return false;
    return selected.every(
      (c) =>
        typeof c.issueQuantity === 'number' &&
        c.issueQuantity > 0 &&
        c.issueQuantity <= c.remainingQuantity + 0.0001
    );
  }, [selectedComponents]);

  // ── Step 3 Allocations Helpers ─────────────────────────────────────────────
  const addAllocationRow = (lineNum) => {
    const comp = selectedComponents[lineNum];
    if (!comp) return;

    const existing = allocations[lineNum] || [];
    const allocatedSum = existing.reduce((sum, a) => sum + Number(a.quantity || 0), 0);
    const remainingToAlloc = Math.max(0, Number(comp.issueQuantity || 0) - allocatedSum);

    const newRow = {
      id: Date.now() + Math.random(),
      batchNumber: '',
      binAbsEntry: '',
      quantity: remainingToAlloc > 0 ? remainingToAlloc : '',
      availableQty: null,
    };

    setAllocations((prev) => ({
      ...prev,
      [lineNum]: [...existing, newRow],
    }));
  };

  const removeAllocationRow = (lineNum, rowIdx) => {
    setAllocations((prev) => {
      const existing = prev[lineNum] || [];
      const updated = existing.filter((_, idx) => idx !== rowIdx);
      return { ...prev, [lineNum]: updated };
    });
  };

  const updateAllocationField = (lineNum, rowIdx, field, value) => {
    setAllocations((prev) => {
      const existing = prev[lineNum] || [];
      const updated = existing.map((row, idx) => {
        if (idx !== rowIdx) return row;
        return { ...row, [field]: value };
      });
      return { ...prev, [lineNum]: updated };
    });
  };

  const handleBatchLookup = async (lineNum, rowIdx, batchNumber) => {
    if (!batchNumber || !batchNumber.trim()) return;
    const key = `${lineNum}-${rowIdx}`;
    setBatchLookupLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const details = await fetchBatchDetails(batchNumber.trim());
      if (details) {
        setAllocations((prev) => {
          const existing = prev[lineNum] || [];
          const updated = existing.map((row, idx) => {
            if (idx !== rowIdx) return row;
            return {
              ...row,
              availableQty: details.quantity !== undefined ? Number(details.quantity) : null,
              binLocation: details.bin_location || '',
            };
          });
          return { ...prev, [lineNum]: updated };
        });
      }
    } catch (err) {
      console.warn('[ISSUE-WIZARD] Batch lookup error:', err);
    } finally {
      setBatchLookupLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Automatically fetch available in-stock batches and warehouse bins for components when on Step 3
  useEffect(() => {
    if (currentStep !== 2) return;
    const selected = Object.values(selectedComponents).filter((c) => c && c.selected);
    selected.forEach(async (comp) => {
      // 1. Fetch warehouse bins if not cached
      if (comp.warehouseCode && !warehouseBinsCache[comp.warehouseCode]) {
        fetchWarehouseBins(comp.warehouseCode)
          .then((bins) => {
            setWarehouseBinsCache((prev) => ({ ...prev, [comp.warehouseCode]: bins }));
          })
          .catch((e) => console.warn(`[ISSUE-WIZARD] Failed to load bins for ${comp.warehouseCode}:`, e));
      }

      // 2. Fetch available batches for batch-managed items
      const isBatchManaged = comp.manageBatchNumbers === true || comp.ManageBatchNumbers === 'tYES';
      if (!isBatchManaged) return;
      if (availableBatchesCache[comp.lineNumber] || loadingAvailableBatches[comp.lineNumber]) return;

      setLoadingAvailableBatches((prev) => ({ ...prev, [comp.lineNumber]: true }));
      try {
        const batchList = await fetchAvailableBatchesForIssue(comp.itemCode, comp.warehouseCode);
        setAvailableBatchesCache((prev) => ({ ...prev, [comp.lineNumber]: batchList }));
      } catch (err) {
        console.warn(`[ISSUE-WIZARD] Failed to load batches for ${comp.itemCode}:`, err);
      } finally {
        setLoadingAvailableBatches((prev) => ({ ...prev, [comp.lineNumber]: false }));
      }
    });
  }, [currentStep, selectedComponents, availableBatchesCache, loadingAvailableBatches, warehouseBinsCache]);

  // Step 3 Validation: every batch-managed component MUST have complete batch and bin allocations matching issueQuantity
  const isStep3Valid = useMemo(() => {
    const selected = Object.values(selectedComponents).filter((c) => c.selected);
    if (selected.length === 0) return false;

    for (const comp of selected) {
      const isBatchManaged = comp.manageBatchNumbers === true || comp.ManageBatchNumbers === 'tYES';
      const isStandard = Boolean(noBatchRequired[comp.lineNumber]);

      const allocRows = allocations[comp.lineNumber] || [];

      // If batch-managed and not standard, it MUST have allocation rows
      if (isBatchManaged && !isStandard && allocRows.length === 0) {
        return false;
      }

      if (allocRows.length === 0) {
        continue;
      }

      const batchesInWhs = availableBatchesCache[comp.lineNumber] || [];
      const hasBins = batchesInWhs.some((b) => b.bin_abs_entry) || (warehouseBinsCache[comp.warehouseCode] || []).length > 0;

      // Check that every row has valid positive quantity, batch number, and bin location
      const hasInvalidRow = allocRows.some((r) => {
        const q = Number(r.quantity || 0);
        const missingBatch = isBatchManaged && !isStandard && !String(r.batchNumber || '').trim();
        const missingBin = isBatchManaged && !isStandard && hasBins && !r.binAbsEntry;
        return q <= 0 || missingBatch || missingBin;
      });
      if (hasInvalidRow) return false;

      // Sum of allocated batches must exactly match issueQuantity
      const sum = allocRows.reduce((acc, row) => acc + Number(row.quantity || 0), 0);
      if (Math.abs(sum - Number(comp.issueQuantity)) > 0.0001) {
        return false;
      }
    }
    return true;
  }, [selectedComponents, allocations, noBatchRequired, availableBatchesCache, warehouseBinsCache]);

  // ── Step 4 Document Info Validation ────────────────────────────────────────
  const isStep4Valid = useMemo(() => {
    return Boolean(documentInfo.postingDate);
  }, [documentInfo]);

  // ── Step 5 Submit for Review ───────────────────────────────────────────────
  const handleSubmitDraft = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');

    const wizardState = {
      selectedOrder,
      selectedComponents,
      allocations,
      documentInfo,
    };

    try {
      const result = await submitPendingIssue(wizardState);
      const data = result?.data || result;
      if (result?.success || data?.pending_issue_id) {
        setSubmissionResult({
          pendingIssueId: data.pending_issue_id,
          status: data.status || 'PENDING_REVIEW',
          totalComponents: data.total_components,
          totalQuantity: data.total_quantity,
          orderNumber: selectedOrder.orderNumber,
          submittedBy: user?.username || 'Current User',
          timestamp: new Date().toLocaleString(),
        });
      } else {
        setSubmitError(result?.error || 'Failed to submit issue draft.');
      }
    } catch (err) {
      console.error('[ISSUE-WIZARD] Submit draft error:', err);
      const errMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'An error occurred while saving the draft issue.';
      setSubmitError(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetWizard = () => {
    setSelectedOrder(null);
    setSelectedComponents({});
    setAllocations({});
    setNoBatchRequired({});
    setDocumentInfo({
      postingDate: new Date().toISOString().split('T')[0],
      documentDate: new Date().toISOString().split('T')[0],
      comments: '',
      journalMemo: '',
    });
    setSubmissionResult(null);
    setSubmitError('');
    setCurrentStep(0);
    setMaxReachedStep(0);
  };

  // ── RENDER SUCCESS SCREEN ──────────────────────────────────────────────────
  if (submissionResult) {
    return (
      <div className="page-shell issue-wizard">
        <section className="issue-panel">
          <div className="issue-success-view">
            <div className="issue-success-icon" aria-hidden="true">
              <CheckCircle2 size={44} strokeWidth={2.2} />
            </div>
            <h1 className="issue-success-title">{t('issueWizard.successTitle')}</h1>
            <p className="issue-success-desc">{t('issueWizard.successDesc')}</p>

            <div className="issue-success-card">
              <div className="issue-review-meta-grid">
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">🔢</span>
                    {t('issueWizard.pendingIssueId')}
                  </span>
                  <span className="issue-meta-val" style={{ color: 'var(--color-primary)', fontSize: '1.1rem' }}>
                    #{submissionResult.pendingIssueId}
                  </span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">🧾</span>
                    {t('issueWizard.orderNumber')}
                  </span>
                  <span className="issue-meta-val">#{submissionResult.orderNumber}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">✅</span>
                    {t('issueWizard.status')}
                  </span>
                  <span className="badge badge--warning" style={{ alignSelf: 'flex-start' }}>
                    {t('issueWizard.pendingReview')}
                  </span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">📋</span>
                    {t('issueWizard.totalComponents')}
                  </span>
                  <span className="issue-meta-val">{submissionResult.totalComponents}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">📊</span>
                    {t('issueWizard.totalQuantity')}
                  </span>
                  <span className="issue-meta-val">{submissionResult.totalQuantity}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">👤</span>
                    {t('issueWizard.submittedBy')}
                  </span>
                  <span className="issue-meta-val">{submissionResult.submittedBy}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">
                    <span className="meta-label-icon" aria-hidden="true">🕐</span>
                    {t('issueWizard.submissionTime')}
                  </span>
                  <span className="issue-meta-val">{submissionResult.timestamp}</span>
                </div>
              </div>
            </div>

            <div className="issue-success-actions">
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => navigate('/production')}
              >
                {t('issueWizard.backToProduction')}
              </button>
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={handleResetWizard}
              >
                {t('issueWizard.issueAnother')}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ── RENDER MAIN WIZARD ─────────────────────────────────────────────────────
  return (
    <div className="page-shell issue-wizard">
      <PageHeader
        eyebrow={t('issueWizard.title')}
        title={t('issueWizard.pageTitle')}
        description={t('issueWizard.pageDesc')}
      />

      {/* Stepper Bar */}
      <div className="receipt-wizard issue-stepper-container">
        <div className="wizard-stepbar-wrap" ref={stepbarRef} role="list" aria-label="Issue Wizard Steps">
          {steps.map((st, idx) => {
            const canNavigate = idx <= maxReachedStep;
            const isDone = idx < currentStep;
            const isActive = idx === currentStep;
            const className = [
              'wizard-step',
              isDone ? 'wizard-step--done' : '',
              isActive ? 'wizard-step--active' : '',
              canNavigate ? 'wizard-step--clickable' : 'wizard-step--locked',
            ].filter(Boolean).join(' ');
            return (
              <React.Fragment key={st.id}>
                <div
                  className={className}
                  onClick={() => canNavigate && goToStep(idx)}
                  title={!canNavigate ? t('wizard.unlockHint') : undefined}
                  role="listitem"
                  aria-current={isActive ? 'step' : undefined}
                >
                  <div className="wizard-step__circle">
                    {isDone ? '✓' : st.icon}
                  </div>
                  <span className="wizard-step__label">{st.title}</span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`wizard-connector${isDone ? ' wizard-connector--done' : ''}`} aria-hidden="true" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Persistent Order Banner (when an order is selected and step > 0) */}
      {selectedOrder && currentStep > 0 && (
        <div className="issue-selected-banner">
          <div className="issue-selected-banner__info">
            <span className="issue-selected-banner__order">
              #{selectedOrder.orderNumber}
            </span>
            <span>
              <span className="meta-label-icon" aria-hidden="true" style={{ marginInlineEnd: '4px' }}>
                {getProductIcon(selectedOrder.itemName || selectedOrder.itemCode)}
              </span>
              <strong>{selectedOrder.itemName}</strong> ({selectedOrder.itemCode})
            </span>
            <span className="badge badge--success">
              {t('issueWizard.released')}
            </span>
            {selectedOrder.warehouse && (
              <span className="badge badge--secondary">
                WH: {selectedOrder.warehouse}
              </span>
            )}
          </div>
          <button
            type="button"
            className="app-button app-button--secondary app-button--sm"
            onClick={() => goToStep(0)}
          >
            {t('issueWizard.step1')}
          </button>
        </div>
      )}

      {/* ── STEP 1: SELECT PRODUCTION ORDER ─────────────────────────────────── */}
      {currentStep === 0 && (
        <section className="issue-panel">
          <div className="issue-panel-header">
            <h2 className="issue-panel-title">
              <Layers size={22} />
              {t('issueWizard.step1')}
            </h2>
            <p className="issue-panel-subtitle">{t('issueWizard.step1Desc')}</p>
          </div>

          <div className="issue-filter-bar">
            <div className="issue-search-input">
              <input
                type="search"
                className="app-input"
                placeholder={t('issueWizard.searchOrder')}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          </div>

          {ordersLoading && (
            <div style={{ padding: '16px 0' }}>
              <div className="feedback-message feedback-message--info" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AppSpinner size="sm" />
                <span>{t('issueWizard.loadingOrders')}</span>
              </div>
              <LoadingSkeleton rows={3} style={{ marginTop: '16px' }} />
            </div>
          )}

          {!ordersLoading && ordersError && (
            <div className="feedback-message feedback-message--error">
              {ordersError}
            </div>
          )}

          {!ordersLoading && !ordersError && filteredOrders.length === 0 && (
            <div className="empty-state">
              <p>
                {searchFilter ? t('issueWizard.noOrdersFiltered') : t('issueWizard.noOrders')}
              </p>
            </div>
          )}

          {!ordersLoading && !ordersError && filteredOrders.length > 0 && (
            <div className="issue-orders-grid">
              {filteredOrders.map((order) => {
                const isSelected = selectedOrder?.docEntry === order.docEntry;
                return (
                  <div
                    key={order.docEntry}
                    className={`issue-order-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectOrder(order)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectOrder(order);
                      }
                    }}
                  >
                    <div className="issue-order-card__header">
                      <span className="issue-order-card__num">#{order.orderNumber}</span>
                      <span className="badge badge--success">{t('issueWizard.released')}</span>
                    </div>

                    <div className="issue-order-card__product">
                      <span className="meta-label-icon" aria-hidden="true" style={{ marginInlineEnd: '5px' }}>
                        {getProductIcon(order.itemName || order.itemCode)}
                      </span>
                      {order.itemName}
                    </div>
                    <div className="issue-order-card__code">{order.itemCode}</div>

                    <div className="issue-order-card__meta-grid">
                      <div className="issue-meta-item">
                        <span className="issue-meta-label">
                          <span className="meta-label-icon" aria-hidden="true">📊</span>
                          {t('issueWizard.plannedQty')}
                        </span>
                        <span className="issue-meta-val">{order.plannedQty}</span>
                      </div>
                      <div className="issue-meta-item">
                        <span className="issue-meta-label">
                          <span className="meta-label-icon" aria-hidden="true">✅</span>
                          {t('issueWizard.completedQty')}
                        </span>
                        <span className="issue-meta-val">{order.completedQty}</span>
                      </div>
                      <div className="issue-meta-item">
                        <span className="issue-meta-label">
                          <span className="meta-label-icon" aria-hidden="true">♻️</span>
                          {t('issueWizard.remainingQty')}
                        </span>
                        <span className="issue-meta-val" style={{ color: 'var(--color-primary)' }}>
                          {order.remainingQty}
                        </span>
                      </div>
                      {order.dueDate && (
                        <div className="issue-meta-item" style={{ gridColumn: 'span 2' }}>
                          <span className="issue-meta-label">
                            <span className="meta-label-icon" aria-hidden="true">📅</span>
                            {t('issueWizard.dueDate')}
                          </span>
                          <span className="issue-meta-val">{order.dueDate}</span>
                        </div>
                      )}
                      {order.warehouse && (
                        <div className="issue-meta-item">
                          <span className="issue-meta-label">
                            <span className="meta-label-icon" aria-hidden="true">🏭</span>
                            {t('issueWizard.warehouse')}
                          </span>
                          <span className="issue-meta-val">{order.warehouse}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {loadingOrderDetails && (
            <div className="feedback-message feedback-message--info" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AppSpinner size="sm" />
              <span>{t('issueWizard.loadingOrderDetails')}</span>
            </div>
          )}

          <div className="issue-actions-bar">
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={() => navigate('/production')}
            >
              {t('issueWizard.backToProduction')}
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={!selectedOrder || loadingOrderDetails}
              onClick={handleNext}
            >
              <span>{t('issueWizard.nextBtn')}</span>
              {lang === 'ar' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 2: SELECT COMPONENTS & QUANTITIES ─────────────────────────── */}
      {currentStep === 1 && (
        <section className="issue-panel">
          <div className="issue-panel-header">
            <h2 className="issue-panel-title">
              <Layers size={22} />
              {t('issueWizard.selectComponentsTitle')}
            </h2>
            <p className="issue-panel-subtitle">{t('issueWizard.selectComponentsDesc')}</p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>
              {selectedComponentsCount} / {activeComponentsList.length} components selected
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="app-button app-button--secondary app-button--sm"
                onClick={handleSelectAllComponents}
              >
                {t('issueWizard.selectAll')}
              </button>
              <button
                type="button"
                className="app-button app-button--secondary app-button--sm"
                onClick={handleDeselectAllComponents}
              >
                {t('issueWizard.deselectAll')}
              </button>
            </div>
          </div>

          {activeComponentsList.length === 0 ? (
            <div className="empty-state">
              <p>{t('issueWizard.noComponents')}</p>
            </div>
          ) : (
            <div className="issue-comp-table-wrap">
              <table className="issue-comp-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>{t('issueWizard.itemCode')}</th>
                    <th>{t('issueWizard.itemName')}</th>
                    <th>{t('issueWizard.plannedQty')}</th>
                    <th>{t('issueWizard.issuedQty')}</th>
                    <th>{t('issueWizard.remainingQty')}</th>
                    <th>{t('issueWizard.warehouse')}</th>
                    <th>{t('issueWizard.uom')}</th>
                    <th>{t('issueWizard.issueType')}</th>
                    <th style={{ textAlign: 'end', width: '130px' }}>{t('issueWizard.issueQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeComponentsList.map((comp) => {
                    const isSelected = comp.selected;
                    const isQtyValid =
                      comp.issueQuantity > 0 && comp.issueQuantity <= comp.remainingQuantity + 0.0001;

                    return (
                      <tr key={comp.lineNumber} className={isSelected ? 'selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleComponentSelect(comp.lineNumber)}
                            aria-label={`Select line ${comp.lineNumber}`}
                          />
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{comp.itemCode}</td>
                        <td>{comp.itemName || '—'}</td>
                        <td>{comp.plannedQuantity}</td>
                        <td>{comp.issuedQuantity}</td>
                        <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                          {comp.remainingQuantity}
                        </td>
                        <td>{comp.warehouseCode || '—'}</td>
                        <td>{comp.uomCode || '—'}</td>
                        <td>
                          <span className="badge badge--secondary">{comp.issueType}</span>
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          <input
                            type="number"
                            min="0.0001"
                            max={comp.remainingQuantity}
                            step="any"
                            className={`issue-qty-input ${isSelected && !isQtyValid ? 'error' : ''}`}
                            disabled={!isSelected}
                            value={comp.issueQuantity}
                            onChange={(e) => updateComponentQty(comp.lineNumber, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isStep2Valid && (
            <div className="feedback-message feedback-message--warning">
              {t('issueWizard.atLeastOneComponent')}
            </div>
          )}

          <div className="issue-actions-bar">
            <button type="button" className="app-button app-button--secondary" onClick={handlePrev}>
              {lang === 'ar' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
              <span>{t('issueWizard.previousBtn')}</span>
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={!isStep2Valid}
              onClick={handleNext}
            >
              <span>{t('issueWizard.nextBtn')}</span>
              {lang === 'ar' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 3: INVENTORY ALLOCATION (BATCH / BIN) ───────────────────────── */}
      {currentStep === 2 && (
        <section className="issue-panel">
          <div className="issue-panel-header">
            <h2 className="issue-panel-title">
              <Layers size={22} />
              {t('issueWizard.allocationTitle')}
            </h2>
            <p className="issue-panel-subtitle">{t('issueWizard.allocationDesc')}</p>
          </div>

          {activeComponentsList
            .filter((c) => c.selected)
            .map((comp) => {
              const compAllocations = allocations[comp.lineNumber] || [];
              const isStandard = noBatchRequired[comp.lineNumber] || false;
              const whBins = warehouseBinsCache[comp.warehouseCode] || [];
              const totalAllocated = compAllocations.reduce(
                (sum, r) => sum + Number(r.quantity || 0),
                0
              );
              const remainingToAllocate = Number(comp.issueQuantity) - totalAllocated;
              const isMatch = Math.abs(remainingToAllocate) <= 0.0001;

              return (
                <div key={comp.lineNumber} className="issue-alloc-card">
                  <div className="issue-alloc-card__header">
                    <div>
                      <span className="issue-alloc-card__title">
                        <span className="meta-label-icon" aria-hidden="true" style={{ marginInlineEnd: '5px' }}>
                          {getProductIcon(comp.itemName || comp.itemCode)}
                        </span>
                        {comp.itemCode} — {comp.itemName || 'Line ' + comp.lineNumber}
                      </span>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        Warehouse: <strong>{comp.warehouseCode}</strong> | Issue Quantity:{' '}
                        <strong>{comp.issueQuantity} {comp.uomCode}</strong>
                        {(comp.manageBatchNumbers || comp.ManageBatchNumbers === 'tYES') && (
                          <span style={{ marginInlineStart: '8px', color: 'var(--color-primary)', fontWeight: 600 }}>
                            [Batch Managed]
                          </span>
                        )}
                        {(comp.manageSerialNumbers || comp.ManageSerialNumbers === 'tYES') && (
                          <span style={{ marginInlineStart: '8px', color: 'var(--color-primary)', fontWeight: 600 }}>
                            [Serial Managed]
                          </span>
                        )}
                      </div>
                    </div>

                    {!(comp.manageBatchNumbers || comp.ManageBatchNumbers === 'tYES' || comp.manageSerialNumbers || comp.ManageSerialNumbers === 'tYES') && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isStandard}
                          onChange={(e) =>
                            setNoBatchRequired((prev) => ({
                              ...prev,
                              [comp.lineNumber]: e.target.checked,
                            }))
                          }
                        />
                        <span>{t('issueWizard.noBatchRequired')}</span>
                      </label>
                    )}
                  </div>

                  {!isStandard && (
                    <div className="issue-alloc-card__body">
                      {/* 1. Available Batches Cards from SAP */}
                      <div className="issue-batch-cards-container">
                        <div className="issue-batch-cards-header">
                          <span className="issue-batch-cards-title">
                            <Layers size={16} />
                            {t('issueWizard.availableBatchesTitle')} ({comp.warehouseCode})
                          </span>
                          {loadingAvailableBatches[comp.lineNumber] && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <AppSpinner size="xs" />
                              <span>{t('issueWizard.loadingBatches')}</span>
                            </span>
                          )}
                        </div>

                        {loadingAvailableBatches[comp.lineNumber] ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.88rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <AppSpinner size="sm" />
                            <span>{t('issueWizard.loadingBatches')}</span>
                          </div>
                        ) : !availableBatchesCache[comp.lineNumber] || availableBatchesCache[comp.lineNumber].length === 0 ? (
                          <div style={{ padding: '12px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                            {t('issueWizard.noBatchesFound')} <strong>{comp.warehouseCode}</strong>.
                          </div>
                        ) : (
                          <div className="batch-select-grid">
                            {availableBatchesCache[comp.lineNumber].map((b) => {
                              const batchNum = b.batch_number || b.dist_number || '';
                              const batchQty = Number(b.on_hand_qty ?? b.quantity ?? 0);
                              const isSysBin = Boolean(b.is_system_bin);
                              const isAllocated = compAllocations.some((a) => a.batchNumber === batchNum);

                              const cardKey = `${batchNum}-${b.bin_abs_entry || 'nobin'}`;
                              return (
                                <div
                                  key={cardKey}
                                  className={`batch-select-card ${isAllocated ? 'batch-select-card--selected' : ''} ${isSysBin ? 'batch-select-card--system-bin' : ''}`}
                                  onClick={() => {
                                    // If not yet allocated, auto-fill or append
                                    if (!isAllocated) {
                                      const existing = compAllocations;
                                      const allocatedSum = existing.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
                                      const remainingToAlloc = Math.max(0, Number(comp.issueQuantity) - allocatedSum);
                                      const fillQty = Math.min(batchQty, remainingToAlloc > 0 ? remainingToAlloc : Number(comp.issueQuantity));

                                      if (existing.length === 0 || (existing.length === 1 && !existing[0].batchNumber)) {
                                        setAllocations((prev) => ({
                                          ...prev,
                                          [comp.lineNumber]: [
                                            {
                                              id: Date.now(),
                                              batchNumber: batchNum,
                                              binAbsEntry: b.bin_abs_entry || '',
                                              binCode: b.bin_code || '',
                                              quantity: fillQty,
                                              availableQty: batchQty,
                                            },
                                          ],
                                        }));
                                      } else {
                                        setAllocations((prev) => ({
                                          ...prev,
                                          [comp.lineNumber]: [
                                            ...prev[comp.lineNumber],
                                            {
                                              id: Date.now() + Math.random(),
                                              batchNumber: batchNum,
                                              binAbsEntry: b.bin_abs_entry || '',
                                              binCode: b.bin_code || '',
                                              quantity: fillQty > 0 ? fillQty : '',
                                              availableQty: batchQty,
                                            },
                                          ],
                                        }));
                                      }
                                    }
                                  }}
                                >
                                  <div className="batch-select-card__header">
                                    <span className="batch-select-card__number">{batchNum}</span>
                                    <span className={`batch-select-card__badge ${isSysBin ? 'batch-select-card__badge--system' : 'batch-select-card__badge--storage'}`}>
                                      {isSysBin ? t('issueWizard.systemBinBadge') : (b.bin_code || t('issueWizard.storageBinBadge'))}
                                    </span>
                                  </div>

                                  <div className="batch-select-card__meta">
                                    <div className="batch-select-card__meta-row">
                                      <span>{t('issueWizard.availableStock')}:</span>
                                      <span className="batch-select-card__stock-highlight">
                                        {batchQty.toLocaleString()} {comp.uomCode}
                                      </span>
                                    </div>
                                    {b.bin_code && (
                                      <div className="batch-select-card__meta-row">
                                        <span>{t('issueWizard.binLocation')}:</span>
                                        <strong>{b.bin_code}</strong>
                                      </div>
                                    )}
                                    {b.expiry_date && (
                                      <div className="batch-select-card__meta-row">
                                        <span>{t('issueWizard.expiryDate')}:</span>
                                        <span>{String(b.expiry_date).split('T')[0]}</span>
                                      </div>
                                    )}
                                  </div>

                                  <div className="batch-select-card__actions">
                                    <button
                                      type="button"
                                      className={`app-button app-button--sm ${isAllocated ? 'app-button--primary' : 'app-button--secondary'}`}
                                      style={{ width: '100%', fontSize: '0.78rem' }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const existing = compAllocations;
                                        const allocatedSum = existing.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
                                        const remainingToAlloc = Math.max(0, Number(comp.issueQuantity) - allocatedSum);
                                        const fillQty = Math.min(batchQty, remainingToAlloc > 0 ? remainingToAlloc : Number(comp.issueQuantity));

                                        if (existing.length === 0 || (existing.length === 1 && !existing[0].batchNumber)) {
                                          setAllocations((prev) => ({
                                            ...prev,
                                            [comp.lineNumber]: [
                                              {
                                                id: Date.now(),
                                                batchNumber: batchNum,
                                                binAbsEntry: b.bin_abs_entry || '',
                                                binCode: b.bin_code || '',
                                                quantity: fillQty,
                                                availableQty: batchQty,
                                              },
                                            ],
                                          }));
                                        } else {
                                          setAllocations((prev) => ({
                                            ...prev,
                                            [comp.lineNumber]: [
                                              ...prev[comp.lineNumber],
                                              {
                                                id: Date.now() + Math.random(),
                                                batchNumber: batchNum,
                                                binAbsEntry: b.bin_abs_entry || '',
                                                binCode: b.bin_code || '',
                                                quantity: fillQty > 0 ? fillQty : '',
                                                availableQty: batchQty,
                                              },
                                            ],
                                          }));
                                        }
                                      }}
                                    >
                                      {isAllocated ? '✓ ' + t('issueWizard.allocatedExact') : '+ ' + t('issueWizard.autoAllocateBtn')}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 2. Allocation Splits List */}
                      {compAllocations.length === 0 ? (
                        <div style={{ marginBottom: '16px', color: 'var(--color-text-muted)', fontSize: '0.88rem', padding: '12px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: '6px' }}>
                          {t('issueWizard.noComponents')} - Click on any available batch card above or &quot;Add Allocation Split&quot; to allocate batches and bins.
                        </div>
                      ) : (
                        compAllocations.map((alloc, idx) => {
                          const lookupKey = `${comp.lineNumber}-${idx}`;
                          const isLookingUp = batchLookupLoading[lookupKey];
                          const selectedBatchDetails = (availableBatchesCache[comp.lineNumber] || []).find(
                            (b) => (b.batch_number || b.dist_number) === alloc.batchNumber
                          );

                          return (
                            <div key={alloc.id || idx} className="issue-alloc-split-card">
                              <div className="issue-alloc-split-card__header">
                                <span className="issue-alloc-split-card__title">
                                  <Layers size={14} />
                                  Split #{idx + 1}: {alloc.batchNumber || 'Unassigned'}
                                </span>
                                <button
                                  type="button"
                                  className="app-button app-button--danger app-button--sm"
                                  onClick={() => removeAllocationRow(comp.lineNumber, idx)}
                                  title={t('issueWizard.removeSplit')}
                                >
                                  <Trash2 size={14} />
                                  <span>{t('issueWizard.removeSplit')}</span>
                                </button>
                              </div>

                              <div className="issue-alloc-split-grid">
                                {/* Left column: Batch & Quantity */}
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px' }}>
                                    {t('issueWizard.batchNumber')}
                                  </label>
                                  <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                                    <input
                                      type="text"
                                      className="app-input"
                                      placeholder="Batch #"
                                      value={alloc.batchNumber || ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        updateAllocationField(comp.lineNumber, idx, 'batchNumber', val);
                                        // Reset binAbsEntry immediately so previous bin is never leaked
                                        updateAllocationField(comp.lineNumber, idx, 'binAbsEntry', '');
                                        updateAllocationField(comp.lineNumber, idx, 'availableQty', null);

                                        const matched = (availableBatchesCache[comp.lineNumber] || []).filter(
                                          (b) => (b.batch_number || b.dist_number) === val.trim()
                                        );
                                        if (matched.length > 0) {
                                          const phys = matched.filter((b) => !b.is_system_bin && b.bin_abs_entry);
                                          const target = phys.length > 0 ? phys : matched.filter((b) => b.bin_abs_entry);
                                          if (target.length === 1 && target[0].bin_abs_entry) {
                                            updateAllocationField(comp.lineNumber, idx, 'binAbsEntry', target[0].bin_abs_entry);
                                            updateAllocationField(comp.lineNumber, idx, 'availableQty', Number(target[0].on_hand_qty ?? target[0].quantity ?? 0));
                                          }
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="app-button app-button--secondary app-button--sm"
                                      disabled={!alloc.batchNumber || isLookingUp}
                                      onClick={() => handleBatchLookup(comp.lineNumber, idx, alloc.batchNumber)}
                                      title={t('issueWizard.lookupBatch')}
                                    >
                                      {isLookingUp ? '...' : t('issueWizard.lookupBatch')}
                                    </button>
                                  </div>

                                  {alloc.availableQty !== null && alloc.availableQty !== undefined && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 600, marginBottom: '12px' }}>
                                      {t('issueWizard.batchAvailable')}: {alloc.availableQty} {comp.uomCode}
                                    </div>
                                  )}

                                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px' }}>
                                    {t('issueWizard.allocatedQty')} ({comp.uomCode})
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0.0001"
                                    max={alloc.availableQty ? alloc.availableQty : undefined}
                                    className="app-input"
                                    placeholder="0.0"
                                    value={alloc.quantity}
                                    onChange={(e) =>
                                      updateAllocationField(comp.lineNumber, idx, 'quantity', e.target.value)
                                    }
                                  />
                                  {alloc.availableQty && Number(alloc.quantity) > Number(alloc.availableQty) && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-danger)', fontWeight: 600, marginTop: '4px' }}>
                                      {t('issueWizard.invalidQty')} (Max: {alloc.availableQty})
                                    </div>
                                  )}
                                </div>

                                {/* Right column: Bin Cards selection */}
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px' }}>
                                    {t('issueWizard.binLocation')} ({comp.warehouseCode})
                                  </label>

                                  {(() => {
                                    const batchVal = (alloc.batchNumber || '').trim();
                                    if (!batchVal) {
                                      return (
                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', padding: '10px', background: 'var(--color-surface)', borderRadius: '6px', border: '1px dashed var(--color-border)' }}>
                                          {t('issueWizard.selectBatchFirst')}
                                        </div>
                                      );
                                    }

                                    const batchMatches = (availableBatchesCache[comp.lineNumber] || []).filter(
                                      (b) => (b.batch_number || b.dist_number) === batchVal
                                    );
                                    const physBins = batchMatches.filter((b) => !b.is_system_bin && b.bin_abs_entry);
                                    const selectableBins = physBins.length > 0 ? physBins : batchMatches.filter((b) => b.bin_abs_entry);

                                    // If batch exists in exactly 1 bin in SAP, show locked assigned card and ensure state is synced
                                    if (selectableBins.length === 1) {
                                      const singleBin = selectableBins[0];
                                      if (Number(alloc.binAbsEntry) !== Number(singleBin.bin_abs_entry)) {
                                        setTimeout(() => {
                                          updateAllocationField(comp.lineNumber, idx, 'binAbsEntry', singleBin.bin_abs_entry);
                                          updateAllocationField(comp.lineNumber, idx, 'availableQty', Number(singleBin.on_hand_qty ?? singleBin.quantity ?? 0));
                                        }, 0);
                                      }

                                      return (
                                        <div
                                          className="bin-card bin-card--selected"
                                          style={{ borderColor: 'var(--color-primary)', background: 'var(--color-primary-soft)', cursor: 'default' }}
                                        >
                                          <div className="bin-card__header">
                                            <span className="bin-card__icon">📍</span>
                                            <span className="bin-card__check" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                                              ✓ {t('issueWizard.autoAssignedBin')}
                                            </span>
                                          </div>
                                          <span className="bin-card__code">{singleBin.bin_code || `Bin ${singleBin.bin_abs_entry}`}</span>
                                          <span className="bin-card__name" style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                                            {t('issueWizard.availableStock')}: {Number(singleBin.on_hand_qty ?? singleBin.quantity ?? 0).toLocaleString()} {comp.uomCode}
                                          </span>
                                        </div>
                                      );
                                    }

                                    // If batch exists in multiple bins in SAP, show selection among those bins only
                                    if (selectableBins.length > 1) {
                                      return (
                                        <div>
                                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '6px' }}>
                                            {t('issueWizard.multipleBinsNotice')}
                                          </div>
                                          <div className="bin-card-grid">
                                            {selectableBins.map((binItem) => {
                                              const isSelected = Number(alloc.binAbsEntry) === Number(binItem.bin_abs_entry);
                                              return (
                                                <button
                                                  key={binItem.bin_abs_entry}
                                                  type="button"
                                                  className={`bin-card ${isSelected ? 'bin-card--selected' : ''}`}
                                                  onClick={() => {
                                                    updateAllocationField(comp.lineNumber, idx, 'binAbsEntry', binItem.bin_abs_entry);
                                                    updateAllocationField(comp.lineNumber, idx, 'availableQty', Number(binItem.on_hand_qty ?? binItem.quantity ?? 0));
                                                  }}
                                                >
                                                  <div className="bin-card__header">
                                                    <span className="bin-card__icon">📍</span>
                                                    {isSelected && <span className="bin-card__check">✓</span>}
                                                  </div>
                                                  <span className="bin-card__code">{binItem.bin_code || `Bin ${binItem.bin_abs_entry}`}</span>
                                                  <span className="bin-card__name" style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                                                    {t('issueWizard.availableStock')}: {Number(binItem.on_hand_qty ?? binItem.quantity ?? 0).toLocaleString()} {comp.uomCode}
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    }

                                    // If batch is manual or not in cache, fallback to warehouse bins excluding system bins
                                    const safeWhBins = whBins.filter((b) => !b.isSystemBin && !String(b.code || '').toUpperCase().includes('SYSTEM-BIN'));
                                    if (safeWhBins.length === 0) {
                                      return (
                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                          {t('issueWizard.noBinForBatch')}
                                        </div>
                                      );
                                    }

                                    return (
                                      <div className="bin-card-grid">
                                        {safeWhBins.map((bin) => {
                                          const isSelected = Number(alloc.binAbsEntry) === Number(bin.absEntry);
                                          return (
                                            <button
                                              key={bin.absEntry}
                                              type="button"
                                              className={`bin-card ${isSelected ? 'bin-card--selected' : ''}`}
                                              onClick={() => updateAllocationField(comp.lineNumber, idx, 'binAbsEntry', bin.absEntry)}
                                            >
                                              <div className="bin-card__header">
                                                <span className="bin-card__icon">📍</span>
                                                {isSelected && <span className="bin-card__check">✓</span>}
                                              </div>
                                              <span className="bin-card__code">{bin.code}</span>
                                              {(bin.name || bin.description) && (
                                                <span className="bin-card__name">{bin.name || bin.description}</span>
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap', gap: '8px' }}>
                        <button
                          type="button"
                          className="app-button app-button--secondary app-button--sm"
                          onClick={() => addAllocationRow(comp.lineNumber)}
                        >
                          <Plus size={14} />
                          <span>{t('issueWizard.addSplit')}</span>
                        </button>

                        <div className={`issue-alloc-summary-bar ${isMatch ? 'match' : 'mismatch'}`}>
                          <span>
                            Allocated: <strong>{totalAllocated}</strong> / Required: <strong>{comp.issueQuantity}</strong>
                          </span>
                          {!isMatch && (
                            <span style={{ marginInlineStart: '12px' }}>
                              ({remainingToAllocate > 0
                                ? `${t('issueWizard.remainingToAllocate')}: ${remainingToAllocate.toFixed(3)}`
                                : `Excess: ${Math.abs(remainingToAllocate).toFixed(3)}`})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

          {!isStep3Valid && (
            <div className="feedback-message feedback-message--warning">
              {t('issueWizard.allocationMismatch')}
            </div>
          )}

          <div className="issue-actions-bar">
            <button type="button" className="app-button app-button--secondary" onClick={handlePrev}>
              {lang === 'ar' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
              <span>{t('issueWizard.previousBtn')}</span>
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={!isStep3Valid}
              onClick={handleNext}
            >
              <span>{t('issueWizard.nextBtn')}</span>
              {lang === 'ar' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 4: DOCUMENT INFORMATION ───────────────────────────────────── */}
      {currentStep === 3 && (
        <section className="issue-panel">
          <div className="issue-panel-header">
            <h2 className="issue-panel-title">
              <Calendar size={22} />
              {t('issueWizard.step4')}
            </h2>
            <p className="issue-panel-subtitle">{t('issueWizard.step4Desc')}</p>
          </div>

          <div className="issue-doc-grid">
            <div className="form-field">
              <label className="form-label" htmlFor="postingDate">
                {t('issueWizard.postingDate')} *
              </label>
              <input
                id="postingDate"
                type="date"
                className="app-input"
                value={documentInfo.postingDate}
                onChange={(e) => setDocumentInfo((prev) => ({ ...prev, postingDate: e.target.value }))}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="documentDate">
                {t('issueWizard.documentDate')}
              </label>
              <input
                id="documentDate"
                type="date"
                className="app-input"
                value={documentInfo.documentDate}
                onChange={(e) => setDocumentInfo((prev) => ({ ...prev, documentDate: e.target.value }))}
              />
            </div>

            <div className="form-field" style={{ gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="comments">
                {t('issueWizard.comments')}
              </label>
              <textarea
                id="comments"
                rows={2}
                className="app-input"
                value={documentInfo.comments}
                onChange={(e) => setDocumentInfo((prev) => ({ ...prev, comments: e.target.value }))}
              />
            </div>

            <div className="form-field" style={{ gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="journalMemo">
                {t('issueWizard.journalMemo')}
              </label>
              <input
                id="journalMemo"
                type="text"
                className="app-input"
                value={documentInfo.journalMemo}
                onChange={(e) => setDocumentInfo((prev) => ({ ...prev, journalMemo: e.target.value }))}
              />
            </div>
          </div>

          <div className="issue-actions-bar">
            <button type="button" className="app-button app-button--secondary" onClick={handlePrev}>
              {lang === 'ar' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
              <span>{t('issueWizard.previousBtn')}</span>
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={!isStep4Valid}
              onClick={handleNext}
            >
              <span>{t('issueWizard.nextBtn')}</span>
              {lang === 'ar' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 5: REVIEW & SAVE FOR REVIEW ───────────────────────────────── */}
      {currentStep === 4 && (
        <section className="issue-panel">
          <div className="issue-panel-header">
            <h2 className="issue-panel-title">
              <FileText size={22} />
              {t('issueWizard.reviewTitle')}
            </h2>
            <p className="issue-panel-subtitle">{t('issueWizard.reviewDesc')}</p>
          </div>

          {/* Prominent Admin Review Notice */}
          <div className="issue-notice-box" role="alert">
            <Info size={24} style={{ flexShrink: 0 }} />
            <div>{t('issueWizard.reviewNotice')}</div>
          </div>

          {submitError && (
            <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
              <AlertCircle size={20} />
              <span>{submitError}</span>
            </div>
          )}

          {/* Order Details Summary */}
          <div className="issue-review-section">
            <div className="issue-review-section__header">{t('issueWizard.selectedOrder')}</div>
            <div className="issue-review-meta-grid">
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">🧾</span>
                  {t('issueWizard.orderNumber')}
                </span>
                <span className="issue-meta-val">#{selectedOrder?.orderNumber}</span>
              </div>
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">{getProductIcon(selectedOrder?.itemName || selectedOrder?.itemCode)}</span>
                  {t('issueWizard.product')}
                </span>
                <span className="issue-meta-val">{selectedOrder?.itemName}</span>
              </div>
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">🏷️</span>
                  {t('issueWizard.itemCode')}
                </span>
                <span className="issue-meta-val">{selectedOrder?.itemCode}</span>
              </div>
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">✅</span>
                  {t('issueWizard.status')}
                </span>
                <span className="badge badge--success">{t('issueWizard.released')}</span>
              </div>
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">📊</span>
                  {t('issueWizard.plannedQty')}
                </span>
                <span className="issue-meta-val">{selectedOrder?.plannedQty}</span>
              </div>
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">✅</span>
                  {t('issueWizard.completedQty')}
                </span>
                <span className="issue-meta-val">{selectedOrder?.completedQty}</span>
              </div>
            </div>
          </div>

          {/* Components to Issue Summary */}
          <div className="issue-review-section">
            <div className="issue-review-section__header">{t('issueWizard.step2')}</div>
            <div className="issue-comp-table-wrap">
              <table className="issue-comp-table">
                <thead>
                  <tr>
                    <th>{t('issueWizard.itemCode')}</th>
                    <th>{t('issueWizard.itemName')}</th>
                    <th>{t('issueWizard.warehouse')}</th>
                    <th>{t('issueWizard.uom')}</th>
                    <th>{t('issueWizard.issueType')}</th>
                    <th style={{ textAlign: 'end' }}>{t('issueWizard.issueQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeComponentsList
                    .filter((c) => c.selected)
                    .map((comp) => (
                      <tr key={comp.lineNumber}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{comp.itemCode}</td>
                        <td>{comp.itemName || '—'}</td>
                        <td>{comp.warehouseCode}</td>
                        <td>{comp.uomCode}</td>
                        <td>
                          <span className="badge badge--secondary">{comp.issueType}</span>
                        </td>
                        <td style={{ textAlign: 'end', fontWeight: 800, color: 'var(--color-primary)' }}>
                          {comp.issueQuantity}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Allocations Summary */}
          <div className="issue-review-section">
            <div className="issue-review-section__header">{t('issueWizard.step3')}</div>
            {activeComponentsList
              .filter((c) => c.selected)
              .map((comp) => {
                const compAllocs = allocations[comp.lineNumber] || [];
                const isStd = noBatchRequired[comp.lineNumber] || false;

                return (
                  <div key={comp.lineNumber} style={{ marginBottom: '12px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>
                      {comp.itemCode} ({comp.issueQuantity} {comp.uomCode}):
                    </div>
                    {isStd || compAllocs.length === 0 ? (
                      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        {t('issueWizard.noBatchRequired')}
                      </div>
                    ) : (
                      <ul style={{ margin: 0, paddingInlineStart: '20px', fontSize: '0.85rem' }}>
                        {compAllocs.map((a, idx) => (
                          <li key={idx}>
                            Batch: <strong>{a.batchNumber || 'N/A'}</strong> — Quantity:{' '}
                            <strong>{a.quantity}</strong>{' '}
                            {a.binAbsEntry ? `(Bin AbsEntry: ${a.binAbsEntry})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Document Dates & Memos Summary */}
          <div className="issue-review-section">
            <div className="issue-review-section__header">{t('issueWizard.step4')}</div>
            <div className="issue-review-meta-grid">
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">📅</span>
                  {t('issueWizard.postingDate')}
                </span>
                <span className="issue-meta-val">{documentInfo.postingDate}</span>
              </div>
              <div className="issue-meta-item">
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">📅</span>
                  {t('issueWizard.documentDate')}
                </span>
                <span className="issue-meta-val">{documentInfo.documentDate || '—'}</span>
              </div>
              <div className="issue-meta-item" style={{ gridColumn: 'span 2' }}>
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">📝</span>
                  {t('issueWizard.comments')}
                </span>
                <span className="issue-meta-val">{documentInfo.comments || '—'}</span>
              </div>
              <div className="issue-meta-item" style={{ gridColumn: 'span 2' }}>
                <span className="issue-meta-label">
                  <span className="meta-label-icon" aria-hidden="true">📝</span>
                  {t('issueWizard.journalMemo')}
                </span>
                <span className="issue-meta-val">{documentInfo.journalMemo || '—'}</span>
              </div>
            </div>
          </div>

          <div className="issue-actions-bar">
            <button
              type="button"
              className="app-button app-button--secondary"
              disabled={submitting}
              onClick={handlePrev}
            >
              {lang === 'ar' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
              <span>{t('issueWizard.previousBtn')}</span>
            </button>
            <button
              type="button"
              className="app-button app-button--success"
              disabled={submitting}
              aria-busy={submitting ? 'true' : 'false'}
              onClick={handleSubmitDraft}
            >
              {submitting ? (
                <>
                  <AppSpinner size="sm" />
                  <span>{t('issueWizard.submitting')}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  <span>{t('issueWizard.submitForReview')}</span>
                </>
              )}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
