import StandardDropdown from '../components/ui/StandardDropdown';
import { warehouseSearch } from '../services/masterDataSearch';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { canManageQuality } from '../utils/roles';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import SearchableSelect from '../components/ui/SearchableSelect';
import { Checkbox, Button, Paper, Typography, Box } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PrintIcon from '@mui/icons-material/Print';
import CloseIcon from '@mui/icons-material/Close';
import '../styles/pages/receipt-review.css';
import '../styles/pages/quality-inspection.css';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import QualityPrintHeader from '../components/print/QualityPrintHeader';
import { ViewActionButton, PrintActionButton, ActionIconButton } from '../components/ui/ActionIconButton';

const DEFECT_CATEGORIES = {
  pests: {
    titleKey: 'quality.catPests',
    items: [
      { key: 'acarus', name: 'Acarus' },
      { key: 'scale_insect', name: 'Scale Insect' },
      { key: 'spray_marks', name: 'Spray Marks' },
      { key: 'citrus_rust', name: 'Citrus Rust' },
      { key: 'thrips', name: 'Thrips' },
      { key: 'vegetable_defects', name: 'Vegetable Defects' },
      { key: 'gummosis', name: 'Gummosis' },
      { key: 'oil_spots', name: 'Oil Spots' },
      { key: 'sunburn', name: 'Sunburn' },
      { key: 'sooty_mold', name: 'Sooty Mold' },
      { key: 'mealybug', name: 'Mealybug' },
    ],
  },
  mechanical: {
    titleKey: 'quality.catMechanical',
    items: [
      { key: 'tearing', name: 'Tearing' },
      { key: 'high_cut', name: 'High Cut' },
      { key: 'bruises', name: 'Bruises' },
      { key: 'cuts', name: 'Cuts' },
    ],
  },
  others: {
    titleKey: 'quality.catOthers',
    items: [
      { key: 'under_size', name: 'Under Size' },
      { key: 'venting', name: 'Venting' },
      { key: 'fruit_fly', name: 'Fruit Fly' },
      { key: 'creasing', name: 'Creasing' },
      { key: 'fall_drop', name: 'Fall Drop' },
      { key: 'mutations', name: 'Mutations' },
      { key: 'navel_blight', name: 'Navel Blight' },
      { key: 'softness', name: 'Softness' },
      { key: 'molds', name: 'Molds' },
    ],
  },
  grades: {
    titleKey: 'quality.catGrades',
    items: [
      { key: 'grade_1', name: 'Grade 1' },
      { key: 'grade_2', name: 'Grade 2' },
    ],
  },
};

const ALL_DEFECTS = Object.values(DEFECT_CATEGORIES).flatMap((category) => category.items);

import { AF_KEYS, AG_KEYS, calculateQualityMetrics } from '../utils/qualityCalculations';
import ExcelSummaryMatrix from '../components/ExcelSummaryMatrix';

const STATUS_OPTIONS = [
  { key: 'PENDING_REVIEW', labelKey: 'quality.statusPendingReview' },
  { key: 'POSTED', labelKey: 'quality.statusPosted' },
  { key: 'REJECTED', labelKey: 'quality.statusRejected' },
  { key: 'FAILED', labelKey: 'quality.statusFailed' },
  { key: 'ALL', labelKey: 'quality.statusAll' },
];

const STATUS_LABELS = {
  PENDING_REVIEW: 'quality.statusPendingReview',
  POSTED: 'quality.statusPosted',
  REJECTED: 'quality.statusRejected',
  FAILED: 'quality.statusFailed',
};

const EDITABLE_FIELDS = [
  'inspection_date',
  'inspector_name',
  'supplier_name',
  'farm_origin',
  'contractor_name',
  'car_number',
  'crop_name',
  'raw_material_type',
  'notes',
];

const fmtValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return '-';
  return value;
};

const looksLikeSapCode = (value) => {
  const text = String(value || '').trim();
  return Boolean(text) && (/^\d+$/.test(text) || /^[A-Za-z0-9_.-]+$/.test(text));
};

const getFarmVendorDisplay = (inspection = {}) => {
  const displayName = inspection.farm_origin_name || inspection.farm_display_name;
  if (displayName && !looksLikeSapCode(displayName)) return displayName;
  const supplierName = inspection.supplier_name || '';
  if (supplierName && supplierName !== inspection.farm_origin && !looksLikeSapCode(supplierName)) return supplierName;
  const farmOrigin = inspection.farm_origin || '';
  if (farmOrigin && !looksLikeSapCode(farmOrigin)) return farmOrigin;
  return '';
};

const normalizeFilterValue = (value) => String(value ?? '').trim().toLowerCase();

const includesFilterValue = (value, query) => {
  const normalizedQuery = normalizeFilterValue(query);
  if (!normalizedQuery) return true;
  return normalizeFilterValue(value).includes(normalizedQuery);
};

const matchesDateRange = (value, dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return true;
  if (!value) return false;
  const inspectedAt = new Date(value);
  if (Number.isNaN(inspectedAt.getTime())) return false;
  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`);
    if (inspectedAt < from) return false;
  }
  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59`);
    if (inspectedAt > to) return false;
  }
  return true;
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const normalizeSamples = (inspection) => {
  const samplesData = Array.isArray(inspection?.samples_data) ? inspection.samples_data : [];

  if (samplesData.length > 0 && samplesData[0] !== null && typeof samplesData[0] === 'object' && 'samples' in samplesData[0]) {
    const flat = [];
    samplesData.forEach((truck, truckIdx) => {
      const truckSamples = Array.isArray(truck.samples) ? truck.samples : [];
      truckSamples.forEach((sample) => {
        flat.push({
          ...sample,
          truck_idx: truckIdx,
          truck_number: truck.truck_number || '',
          contractor_name: truck.contractor_name || '',
          farm_origin: truck.farm_origin || '',
          id: sample.id || (flat.length + 1),
          defects: ALL_DEFECTS.reduce((acc, item) => {
            acc[item.key] = toNumber(sample.defects?.[item.key]);
            return acc;
          }, {}),
        });
      });
    });
    return flat;
  }

  const resultFlat = samplesData.map((sample, index) => ({
    ...sample,
    id: sample.id || index + 1,
    defects: ALL_DEFECTS.reduce((acc, item) => {
      acc[item.key] = toNumber(sample.defects?.[item.key]);
      return acc;
    }, {}),
  }));
  return resultFlat;
};

const rebuildHierarchicalSamplesData = (flatSamples, originalSamplesData) => {
  if (!Array.isArray(originalSamplesData) || originalSamplesData.length === 0 || originalSamplesData[0] === null || typeof originalSamplesData[0] !== 'object' || !('samples' in originalSamplesData[0])) {
    return flatSamples;
  }
  
  return originalSamplesData.map((truck, truckIdx) => {
    const truckSamples = flatSamples.filter(s => s.truck_idx === truckIdx);
    const truckMetrics = calculateQualityMetrics(truckSamples, truckSamples.length);
    
    return {
      ...truck,
      samples: truckSamples.map((s, sIdx) => ({
        id: sIdx + 1,
        defects: s.defects
      })),
      metrics: {
        sumAF: truckMetrics.sumAF,
        sumAG: truckMetrics.sumAG,
        sumAH: truckMetrics.sumAH,
        combined_bruises_cuts_percentage: truckMetrics.pctBruisesCuts,
        high_cut_percentage: truckMetrics.pctHighCut,
        average_defects_per_sample: truckMetrics.avgDefects,
        decision: truckMetrics.decision,
        totals: truckMetrics.totals,
      }
    };
  });
};

const recalculateInspection = (inspection, flatSamples = null) => {
  const samples = flatSamples || normalizeSamples(inspection);
  const sampleCount = samples.length || Number(inspection.sample_size) || 0;
  
  const metrics = calculateQualityMetrics(samples, sampleCount);
  const samplesData = rebuildHierarchicalSamplesData(samples, inspection.samples_data);

  return {
    ...inspection,
    sample_size: sampleCount,
    samples_data: samplesData,
    af_waste_total: metrics.sumAF,
    ag_quality_total: metrics.sumAG,
    ah_grand_total: metrics.sumAH,
    average_defects_per_sample: Number(metrics.avgDefects),
    combined_bruises_cuts_percentage: Number(metrics.pctBruisesCuts),
    high_cut_percentage: Number(metrics.pctHighCut),
    quarantine_violation: metrics.quarantineViolation,
    decision: metrics.decision,
  };
};

function StatusBadge({ status, t }) {
  const badgeCls = status === 'PENDING_REVIEW' ? 'PENDING' : status;
  return (
    <span className={`rr-status-badge rr-status-badge--${badgeCls || 'FAILED'}`}>
      {STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : fmtValue(status)}
    </span>
  );
}

function QualityReviewPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [truckFilter, setTruckFilter] = useState('');
  const [contractorFilter, setContractorFilter] = useState('');
  const [farmFilter, setFarmFilter] = useState('');
  const [inspectorFilter, setInspectorFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [editing, setEditing] = useState(false);
  const [localEdits, setLocalEdits] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('quality_review_edits') || '{}');
    } catch {
      return {};
    }
  });
  const warehouses = [];
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingInspection, setDeletingInspection] = useState(null);
  const [isActioning, setIsActioning] = useState(false);
  const [printingInspection, setPrintingInspection] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [printingInspectionsList, setPrintingInspectionsList] = useState([]);
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const adminUser = canManageQuality(user);

  const tx = useCallback((path, fallback, ...args) => {
    const value = t(path, ...args);
    return value === path ? fallback : value;
  }, [t]);

  const defectLabel = useCallback((item) => tx(`quality.defects.${item.key}`, item.name), [tx]);

  const displayedInspections = useMemo(
    () => inspections.map((inspection) => localEdits[inspection.id] || inspection),
    [inspections, localEdits],
  );

  const filteredInspections = useMemo(() => {
    const globalSearch = normalizeFilterValue(search);
    return displayedInspections.filter((inspection) => {
      const productName = inspection.item_name || inspection.item_code || '';
      const matchesGlobalSearch = !globalSearch || [
        inspection.id,
        inspection.batch_number,
        inspection.car_number,
        productName,
      ].some((value) => normalizeFilterValue(value).includes(globalSearch));

      return (
        (statusFilter === 'ALL' || inspection.status === statusFilter)
        && matchesGlobalSearch
        && includesFilterValue(productName, productFilter)
        && includesFilterValue(inspection.car_number, truckFilter)
        && includesFilterValue(inspection.contractor_name, contractorFilter)
        && includesFilterValue(getFarmVendorDisplay(inspection), farmFilter)
        && includesFilterValue(inspection.inspector_name, inspectorFilter)
        && matchesDateRange(inspection.inspection_date, dateFromFilter, dateToFilter)
      );
    });
  }, [
    displayedInspections,
    statusFilter,
    search,
    productFilter,
    truckFilter,
    contractorFilter,
    farmFilter,
    inspectorFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  const qualityFiltersActive = statusFilter !== 'PENDING_REVIEW'
    || Boolean(productFilter)
    || Boolean(truckFilter)
    || Boolean(contractorFilter)
    || Boolean(farmFilter)
    || Boolean(inspectorFilter)
    || Boolean(dateFromFilter)
    || Boolean(dateToFilter);

  const visibleIds = useMemo(() => filteredInspections.map(ins => ins.id), [filteredInspections]);
  const visibleSelectedCount = useMemo(() => selectedIds.filter(id => visibleIds.includes(id)).length, [selectedIds, visibleIds]);
  
  const isAllVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const isSomeVisibleSelected = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;
  
  const handleSelectAllClick = (event) => {
    if (event.target.checked) {
      setSelectedIds(prev => {
        const newSelection = [...prev];
        visibleIds.forEach(id => {
          if (!newSelection.includes(id)) {
            newSelection.push(id);
          }
        });
        return newSelection;
      });
    } else {
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    }
  };

  const handleSelectRow = (event, id) => {
    if (event.target.checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(item => item !== id));
    }
  };

  const handleBulkPrint = () => {
    const listToPrint = [];
    let successCount = 0;
    let failedCount = 0;
    
    selectedIds.forEach(id => {
      const ins = inspections.find(item => item.id === id);
      if (ins) {
        try {
          const remapped = recalculateInspection(localEdits[id] || ins);
          listToPrint.push(remapped);
          successCount++;
        } catch (err) {
          console.error(err);
          failedCount++;
        }
      }
    });
    
    if (listToPrint.length === 0) {
      toast.error("No valid inspections to print.");
      return;
    }
    
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(tx('quality.printWindowBlocked', 'Unable to open the print document. Please allow pop-ups and try again.'));
      return;
    }
    setPrintingInspectionsList(listToPrint);
    setPrintRequest({ mode: 'bulk', successCount, failedCount, printWindow });
  };

  const handleBulkApprove = async () => {
    if (!adminUser) return;
    setIsActioning(true);
    try {
      const payload = { ids: selectedIds };
      if (selectedWarehouse) payload.target_warehouse = selectedWarehouse;
      const res = await API.post(`/quality/approve-bulk/`, payload);
      if (res.data.success) {
        const { success_count, failed_count, skipped_count } = res.data;
        toast.success(`Bulk Approval Complete!\nApproved: ${success_count}\nFailed: ${failed_count}\nSkipped: ${skipped_count}`);
        setSelectedIds([]);
        loadInspections();
      } else {
        toast.error(res.data.error || 'Bulk approval failed.');
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || 'Bulk approval encountered an error.');
    } finally {
      setIsActioning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!adminUser) return;
    setIsActioning(true);
    try {
      const res = await API.post(`/quality/delete-bulk/`, { ids: selectedIds });
      if (res.data.success) {
        const { success_count, failed_count, skipped_count } = res.data;
        toast.success(`Bulk Delete Complete!\nDeleted: ${success_count}\nFailed: ${failed_count}\nSkipped: ${skipped_count}`);
        setSelectedIds([]);
        setShowBulkDeleteModal(false);
        loadInspections();
      } else {
        toast.error(res.data.error || 'Bulk deletion failed.');
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || 'Bulk deletion encountered an error.');
    } finally {
      setIsActioning(false);
    }
  };

  const pendingCount = useMemo(
    () => displayedInspections.filter((inspection) => inspection.status === 'PENDING_REVIEW').length,
    [displayedInspections],
  );
  const failedCount = useMemo(
    () => displayedInspections.filter((inspection) => inspection.status === 'FAILED').length,
    [displayedInspections],
  );
  const postedCount = useMemo(
    () => displayedInspections.filter((inspection) => inspection.status === 'POSTED').length,
    [displayedInspections],
  );

  const loadInspections = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: 'ALL' };
      const res = await API.get('/quality/inspections/', { params });
      if (res.data.success) {
        setInspections(res.data.data.inspections || []);
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quality.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    loadInspections();
  }, [loadInspections]);



  const persistLocalEdit = useCallback((inspection) => {
    const recalculated = recalculateInspection(inspection);
    setLocalEdits((prev) => {
      const next = { ...prev, [recalculated.id]: recalculated };
      localStorage.setItem('quality_review_edits', JSON.stringify(next));
      return next;
    });
    setInspections((prev) => prev.map((item) => (
      item.id === recalculated.id ? { ...item, ...recalculated } : item
    )));
    setSelectedInspection(recalculated);
    setEditing(false);
    toast.success(t('quality.saveSuccess'));
  }, [t, toast]);

  const openInspection = (inspection, editMode = false) => {
    const current = localEdits[inspection.id] || inspection;
    setSelectedInspection(recalculateInspection(current));
    setSelectedWarehouse('');
    setEditing(editMode);
  };

  const closeInspection = () => {
    setSelectedInspection(null);
    setSelectedWarehouse('');
    setEditing(false);
  };

  const updateSelectedField = (field, value) => {
    setSelectedInspection((prev) => ({ ...prev, [field]: value }));
  };

  const updateSampleDefect = (sampleIndex, defectKey, value) => {
    setSelectedInspection((prev) => {
      const samples = normalizeSamples(prev);
      const sample = samples[sampleIndex] || { id: sampleIndex + 1, defects: {} };
      samples[sampleIndex] = {
        ...sample,
        defects: {
          ...sample.defects,
          [defectKey]: toNumber(value),
        },
      };
      return recalculateInspection(prev, samples);
    });
  };

  const handleApprove = async (inspection) => {
    if (!window.confirm(t('quality.approveConfirm'))) return;
    setIsActioning(true);
    try {
      const payload = {};
      if (selectedWarehouse) payload.target_warehouse = selectedWarehouse;
      const res = await API.post(`/quality/inspections/${inspection.id}/approve/`, payload);
      if (res.data.success) {
        toast.success(t('quality.approveSuccess'));
        closeInspection();
        loadInspections();
      } else {
        toast.error(res.data.error || t('quality.approveFailed'));
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || t('quality.approveError'));
    } finally {
      setIsActioning(false);
    }
  };

  const requestDelete = (inspection) => {
    if (inspection.status === 'POSTED') {
      toast.error(t('quality.postedDeleteError') || 'Posted inspections cannot be deleted.');
      return;
    }
    setDeletingInspection(inspection);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!deletingInspection) return;
    if (deletingInspection.status === 'POSTED') {
      toast.error(t('quality.postedDeleteError') || 'Posted inspections cannot be deleted.');
      return;
    }
    setIsActioning(true);
    try {
      const res = await API.delete(`/quality/inspections/${deletingInspection.id}/delete/`);
      if (res.data.success) {
        toast.success(t('quality.deleteSuccess') || 'Inspection permanently deleted.');
        setShowDeleteModal(false);
        setDeletingInspection(null);
        closeInspection();
        loadInspections();
      } else {
        toast.error(res.data.error || t('quality.deleteFailed') || 'Failed to delete inspection.');
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || t('quality.deleteFailed') || 'Failed to delete inspection.');
    } finally {
      setIsActioning(false);
    }
  };

  const printInspection = (inspection) => {
    const current = recalculateInspection(localEdits[inspection.id] || inspection);
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(tx('quality.printWindowBlocked', 'Unable to open the print document. Please allow pop-ups and try again.'));
      return;
    }
    setPrintingInspection(current);
    setSelectedInspection(current);
    setPrintRequest({ mode: 'single', printWindow });
  };

  const canReview = (inspection) => adminUser && ['PENDING_REVIEW', 'FAILED'].includes(inspection.status);
  const inspectionsToPrint = useMemo(() => {
    if (printingInspectionsList && printingInspectionsList.length > 0) {
      return printingInspectionsList;
    }
    if (printingInspection || selectedInspection) {
      return [printingInspection || selectedInspection];
    }
    return [];
  }, [printingInspectionsList, printingInspection, selectedInspection]);

  useEffect(() => {
    if (!printRequest) return undefined;

    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []);
      const opened = writePrintDocument({
        printWindow: printRequest.printWindow,
        title: 'EGAST Quality Review Report',
        elements: sheets,
      });

      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(tx('quality.printWindowBlocked', 'Unable to open the print document. Please allow pop-ups and try again.'));
      } else if (printRequest.mode === 'bulk') {
        toast.success(`Bulk Print Complete!\nPrinted: ${printRequest.successCount}\nFailed: ${printRequest.failedCount}`);
      }

      setPrintRequest(null);
      setPrintingInspection(null);
      setPrintingInspectionsList([]);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [printRequest, toast, tx]);

  return (
    <div className="rr-page-shell qrev-page">
      <div className="rr-page-col">
        <header className="rr-page-header">
          <div>
            <span className="rr-page-header__kicker">{t('quality.headerKicker')}</span>
            <h1 className="rr-page-header__title">{t('quality.reviewDashboardTitle')}</h1>
          </div>
          <button
            type="button"
            className="app-button app-button--secondary rr-header-first-btn qrev-header-button qrev-header-button--refresh"
            onClick={loadInspections}
            disabled={loading}
          >
            <span aria-hidden="true">↻</span>
            <span>{loading ? t('quality.refreshing') : t('quality.refresh')}</span>
          </button>
        </header>

        <div className="rr-stats-row">
          {[
            { label: t('quality.statusPendingReview'), value: pendingCount, color: 'var(--warning)' },
            { label: t('quality.statusFailed'), value: failedCount, color: 'var(--danger)' },
            { label: t('quality.statusPosted'), value: postedCount, color: 'var(--success)' },
            { label: t('quality.totalReports'), value: displayedInspections.length, color: 'var(--text)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rr-stat-chip">
              <span className="rr-stat-chip__value" style={{ color }}>{value}</span>
              <span className="rr-stat-chip__label">{label}</span>
            </div>
          ))}
        </div>

        <div className="rr-filter-bar">
          <label className="qrev-filter-field qrev-filter-field--status">
            <span className="rr-filter-label">{t('quality.filterStatus')}</span>
            <StandardDropdown
              className="app-input rr-filter-input rr-filter-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{t(option.labelKey)}</option>
              ))}
            </StandardDropdown>
          </label>

          <label className="qrev-filter-field qrev-filter-field--product">
            <span className="rr-filter-label">{tx('quality.filterProduct', 'Product')}</span>
            <input
              type="text"
              className="app-input rr-filter-input"
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
              aria-label={tx('quality.filterProduct', 'Product')}
            />
          </label>

          <label className="qrev-filter-field qrev-filter-field--truck">
            <span className="rr-filter-label">{tx('quality.filterTruckNumber', 'Truck Number')}</span>
            <input
              type="text"
              className="app-input rr-filter-input"
              value={truckFilter}
              onChange={(event) => setTruckFilter(event.target.value)}
              aria-label={tx('quality.filterTruckNumber', 'Truck Number')}
            />
          </label>

          <label className="qrev-filter-field qrev-filter-field--contractor">
            <span className="rr-filter-label">{tx('quality.filterContractor', 'Contractor')}</span>
            <input
              type="text"
              className="app-input rr-filter-input"
              value={contractorFilter}
              onChange={(event) => setContractorFilter(event.target.value)}
              aria-label={tx('quality.filterContractor', 'Contractor')}
            />
          </label>

          <label className="qrev-filter-field qrev-filter-field--farm">
            <span className="rr-filter-label">{tx('quality.filterFarmVendor', 'Farm / Vendor')}</span>
            <input
              type="text"
              className="app-input rr-filter-input"
              value={farmFilter}
              onChange={(event) => setFarmFilter(event.target.value)}
              aria-label={tx('quality.filterFarmVendor', 'Farm / Vendor')}
            />
          </label>

          <label className="qrev-filter-field qrev-filter-field--inspector">
            <span className="rr-filter-label">{tx('quality.filterInspector', 'Inspector')}</span>
            <input
              type="text"
              className="app-input rr-filter-input"
              value={inspectorFilter}
              onChange={(event) => setInspectorFilter(event.target.value)}
              aria-label={tx('quality.filterInspector', 'Inspector')}
            />
          </label>

          <label className="qrev-filter-field qrev-filter-field--date qrev-filter-field--date-from">
            <span className="rr-filter-label">{tx('quality.filterDateFrom', 'Date From')}</span>
            <input
              type="date"
              className="app-input rr-filter-input"
              value={dateFromFilter}
              onChange={(event) => setDateFromFilter(event.target.value)}
              title={tx('quality.filterDateFrom', 'Date From')}
            />
          </label>

          <label className="qrev-filter-field qrev-filter-field--date qrev-filter-field--date-to">
            <span className="rr-filter-label">{tx('quality.filterDateTo', 'Date To')}</span>
            <input
              type="date"
              className="app-input rr-filter-input"
              value={dateToFilter}
              onChange={(event) => setDateToFilter(event.target.value)}
              title={tx('quality.filterDateTo', 'Date To')}
            />
          </label>

          {qualityFiltersActive && (
            <button
              type="button"
              className="app-button app-button--secondary rr-filter-clear-btn qrev-filter-clear-btn"
              onClick={() => {
                setStatusFilter('PENDING_REVIEW');
                setSearch('');
                setProductFilter('');
                setTruckFilter('');
                setContractorFilter('');
                setFarmFilter('');
                setInspectorFilter('');
                setDateFromFilter('');
                setDateToFilter('');
              }}
            >
              {t('common.clear')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="rr-grid-loading">{t('quality.loadingReports')}</div>
        ) : filteredInspections.length === 0 ? (
          <div className="rr-grid-empty">{t('quality.noReports')}</div>
        ) : (
          <div className="rr-grid-wrap">
            {selectedIds.length > 0 && (
              <Paper className="review-bulk-toolbar"
                elevation={1} 
                style={{ 
                  padding: '12px 20px', 
                  marginBottom: '16px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  backgroundColor: '#e3f2fd',
                  borderLeft: '5px solid #1976d2',
                  borderRadius: '4px'
                }}
              >
                <Box display="flex" alignItems="center">
                  <Typography variant="subtitle1" style={{ color: '#1976d2', fontWeight: 600 }}>
                    ✓ {selectedIds.length} Selected
                  </Typography>
                </Box>
                <Box display="flex" gap={1.5} className="review-bulk-toolbar__actions">
                  <PrintActionButton icon={<PrintIcon />}
                    onClick={handleBulkPrint}
                  />
                  <Button 
                    variant="contained" 
                    size="small"
                    startIcon={<CheckCircleIcon />}
                    style={{ backgroundColor: '#2e7d32', color: '#fff', textTransform: 'none' }}
                    disabled={!adminUser}
                    onClick={handleBulkApprove}
                  >
                    Approve Selected
                  </Button>
                  <Button 
                    variant="contained" 
                    size="small"
                    startIcon={<DeleteIcon />}
                    style={{ backgroundColor: '#d32f2f', color: '#fff', textTransform: 'none' }}
                    disabled={!adminUser}
                    onClick={() => setShowBulkDeleteModal(true)}
                  >
                    Delete Selected
                  </Button>
                  <Button 
                    variant="outlined" 
                    size="small"
                    startIcon={<CloseIcon />}
                    style={{ color: '#555', borderColor: '#ccc', textTransform: 'none' }}
                    onClick={() => setSelectedIds([])}
                  >
                    Clear Selection
                  </Button>
                </Box>
              </Paper>
            )}
            <div className="rr-grid-scroll qrev-grid-scroll">
              <table className="qrev-table">
                <thead>
                  <tr>
                    <th style={{ width: '50px', textAlign: 'center' }}>
                      <Checkbox
                        size="small"
                        checked={isAllVisibleSelected}
                        indeterminate={isSomeVisibleSelected}
                        onChange={handleSelectAllClick}
                      />
                    </th>
                    <th>{t('quality.colInspectionId')}</th>
                    <th>{t('quality.colBatch')}</th>
                    <th>{t('quality.colProduct')}</th>
                    <th>{tx('quality.colTruckNumber', 'Truck Number')}</th>
                    <th>{tx('quality.colContractor', 'Contractor')}</th>
                    <th>{tx('quality.colFarmVendor', 'Farm / Vendor')}</th>
                    <th>{t('quality.colDate')}</th>
                    <th>{t('quality.colInspector')}</th>
                    <th>{t('quality.colDecision')}</th>
                    <th>{t('quality.colStatus')}</th>
                    <th>{t('quality.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInspections.map((inspection) => {
                    const isSelected = selectedIds.includes(inspection.id);
                    return (
                      <tr key={inspection.id}>
                        <td style={{ width: '50px', textAlign: 'center' }}>
                          <Checkbox
                            size="small"
                            checked={isSelected}
                            onChange={(e) => handleSelectRow(e, inspection.id)}
                          />
                        </td>
                        <td>#{inspection.id}</td>
                      <td className="qrev-mono">{fmtValue(inspection.batch_number)}</td>
                      <td>{fmtValue(inspection.item_name || inspection.item_code)}</td>
                      <td className="qrev-mono">{fmtValue(inspection.car_number)}</td>
                      <td>{fmtValue(inspection.contractor_name)}</td>
                      <td>{fmtValue(getFarmVendorDisplay(inspection))}</td>
                      <td>{fmtValue(inspection.inspection_date)}</td>
                      <td>{fmtValue(inspection.inspector_name)}</td>
                      <td>
                        <span className={`qrev-decision qrev-decision--${String(inspection.decision || '').includes('Rejected') ? 'danger' : String(inspection.decision || '').includes('Conditional') ? 'warning' : 'success'}`}>
                          {t('quality.decisions.' + inspection.decision) || fmtValue(inspection.decision)}
                        </span>
                      </td>
                      <td><StatusBadge status={inspection.status} t={t} /></td>
                      <td>
                        <div className="qrev-actions">
                          <ViewActionButton onClick={() => openInspection(inspection)} />
                          <ActionIconButton icon="✏" label={t('quality.editInspection')} tone="edit" onClick={() => openInspection(inspection, true)} />
                          <PrintActionButton onClick={() => printInspection(inspection)} />
                          {canReview(inspection) && (
                            <>
                              <ActionIconButton icon="💾" label={t('common.saveChanges')} tone="save" onClick={() => persistLocalEdit(inspection)} />
                              <ActionIconButton icon="🗑️" label={t('quality.delete') || 'Delete'} tone="reject" onClick={() => requestDelete(inspection)} />
                              <ActionIconButton icon="✅" label={t('quality.approve')} tone="approve" onClick={() => handleApprove(inspection)} />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {selectedInspection && (
        <>
          <div className="rr-dialog-backdrop" onClick={closeInspection} />
          <div className="rr-dialog rr-dialog--wide qrev-dialog">
            <div className="qrev-dialog__header">
              <div className="qrev-dialog__heading">
                <div className="qrev-dialog__title-row">
                  <div className="rr-dialog__title">{t('quality.title')} #{selectedInspection.id}</div>
                  <StatusBadge status={selectedInspection.status} t={t} />
                </div>
                <div className="rr-dialog__subtitle">
                  {editing ? t('quality.editInspection') : t('quality.viewDetails')}
                </div>
              </div>
              <button
                type="button"
                className="qrev-dialog__close"
                onClick={closeInspection}
                aria-label={t('common.close') || 'Close'}
                title={t('common.close') || 'Close'}
              >
                <CloseIcon fontSize="small" />
              </button>
            </div>

            <div className="qrev-dialog__body">
              <div className="qrev-detail-sections">
                {[
                  {
                    title: 'Inspection Information',
                    fields: [
                      ['inspection_date', 'quality.inspectionDate', true],
                      ['inspector_name', 'quality.inspectorName', true],
                      ['posting_date', 'quality.postingDate', false],
                      ['document_date', 'quality.documentDate', false],
                      ['due_date', 'quality.dueDate', false],
                    ],
                  },
                  {
                    title: 'Product Information',
                    fields: [
                      ['batch_number', 'quality.batchNumber', false],
                      ['item_code', 'quality.itemCode', false],
                      ['item_name', 'quality.productName', false],
                      ['crop_name', 'quality.cropName', true],
                      ['raw_material_type', 'quality.rawMaterialType', true],
                      ['quantity', 'quality.totalQuantity', false],
                      ['uom_name', 'quality.unitOfMeasure', false],
                      ['unit_price', 'quality.unitPrice', false],
                      ['tax_code', 'quality.taxCode', false],
                      ['discount_percent', 'quality.discountPercent', false],
                      ['manufacturing_date', 'quality.manufacturingDate', false],
                      ['admission_date', 'quality.admissionDate', false],
                      ['expiry_date', 'quality.expiryDate', false],
                      ['warehouse_code', 'quality.warehouseCode', false],
                      ['bin_code', 'quality.binLocation', false],
                    ],
                  },
                  {
                    title: 'Source / Supplier',
                    fields: [
                      ['vendor_card_code', 'quality.vendorCardCode', false],
                      ['vendor_name', 'quality.vendorName', false],
                      ['supplier_name', 'quality.supplierName', true],
                      ['farm_origin', 'quality.farmOrigin', true],
                      ['contractor_name', 'quality.contractorName', true],
                      ['car_number', 'quality.carNumber', true],
                    ],
                  },
                ].map((section) => (
                  <section className="qrev-detail-section" key={section.title}>
                    <h4 className="qrev-detail-section__title">{section.title}</h4>
                    <div className="qrev-detail-grid qrev-meta-grid">
                      {section.fields.map(([field, labelKey, editable]) => (
                        <label className="form-field qrev-detail-field" key={field}>
                          <span>{tx(labelKey, labelKey)}</span>
                          <input
                            className="app-input"
                            dir={[
                              'batch_number', 'item_code', 'vendor_card_code', 'warehouse_code',
                              'bin_code', 'tax_code', 'inspection_date', 'posting_date',
                              'document_date', 'due_date', 'manufacturing_date', 'admission_date',
                              'expiry_date', 'quantity', 'unit_price', 'discount_percent',
                            ].includes(field) ? 'ltr' : 'auto'}
                            type={
                              field === 'inspection_date'
                                || field === 'posting_date'
                                || field === 'document_date'
                                || field === 'due_date'
                                || field === 'manufacturing_date'
                                || field === 'admission_date'
                                || field === 'expiry_date'
                                ? 'date'
                                : field === 'quantity'
                                  || field === 'unit_price'
                                  || field === 'discount_percent'
                                  ? 'number'
                                  : 'text'
                            }
                            value={
                              field === 'uom_name'
                                ? (selectedInspection.uom_name || selectedInspection.uom_code || '')
                                : field === 'farm_origin' && !editing
                                  ? getFarmVendorDisplay(selectedInspection)
                                  : (selectedInspection[field] || '')
                            }
                            disabled={!editing || !editable}
                            onChange={(event) => updateSelectedField(field, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <div className="quality-form-grid qrev-meta-grid qrev-notes-grid">
                <label className="form-field quality-form-field--full">
                  <span>{t('quality.additionalNotes')}</span>
                  <textarea
                    className="app-input"
                    dir="auto"
                    rows={3}
                    value={selectedInspection.notes || ''}
                    disabled={!editing}
                    onChange={(event) => updateSelectedField('notes', event.target.value)}
                  />
                </label>
                <label className="form-field quality-form-field--full">
                  <span>{tx('quality.grpoComments', 'GRPO Comments')}</span>
                  <textarea
                    className="app-input"
                    dir="auto"
                    rows={3}
                    value={selectedInspection.grpo_comments || ''}
                    disabled
                  />
                </label>
              </div>

              <h4 className="qrev-section-title">{t('quality.excelMatrix')}</h4>
              <div className="excel-matrix-wrapper qrev-matrix-wrap">
                {editing ? (
                  <table className="excel-matrix-table qrev-matrix-table">
                    <thead>
                      <tr>
                        <th>{t('quality.defectCodeCategory')}</th>
                        {normalizeSamples(selectedInspection).map((sample, index) => (
                          <th key={sample.id || index}>
                            <div>S{index + 1}</div>
                            {sample.truck_number ? (
                              <div style={{ fontSize: '0.7rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                                {sample.truck_number}
                              </div>
                            ) : sample.truck_idx !== undefined ? (
                              <div style={{ fontSize: '0.7rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                                {t('quality.truckLabel', sample.truck_idx + 1)}
                              </div>
                            ) : null}
                          </th>
                        ))}
                        <th>{t('common.total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(DEFECT_CATEGORIES).map(([catKey, cat]) => (
                        <React.Fragment key={catKey}>
                          <tr className="qrev-category-row">
                            <td colSpan={normalizeSamples(selectedInspection).length + 2}>{t(cat.titleKey)}</td>
                          </tr>
                          {cat.items.map((item) => {
                            const samples = normalizeSamples(selectedInspection);
                            const total = samples.reduce((sum, sample) => sum + toNumber(sample.defects?.[item.key]), 0);
                            return (
                              <tr key={item.key}>
                                <td className="defect-row-header">{defectLabel(item)}</td>
                                {samples.map((sample, index) => (
                                  <td key={sample.id || index}>
                                    <input
                                      type="number"
                                      min="0"
                                      className="cell-input qrev-defect-input"
                                      value={sample.defects?.[item.key] || 0}
                                      onChange={(event) => updateSampleDefect(index, item.key, event.target.value)}
                                    />
                                  </td>
                                ))}
                                <td className="qrev-total-cell">{total}</td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))}
                      <tr className="totals-row">
                        <td className="defect-row-header">{t('quality.wasteTotal')}</td>
                        {normalizeSamples(selectedInspection).map((sample, index) => (
                          <td key={sample.id || index}>{AF_KEYS.reduce((sum, key) => sum + toNumber(sample.defects?.[key]), 0)}</td>
                        ))}
                        <td>{selectedInspection.af_waste_total}</td>
                      </tr>
                      <tr className="totals-row">
                        <td className="defect-row-header">{t('quality.qualityTotal')}</td>
                        {normalizeSamples(selectedInspection).map((sample, index) => (
                          <td key={sample.id || index}>{AG_KEYS.reduce((sum, key) => sum + toNumber(sample.defects?.[key]), 0)}</td>
                        ))}
                        <td>{selectedInspection.ag_quality_total}</td>
                      </tr>
                      <tr className="totals-row">
                        <td className="defect-row-header">{t('quality.grandTotal')}</td>
                        {normalizeSamples(selectedInspection).map((sample, index) => {
                          const sumS =
                            AF_KEYS.reduce((sum, key) => sum + toNumber(sample.defects?.[key]), 0) +
                            AG_KEYS.reduce((sum, key) => sum + toNumber(sample.defects?.[key]), 0) +
                            toNumber(sample.defects?.['grade_1']) +
                            toNumber(sample.defects?.['grade_2']);
                          return <td key={sample.id || index}>{sumS}</td>;
                        })}
                        <td>{selectedInspection.ah_grand_total}</td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <ExcelSummaryMatrix
                    totals={(() => {
                      const totals = {};
                      normalizeSamples(selectedInspection).forEach(sample => {
                        for (const key in sample.defects) {
                          totals[key] = (totals[key] || 0) + toNumber(sample.defects[key]);
                        }
                      });
                      return totals;
                    })()}
                    sumAH={selectedInspection.ah_grand_total}
                    sumAF={selectedInspection.af_waste_total}
                    sumAG={selectedInspection.ag_quality_total}
                    t={t}
                  />
                )}
              </div>

              {/* Trucks Breakdown Section (Review Mode) */}
              {!editing && Array.isArray(selectedInspection.samples_data) && selectedInspection.samples_data.length > 0 && 'samples' in selectedInspection.samples_data[0] && (
                <div style={{ marginTop: '24px', marginBottom: '24px' }}>
                  <h4 className="qrev-section-title">{t('quality.trucksBreakdown')}</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '16px', marginTop: '12px' }}>
                    {selectedInspection.samples_data.map((truck, trkIdx) => {
                      const trkMetrics = truck.metrics || calculateQualityMetrics(truck.samples || [], truck.sample_count);
                      return (
                        <div key={trkIdx} className="card-panel" style={{ border: '1px solid var(--border)', padding: '12px', borderRadius: '6px', fontSize: '0.85rem' }}>
                          <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border)', paddingBottom: '4px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>🚛 {tx('quality.truckLabel', `سيارة ${trkIdx + 1}`, trkIdx + 1)}: {truck.truck_number || '-'}</span>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>{t('quality.numSamples')}: {truck.sample_count}</span>
                          </div>
                          <div style={{ display: 'grid', gap: '4px', marginBottom: '8px' }}>
                            <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.contractor')}:</span> <strong>{truck.contractor_name || '-'}</strong></div>
                            <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.farm')}:</span> <strong>{getFarmVendorDisplay(truck) || '-'}</strong></div>
                          </div>
                          <div style={{ display: 'flex', gap: '12px', padding: '6px', backgroundColor: 'var(--color-bg-soft)', borderRadius: '4px' }}>
                            <div><strong>AF:</strong> {trkMetrics.sumAF}</div>
                            <div><strong>AG:</strong> {trkMetrics.sumAG}</div>
                            <div><strong>AH:</strong> {trkMetrics.sumAH}</div>
                          </div>
                          <div style={{ marginTop: '6px' }}>
                            <strong>{t('quality.qaDecision')}: </strong>
                            <span style={{ color: trkMetrics.decision.includes('Rejected') ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>
                              {t(`quality.decisions.${trkMetrics.decision}`) || trkMetrics.decision}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="qrev-summary-grid">
                <div className="qrev-summary-box">
                  <span>{t('quality.averageDefects')}</span>
                  <strong>{selectedInspection.average_defects_per_sample}</strong>
                </div>
                <div className="qrev-summary-box">
                  <span>{t('quality.pctBruisesCuts')}</span>
                  <strong>{selectedInspection.combined_bruises_cuts_percentage}%</strong>
                </div>
                <div className="qrev-summary-box">
                  <span>{t('quality.pctHighCut')}</span>
                  <strong>{selectedInspection.high_cut_percentage}%</strong>
                </div>
                <div className="qrev-summary-box qrev-summary-box--decision">
                  <span>{t('quality.qaDecision')}</span>
                  <strong>{t(`quality.decisions.${selectedInspection.decision}`) || selectedInspection.decision}</strong>
                </div>
              </div>

              {selectedInspection.status === 'FAILED' && selectedInspection.sap_error && (
                <div className="feedback-message feedback-message--error">
                  <strong>{t('common.error')}:</strong> {selectedInspection.sap_error}
                </div>
              )}
              {selectedInspection.status === 'REJECTED' && selectedInspection.rejection_reason && (
                <div className="feedback-message feedback-message--info">
                  <strong>{t('quality.rejectionReason')}:</strong> {selectedInspection.rejection_reason}
                </div>
              )}

              {adminUser && ['PENDING_REVIEW', 'FAILED'].includes(selectedInspection.status) && (
                <label className="form-field qrev-warehouse-field">
                  <span>{t('quality.releaseWarehouseLabel')}</span>
                  <SearchableSelect
                    className="app-input"
                    searchSource={warehouseSearch}
                    value={selectedWarehouse}
                    onChange={(event) => setSelectedWarehouse(event.target.value)}
                    disabled={isActioning}
                    placeholder={t('quality.releaseWarehouseDefault')}
                  >
                    <option value="">{t('quality.releaseWarehouseDefault')}</option>
                    {warehouses.map((warehouse) => {
                      const code = warehouse.WarehouseCode || warehouse.code;
                      const name = warehouse.WarehouseName || warehouse.name;
                      return <option key={code} value={code}>{code} - {name}</option>;
                    })}
                  </SearchableSelect>
                </label>
              )}
            </div>

            <div className="qrev-dialog__footer">
              {canReview(selectedInspection) && (
                <button type="button" className="app-button app-button--success qrev-dialog__approve" onClick={() => handleApprove(selectedInspection)} disabled={isActioning}>
                  {t('quality.approve')}
                </button>
              )}
              <button type="button" className="app-button app-button--secondary" onClick={() => setEditing((value) => !value)}>
                {editing ? t('common.cancel') : t('quality.editInspection')}
              </button>
              {editing && (
                <button type="button" className="app-button app-button--primary" onClick={() => persistLocalEdit(selectedInspection)}>
                  {t('common.saveChanges')}
                </button>
              )}
              <PrintActionButton onClick={() => printInspection(selectedInspection)} title="Print Inspection" />
              {canReview(selectedInspection) && (
                <button type="button" className="app-button app-button--danger qrev-dialog__delete" onClick={() => requestDelete(selectedInspection)} disabled={isActioning}>
                  {t('quality.delete') || 'Delete'}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {inspectionsToPrint.length > 0 && (
        <div className="qrev-print-report" aria-hidden="true" style={{ display: 'none' }} ref={printContainerRef}>
          {inspectionsToPrint.map((reportInspection, idx) => (
            <div 
              key={reportInspection.id} 
              className="a4-print-sheet quality-print-sheet" 
              style={{ pageBreakAfter: idx < inspectionsToPrint.length - 1 ? 'always' : 'auto', position: 'relative', width: '100%', minHeight: '297mm', boxSizing: 'border-box' }}
            >
          <QualityPrintHeader reportNumber={`EGAST-QA-${reportInspection.batch_number}`} review />

          {/* Metadata Grid */}
          <h3 className="report-section-header quality-section-header">بيانات المراجعة</h3>
          <div className="report-info-grid">
            <div className="info-cell"><span className="cell-lbl">تاريخ الفحص:</span> <strong>{reportInspection.inspection_date || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">المفتش المسؤول:</span> <strong>{reportInspection.inspector_name || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">مدخل البيانات:</span> <strong>{reportInspection.data_clerk_name || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">المورد:</span> <strong>{reportInspection.supplier_name || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">المزرعة / المنشأ:</span> <strong>{getFarmVendorDisplay(reportInspection) || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">المقاول:</span> <strong>{reportInspection.contractor_name || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">رقم السيارة:</span> <strong>{reportInspection.car_number || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">المحصول:</span> <strong>{reportInspection.crop_name || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">نوع المادة الخام:</span> <strong>{reportInspection.raw_material_type || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">رقم التشغيلة:</span> <strong>{reportInspection.batch_number || '-'}</strong></div>
            <div className="info-cell"><span className="cell-lbl">إجمالي العينات المفحوصة:</span> <strong>{normalizeSamples(reportInspection).length} عينات</strong></div>
          </div>

          {/* Mini KPIs Dashboard inside printed document */}
          <h3 className="report-section-header quality-section-header">ملخص الجودة</h3>
          <div className="report-kpi-row">
            <div className="kpi-mini-box">
              <span className="kpi-lbl">إجمالي العينات</span>
              <strong>{normalizeSamples(reportInspection).length}</strong>
            </div>
            <div className="kpi-mini-box">
              <span className="kpi-lbl">إجمالي الوحدات المفحوصة</span>
              <strong>{reportInspection.ah_grand_total} وحدة</strong>
            </div>
            <div className="kpi-mini-box">
              <span className="kpi-lbl">العيب الأكثر شيوعاً</span>
              <strong>{(() => {
                const defectTotals = {};
                normalizeSamples(reportInspection).forEach(sample => {
                  for (const key in sample.defects) {
                    const qty = Number(sample.defects[key] || 0);
                    if (qty > 0) {
                      defectTotals[key] = (defectTotals[key] || 0) + qty;
                    }
                  }
                });
                let maxDefectKey = null;
                let maxQty = -1;
                for (const key in defectTotals) {
                  if (defectTotals[key] > maxQty && defectTotals[key] > 0) {
                    maxQty = defectTotals[key];
                    maxDefectKey = key;
                  }
                }
                if (maxDefectKey) {
                  return `${tx('quality.defects.' + maxDefectKey, maxDefectKey)} (${maxQty} وحدة)`;
                }
                return "لا يوجد عيوب";
              })()}</strong>
            </div>
            <div className={`kpi-mini-box kpi-mini-box--status ${reportInspection.decision.includes('Rejected') ? 'status-rejected' : 'status-accepted'}`}>
              <span className="kpi-lbl">قرار الجودة النهائي</span>
              <strong>{t(`quality.decisions.${reportInspection.decision}`) || reportInspection.decision}</strong>
            </div>
          </div>

          {/* Trucks Breakdown Section */}
          {Array.isArray(reportInspection.samples_data) && reportInspection.samples_data.length > 0 && 'samples' in reportInspection.samples_data[0] && (
            <div className="print-trucks-section no-break" style={{ marginTop: '20px', pageBreakBefore: 'auto' }}>
              <h3 className="report-section-header">{t('quality.trucksBreakdown')}</h3>
              {reportInspection.samples_data.map((truck, trkIdx) => {
                const trkDefectTotals = {};
                (truck.samples || []).forEach((sample) => {
                  for (const key in sample.defects) {
                    trkDefectTotals[key] = (trkDefectTotals[key] || 0) + Number(sample.defects[key] || 0);
                  }
                });
                
                return (
                  <div key={trkIdx} className="print-truck-card" style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '12px', marginBottom: '16px', pageBreakInside: 'avoid' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '1rem' }}>
                        🚛 {tx('quality.truckLabel', `سيارة ${trkIdx + 1}`, trkIdx + 1)}: {truck.truck_number || '-'}
                      </strong>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {t('quality.numSamples')}: {truck.sample_count}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', fontSize: '0.85rem', marginBottom: '8px' }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.contractor')}:</span> <strong>{truck.contractor_name || '-'}</strong></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.farm')}:</span> <strong>{getFarmVendorDisplay(truck) || '-'}</strong></div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '15px', fontSize: '0.85rem', padding: '6px', backgroundColor: 'var(--color-bg-soft)', borderRadius: '4px', marginBottom: '8px' }}>
                      <div><strong>AF:</strong> {truck.metrics?.sumAF || 0}</div>
                      <div><strong>AG:</strong> {truck.metrics?.sumAG || 0}</div>
                      <div><strong>AH:</strong> {truck.metrics?.sumAH || 0}</div>
                      <div>
                        <strong>{t('quality.qaDecision')}:</strong>{' '}
                        <span style={{ color: truck.metrics?.decision?.includes('Rejected') ? 'var(--danger)' : 'var(--success)' }}>
                          {t(`quality.decisions.${truck.metrics?.decision}`) || truck.metrics?.decision || '-'}
                        </span>
                      </div>
                    </div>

                    {/* Defect items list for this truck */}
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', marginTop: '6px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '4px', textAlign: 'right' }}>{t('quality.sampleNumber')}</th>
                          <th style={{ padding: '4px', textAlign: 'right' }}>{t('quality.breakdown')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(truck.samples || []).map((s, sIdx) => {
                          const activeDefects = Object.entries(s.defects)
                            .filter(([, qty]) => qty > 0)
                            .map(([k, qty]) => `${tx('quality.defects.' + k, k)} (${qty})`);
                          return (
                            <tr key={sIdx} style={{ borderBottom: '1px dashed var(--border)' }}>
                              <td style={{ padding: '4px' }}>{t('quality.sampleLabel', sIdx + 1)}</td>
                              <td style={{ padding: '4px' }}>
                                {activeDefects.length > 0 ? activeDefects.join(', ') : t('quality.noDefectsRecorded')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="report-section-header">جدول تحليل ونسب العيوب المكتشفة</h3>
          <ExcelSummaryMatrix
            totals={(() => {
              const defectTotals = {};
              normalizeSamples(reportInspection).forEach(sample => {
                for (const key in sample.defects) {
                  defectTotals[key] = (defectTotals[key] || 0) + toNumber(sample.defects[key]);
                }
              });
              return defectTotals;
            })()}
            sumAH={reportInspection.ah_grand_total}
            sumAF={reportInspection.af_waste_total}
            sumAG={reportInspection.ag_quality_total}
            t={t}
          />

          {reportInspection.notes && (
            <div className="print-notes-box">
              <strong>توصيات ضبط الجودة وملاحظات الاستلام الفنية:</strong>
              <p>{reportInspection.notes}</p>
            </div>
          )}

          {/* Signatures pad */}
          <div className="report-signature-row">
            <div className="sig-column">
              <p>توقيع مفتش الجودة المسؤول:</p>
              <div className="sig-line"></div>
              <span className="sig-date-placeholder">التاريخ: .... / .... / ...........</span>
            </div>
            <div className="sig-column">
              <p>اعتماد مدير إدارة الجودة والمخازن:</p>
              <div className="sig-line"></div>
              <span className="sig-date-placeholder">التاريخ: .... / .... / ...........</span>
            </div>
          </div>

          {/* Document Footer */}
          <div className="report-print-footer">
            <span className="report-print-footer-brand">
              الشركة المصرية للخدمات الزراعية (إيجاست) · تقرير مراجعة الجودة
            </span>
            <span className="report-print-footer-meta">
              EGAST Quality Assurance System
            </span>
          </div>
            </div>
          ))}
        </div>
      )}

      {showDeleteModal && (
        <>
          <div className="rr-dialog-backdrop" onClick={() => { setShowDeleteModal(false); setDeletingInspection(null); }} />
          <div className="rr-dialog">
            <h3 className="rr-dialog__title">
              Delete Inspection
            </h3>
            <p style={{ margin: '16px 0', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
              Are you sure you want to permanently delete this inspection?
            </p>
            <div className="rr-dialog__actions">
              <button
                type="button"
                className="app-button app-button--danger rr-dialog__btn-confirm"
                onClick={handleDelete}
                disabled={isActioning}
              >
                {isActioning ? 'Deleting...' : 'Delete'}
              </button>
              <button
                type="button"
                className="app-button app-button--secondary rr-dialog__btn-cancel"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletingInspection(null);
                }}
                disabled={isActioning}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </>
      )}

      {showBulkDeleteModal && (
        <>
          <div className="rr-dialog-backdrop" onClick={() => setShowBulkDeleteModal(false)} />
          <div className="rr-dialog">
            <h3 className="rr-dialog__title">Bulk Delete</h3>
            <p style={{ margin: '16px 0', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
              Delete {selectedIds.length} selected inspections?
            </p>
            <div className="rr-dialog__actions">
              <button
                type="button"
                className="app-button app-button--danger rr-dialog__btn-confirm"
                onClick={handleBulkDelete}
                disabled={isActioning}
              >
                {isActioning ? 'Deleting...' : 'Delete'}
              </button>
              <button
                type="button"
                className="app-button app-button--secondary rr-dialog__btn-cancel"
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={isActioning}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default QualityReviewPage;
