import { warehouseSearch, farmSearch, itemSearch, binSearch as remoteBinSearch } from '../services/masterDataSearch';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Step, StepButton, StepLabel, Stepper } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import API from '../services/api';
import { cachedSearch } from '../services/searchCache';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canAccessGrpo, canManageGrpo } from '../utils/roles';
import { useToast } from '../components/ui/ToastProvider';
import SearchableSelect from '../components/ui/SearchableSelect';
import useCostCenterOptions from '../hooks/useCostCenterOptions';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import PrintDocumentBarcode from '../components/print/PrintDocumentBarcode';
import { prepareShippingReceivingPrintRecord } from '../utils/shippingReceivingPrintIdentifiers';
import egastLogo from '../assets/logos/egast-logo.png';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import {
  checkBatchDetails,
  createManualReceivingRequest,
  loadPurchaseGRPODraft,
  loadQualityItemGroups,
  loadTaxCodes,
  previewPurchaseGRPOPosting,
  postPurchaseGRPODraftToSAP,
  savePurchaseGRPODraft,
} from '../services/purchaseGrpoService';
import { getProductIcon } from '../utils/productIcon';
import '../styles/pages/receipt-review.css';
import '../styles/pages/quality-inspection.css';

// ── brand images auto-discovered ───────────────────────────────────────────
const _brandGlob = import.meta.glob('../assets/brands/*', { eager: true });
const BRAND_IMAGES = Object.fromEntries(
  Object.entries(_brandGlob).map(([path, mod]) => {
    const name = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
    return [name, mod.default];
  })
);
const getBrandImage = (val) => {
  if (!val) return null;
  const key = String(val).toLowerCase().trim().replace(/\s+/g, '-');
  return BRAND_IMAGES[key] ?? BRAND_IMAGES[key.replace(/-/g, '')] ?? null;
};

function BrandAvatar({ src, label, selected }) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !src || imgError;
  const initial = (label || '?').charAt(0).toUpperCase();
  const avatarCls = showFallback
    ? `brand-avatar ${selected ? 'brand-avatar--fallback-sel' : 'brand-avatar--fallback'}`
    : 'brand-avatar brand-avatar--img';
  return (
    <div className={avatarCls}>
      {!showFallback ? (
        <img src={src} alt={label} className="brand-avatar__img" onError={() => setImgError(true)} />
      ) : (
        <span className={`brand-avatar__initial ${selected ? 'brand-avatar__initial--selected' : 'brand-avatar__initial--default'}`}>
          {initial}
        </span>
      )}
    </div>
  );
}

const ATTR_FIELDS = [
  { key: 'vendor',              stateKey: 'vendor',              labelKey: 'quality.batchAttrs.vendor',          label: 'Vendor' },
  { key: 'part',                stateKey: 'part',                labelKey: 'quality.batchAttrs.part',            label: 'Part' },
  { key: 'company',             stateKey: 'company',             labelKey: 'quality.batchAttrs.company',         label: 'Company' },
  { key: 'season',              stateKey: 'season',              labelKey: 'quality.batchAttrs.season',          label: 'Season' },
  { key: 'batch_attribute_1',   stateKey: 'batch_attribute_1',   labelKey: 'quality.batchAttrs.batchAttribute1', label: 'Batch Attribute 1', text: true },
  { key: 'batch_attribute_2',   stateKey: 'batch_attribute_2',   labelKey: 'quality.batchAttrs.batchAttribute2', label: 'Batch Attribute 2', text: true },
];

const makeBatchId = () => `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const EDITABLE_STATUSES = new Set(['DRAFT', 'POSTING_FAILED']);

const STANDARD_GRPO_STEPS = [
  { id: 'item', labelKey: 'quality.grpoSteps.item', icon: '1', continuousIndex: 1 },
  { id: 'warehouse', labelKey: 'quality.grpoSteps.warehouse', icon: '2', continuousIndex: 2 },
  { id: 'operational', labelKey: 'quality.grpoSteps.operational', icon: '3', continuousIndex: 3 },
  { id: 'batches', labelKey: 'quality.grpoSteps.batches', icon: '4', continuousIndex: 4 },
  { id: 'review', labelKey: 'grpo.reviewStep', icon: '5', continuousIndex: 5 },
];

const MANUAL_INTAKE_STEPS = [
  { id: 'vehicle', labelKey: 'quality.manualSteps.vehicle', icon: '1', continuousIndex: 1 },
  { id: 'supplier', labelKey: 'quality.manualSteps.supplier', icon: '2', continuousIndex: 2 },
  { id: 'product', labelKey: 'quality.manualSteps.product', icon: '3', continuousIndex: 3 },
  { id: 'warehouse', labelKey: 'quality.manualSteps.warehouse', icon: '4', continuousIndex: 4 },
  { id: 'item_warehouse', labelKey: 'quality.grpoSteps.manualItemWarehouse', icon: '5', continuousIndex: 5 },
  { id: 'operational', labelKey: 'quality.grpoSteps.operational', icon: '6', continuousIndex: 6 },
  { id: 'intake_review', labelKey: 'quality.manualSteps.review', icon: '7', continuousIndex: 7 },
  { id: 'batch', labelKey: 'quality.manualSteps.batch', icon: '8', continuousIndex: 8 },
  { id: 'batches', labelKey: 'quality.grpoSteps.batches', icon: '9', continuousIndex: 9 },
  { id: 'review', labelKey: 'grpo.reviewStep', icon: '10', continuousIndex: 10 },
];

const CONTINUOUS_GRPO_STEPS = MANUAL_INTAKE_STEPS;

const NORMAL_STEP_FIELD_MAP = {
  0: ['item_code', 'item_name', 'quantity', 'unit_price', 'uom_code', 'tax_code', 'discount_percent', 'location', 'general'],
  1: ['warehouse_code', 'bin_code', 'bin_abs_entry'],
  2: ['container_quantity', 'car_number', 'posting_date', 'document_date', 'due_date', 'vendor_ref_no', 'journal_remark', 'comments'],
  3: ['batches'],
  4: [],
};

const MANUAL_INTAKE_STEP_FIELD_MAP = {
  0: ['car_number', 'container_quantity'],
  1: ['vendor_card_code', 'vendor_name'],
  2: ['item_group_code', 'item_code', 'quantity'],
  3: ['warehouse_code', 'bin_code', 'bin_abs_entry'],
  4: ['item_code', 'item_name', 'quantity', 'unit_price', 'uom_code', 'tax_code', 'discount_percent', 'location', 'general', 'warehouse_code', 'bin_code', 'bin_abs_entry'],
  5: ['container_quantity', 'car_number', 'posting_date', 'document_date', 'due_date', 'vendor_ref_no', 'journal_remark', 'comments'],
  6: [],
  7: ['batch_number', 'manufacturing_date', 'admission_date'],
  8: ['batches'],
  9: [],
};

const fmtValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return '-';
  return value;
};

const toFormValue = (value) => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const getTodayLocalDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createDraftForm = (draft = {}) => ({
  vendor_card_code: toFormValue(draft.vendor_card_code),
  vendor_name: toFormValue(draft.vendor_name),
  farm_origin: toFormValue(draft.farm_origin || draft.vendor_card_code),
  contractor_name: toFormValue(draft.contractor_name),
  contractor_code: toFormValue(draft.contractor_code),
  scale_draft_id: toFormValue(draft.scale_draft_id),
  item_group_code: toFormValue(draft.item_group_code),
  posting_date: toFormValue(draft.posting_date) || getTodayLocalDate(),
  document_date: toFormValue(draft.document_date) || getTodayLocalDate(),
  due_date: toFormValue(draft.due_date) || getTodayLocalDate(),
  vendor_ref_no: toFormValue(draft.vendor_ref_no || draft?.inspection_context?.vendor_ref_no),
  journal_remark: toFormValue(draft.journal_remark || draft?.inspection_context?.journal_remark),
  comments: toFormValue(draft.comments),
  location: toFormValue(draft.location),
  general: toFormValue(draft.general),
  quantity: toFormValue(draft.quantity),
  container_quantity: toFormValue(
    draft.container_quantity !== undefined && draft.container_quantity !== null
      ? draft.container_quantity
      : (draft?.inspection_context?.container_quantity ?? '0')
  ),
  warehouse_code: toFormValue(draft.warehouse_code),
  unit_price: toFormValue(draft.unit_price),
  tax_code: toFormValue(draft.tax_code),
  discount_percent: draft.discount_percent === null || draft.discount_percent === undefined
    ? '0'
    : String(draft.discount_percent),
  batch_number: toFormValue(draft.batch_number),
  manufacturing_date: toFormValue(draft.manufacturing_date) || getTodayLocalDate(),
  admission_date: toFormValue(draft.admission_date) || getTodayLocalDate(),
  expiry_date: toFormValue(draft.expiry_date),
  bin_code: toFormValue(draft.bin_code),
  bin_abs_entry: toFormValue(draft.bin_abs_entry),
  car_number: toFormValue(draft?.inspection_context?.car_number || draft.car_number),
  item_code: toFormValue(draft.item_code),
  item_name: toFormValue(draft.item_name),
  raw_material_type: toFormValue(draft.raw_material_type),
  uom_code: toFormValue(draft.uom_code),
  uom_name: toFormValue(draft.uom_name),
});

const nullable = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

const decimalOrNull = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

const hasValue = (value) => String(value ?? '').trim() !== '';

const formatPostedAt = (value) => {
  if (!hasValue(value)) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const datePart = new Intl.DateTimeFormat('ar-EG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return `${datePart} - ${timePart}`;
};

function GrpoStepIcon({ icon, active, completed }) {
  const className = [
    'quality-mui-step-icon',
    active ? 'quality-mui-step-icon--active' : '',
    completed ? 'quality-mui-step-icon--completed' : '',
  ].filter(Boolean).join(' ');

  return <span className={className}>{completed ? '✓' : icon}</span>;
}

function ContinuousPhaseTracker({ activeStep, draft, t }) {
  const getWorkflowDesc = () => {
    const truck = draft?.inspection_context?.car_number || draft?.car_number;
    const qty = draft?.quantity;
    const uom = draft?.uom_name || draft?.uom_code || '';
    const batch = draft?.batch_number;
    const details = [];
    if (truck) details.push(`${t('grpo.carNumber')}: ${truck}`);
    if (qty) details.push(`${t('grpo.quantityLabel')}: ${qty} ${uom}`);
    if (batch) details.push(`${t('quality.batchNumber')}: ${batch}`);

    const stepProgress = t('grpo.continuousStepProgress', activeStep + 1);
    return details.length > 0 ? `${stepProgress} • ${details.join(' • ')}` : stepProgress;
  };

  return (
    <section className="continuous-phase-tracker" aria-label={t('grpo.continuousWorkflow')}>
      <div className="continuous-phase-card continuous-phase-card--active">
        <div className="continuous-phase-card__top">
          <span className="continuous-phase-badge">
            {t('grpo.manualIntakePhaseBadge')}
          </span>
          <span className="continuous-phase-step-pill">{t('grpo.steps1to10')}</span>
        </div>
        <div className="continuous-phase-card__info">
          <h2 className="continuous-phase-title">{t('grpo.manualPhaseTitle')}</h2>
          <p className="continuous-phase-desc">{getWorkflowDesc()}</p>
        </div>
      </div>
    </section>
  );
}

function PurchaseGRPODraftPage({ postedViewOnly = false, manualCreate = false }) {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();

  const isStandaloneGrpo = location.pathname.startsWith('/grpo');
  const handleBack = useCallback(() => {
    if (isStandaloneGrpo) {
      if (location.pathname.startsWith('/grpo/documents') || location.state?.from === '/grpo/review') {
        navigate('/grpo/review');
      } else {
        navigate('/grpo');
      }
    } else {
      navigate('/quality-review');
    }
  }, [isStandaloneGrpo, location.pathname, location.state, navigate]);

  const [draft, setDraft] = useState(null);
  const [form, setForm] = useState(createDraftForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const warehousesLoading = false;
  const [binLocations, setBinLocations] = useState([]);
  const [binsLoading, setBinsLoading] = useState(false);
  const [binManaged, setBinManaged] = useState(false);
  const binProbeScope = JSON.stringify([user?.id, user?.role, user?.module_permissions]);
  useEffect(() => {
    let current = true;
    Promise.resolve().then(async () => {
      if (!current) return;
      setBinLocations([]);
      setBinManaged(false);
      if (!form.warehouse_code) { setBinsLoading(false); return; }
      setBinsLoading(true);
      try {
        const rows = await cachedSearch(`bin-probe:${binProbeScope}:${form.warehouse_code}`, async () => {
          const response = await API.get(`/bin-locations/${encodeURIComponent(form.warehouse_code)}/`, { params: { lookup: 1, probe: 1 } });
          return response.data?.data?.locations || [];
        });
        if (current) setBinManaged(rows.length > 0);
      } finally { if (current) setBinsLoading(false); }
    }).catch(() => { /* Discovery errors remain visible when searching; no bin is substituted. */ });
    return () => { current = false; };
  }, [form.warehouse_code, binProbeScope]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [approving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postingPreview, setPostingPreview] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);
  const [creatingManual, setCreatingManual] = useState(false);

  // SAP Master Data state for Manual Receiving
  const [itemGroups, setItemGroups] = useState([]);
  const [itemGroupsLoading, setItemGroupsLoading] = useState(false);
  const [itemsByGroup, setItemsByGroup] = useState({});
  const itemsLoading = false;
  const [farms, setFarms] = useState([]);
  const farmsLoading = false;
  const [farmGroupFilter, setFarmGroupFilter] = useState('all');
  const [checkingBatch, setCheckingBatch] = useState(false);

  // SAP Cost Centers (Dimension 1: Location, Dimension 2: General)
  const {
    costCentersDim1,
    costCentersDim2,
    costCentersLoading,
    costCenterError1,
    costCenterError2,
    reloadCostCenter,
  } = useCostCenterOptions();
  const [taxCodes, setTaxCodes] = useState([]);
  const [taxCodesLoading, setTaxCodesLoading] = useState(false);

  // GRPO Multi-Batch & 11 Attributes State
  const [batches, setBatches] = useState([]);
  const [batchSubSteps, setBatchSubSteps] = useState({});
  const [batchAttrIdx, setBatchAttrIdx] = useState({});
  const [batchUdfMetadata, setBatchUdfMetadata] = useState({});
  const [batchAttributes, setBatchAttributes] = useState({});
  const [batchAttributesLoading, setBatchAttributesLoading] = useState(false);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [printingRecord, setPrintingRecord] = useState(null);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const isPosted = draft?.status === 'POSTED';
  const isInvalidPostedDocumentView = postedViewOnly && draft && !isPosted;
  const isManualDraft = draft?.inspection_context?.is_manual === true;
  const isManualCreate = Boolean(manualCreate) && !draft;
  const isManual = isManualCreate || isManualDraft;
  const canEdit = !postedViewOnly && Boolean(isManualCreate || (draft && EDITABLE_STATUSES.has(draft.status)));
  canManageGrpo(user) && draft && EDITABLE_STATUSES.has(draft.status);
  const canPostToSap = canAccessGrpo(user) && Boolean(draft && (EDITABLE_STATUSES.has(draft.status) || draft.status === 'APPROVED_FOR_POSTING'));
  const hasSapDocumentInfo = draft?.status === 'POSTED' || hasValue(draft?.sap_doc_entry) || hasValue(draft?.sap_doc_num);
  const wizardSteps = isManual
    ? MANUAL_INTAKE_STEPS
    : STANDARD_GRPO_STEPS;
  const stepFieldMap = isManual
    ? MANUAL_INTAKE_STEP_FIELD_MAP
    : NORMAL_STEP_FIELD_MAP;
  const reviewIndex = wizardSteps.length - 1;
  const itemIndex = isManual ? 4 : 0;
  const warehouseIndex = isManual ? -1 : 1;
  const operationalIndex = isManual ? 5 : 2;
  const batchesIndex = isManual ? 8 : 3;

  const selectedBin = useMemo(
    () => binLocations.find((bin) => bin.code === form.bin_code),
    [binLocations, form.bin_code],
  );

  const firstErrorStep = useCallback((nextErrors) => {
    for (const [stepIndex, fields] of Object.entries(stepFieldMap)) {
      if (fields.some((field) => nextErrors[field])) return Number(stepIndex);
    }
    return activeStep;
  }, [activeStep, stepFieldMap]);

  const statusLabel = useCallback((status) => {
    if (!status) return fmtValue(status);
    return t(`quality.grpoStatuses.${status}`);
  }, [t]);

  const getCostCenterDisplay = useCallback((code, list) => {
    const trimmed = String(code || '').trim();
    if (!trimmed) return '-';
    const found = (Array.isArray(list) ? list : []).find((item) => item.code === trimmed);
    if (found && found.name && found.name !== trimmed) {
      return `${trimmed} - ${found.name}`;
    }
    return trimmed;
  }, []);

  const createDefaultBatch = useCallback((f, qty, index = 1) => ({
    id: makeBatchId(),
    batch_number: f.batch_number ? (index === 1 ? f.batch_number : `${f.batch_number}-${index}`) : '',
    quantity: qty !== undefined && qty !== null ? String(qty) : (f.quantity || '0'),
    bin_location_code: f.bin_code || '',
    bin_abs_entry: f.bin_abs_entry || '',
    manufacturing_date: f.manufacturing_date || getTodayLocalDate(),
    admission_date: f.admission_date || getTodayLocalDate(),
    expiry_date: f.expiry_date || '',
    size: '',
    brand: '',
    category: '',
    packing: '',
    season: '',
    extra_specification: '',
    vendor: f.vendor_name || f.vendor_card_code || '',
    part: '',
    company: '',
    number: '',
    details: '',
    batch_attribute_1: '',
    batch_attribute_2: '',
  }), []);

  const getBatchFieldOptions = useCallback((fieldKey, ...[, fallbackOptions = []]) => {
    const stored = (batchAttributes.field_options?.[fieldKey] || []).map((i) => ({
      value: i.value,
      label: i.description && i.description !== i.value ? `${i.value} - ${i.description}` : i.value,
    }));
    const meta = (batchUdfMetadata[fieldKey]?.valid_values || []).map((i) => ({
      value: i.value,
      label: i.description && i.description !== i.value ? `${i.value} - ${i.description}` : i.value,
    }));
    const fallbacks = fallbackOptions
      .map((i) => (typeof i === 'string' ? { value: i, label: i } : { value: i.value ?? i.code ?? '', label: i.label ?? i.name ?? i.value ?? '' }))
      .filter((i) => i.value);
    const pool = [...stored, ...meta, ...fallbacks];
    const seen = new Set();
    const merged = pool.filter((i) => {
      if (!i?.value || seen.has(i.value)) return false;
      seen.add(i.value);
      return true;
    });
    return merged;
  }, [batchAttributes.field_options, batchUdfMetadata]);

  const requiredQty = Number(form.quantity || 0);
  const totalAllocated = useMemo(
    () => batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0),
    [batches],
  );
  const remainingBalance = useMemo(
    () => Math.round((requiredQty - totalAllocated) * 1000) / 1000,
    [requiredQty, totalAllocated],
  );
  const isBalanced = useMemo(
    () => Math.abs(remainingBalance) < 0.001,
    [remainingBalance],
  );

  const handleAddBatch = () => {
    const remaining = Math.max(0, remainingBalance);
    const newBatch = createDefaultBatch(form, remaining, batches.length + 1);
    setBatches((prev) => [...prev, newBatch]);
    setBatchSubSteps((s) => ({ ...s, [newBatch.id]: 0 }));
    setBatchAttrIdx((s) => ({ ...s, [newBatch.id]: 0 }));
  };

  const handleDuplicateBatch = (sourceBatch) => {
    const remaining = Math.max(0, remainingBalance);
    const newId = makeBatchId();
    const duplicated = {
      ...sourceBatch,
      id: newId,
      batch_number: sourceBatch.batch_number ? `${sourceBatch.batch_number}-copy` : '',
      quantity: remaining > 0 ? String(remaining) : '0',
    };
    setBatches((prev) => [...prev, duplicated]);
    setBatchSubSteps((s) => ({ ...s, [newId]: 0 }));
    setBatchAttrIdx((s) => ({ ...s, [newId]: 0 }));
  };

  const handleRemoveBatch = (batchId) => {
    if (batches.length <= 1) return;
    setBatches((prev) => prev.filter((b) => b.id !== batchId));
  };

  const handleBatchChange = (batchId, key, value) => {
    setBatches((prev) => {
      if (prev.length > 0 && prev[0].id === batchId) {
        setForm((f) => ({ ...f, [key]: value }));
      }
      return prev.map((b) => {
        if (b.id !== batchId) return b;
        return {
          ...b,
          [key]: value,
          ...(key === 'extra_specification' ? { extraSpecification: value } : {}),
          ...(key === 'extraSpecification' ? { extra_specification: value } : {}),
        };
      });
    });
  };

  // Batch UDF Metadata and Company Options on mount
  useEffect(() => {
    let cancelled = false;
    API.get('/batch-udf-metadata/')
      .then((res) => {
        if (!cancelled && res.data?.data?.fields) {
          setBatchUdfMetadata(res.data.data.fields);
        }
      })
      .catch((err) => {
        console.warn('fetch-batch-udf-metadata failed:', err?.response?.data || err.message);
      });

    API.get('/company-options/')
      .then((res) => {
        if (!cancelled) {
          const raw = res.data;
          const list =
            Array.isArray(raw?.companies) ? raw.companies :
            Array.isArray(raw?.data?.companies) ? raw.data.companies :
            [];
          setCompanyOptions(list.map((c) => ({ value: c.value ?? c, label: c.label ?? c.value ?? c })));
        }
      })
      .catch((err) => {
        console.warn('fetch-company-options failed:', err?.response?.data || err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Item Batch Attributes when item_code is present
  const currentItemCode = form.item_code || draft?.item_code;
  useEffect(() => {
    let cancelled = false;
    if (!currentItemCode) return;
    setBatchAttributesLoading(true);
    API.get(`/item-batch-attributes/${currentItemCode}/`)
      .then((res) => {
        if (!cancelled) {
          setBatchAttributes(res.data?.data || res.data || {});
        }
      })
      .catch((err) => {
        console.warn('fetch item-batch-attributes failed:', err?.response?.data || err.message);
      })
      .finally(() => {
        if (!cancelled) setBatchAttributesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentItemCode]);

  const loadDraft = useCallback(async () => {
    setLoading(true);
    try {
      const nextDraft = await loadPurchaseGRPODraft(draftId);
      setDraft(nextDraft);
      const nextForm = createDraftForm(nextDraft || {});
      setForm(nextForm);
      setErrors({});
      setPostingPreview(null);
      if (Array.isArray(nextDraft?.batches) && nextDraft.batches.length > 0) {
        setBatches(nextDraft.batches.map((b) => ({
          id: b.batch_id || b.id || makeBatchId(),
          batch_number: toFormValue(b.batch_number),
          quantity: toFormValue(b.quantity),
          bin_location_code: toFormValue(b.bin_location_code || b.bin_code),
          bin_abs_entry: toFormValue(b.bin_abs_entry || b.binAbsEntry),
          manufacturing_date: toFormValue(b.manufacturing_date),
          admission_date: toFormValue(b.admission_date),
          expiry_date: toFormValue(b.expiry_date),
          size: toFormValue(b.size),
          brand: toFormValue(b.brand),
          category: toFormValue(b.category),
          packing: toFormValue(b.packing),
          season: toFormValue(b.season),
          extra_specification: toFormValue(b.extra_specification),
          vendor: toFormValue(b.vendor),
          part: toFormValue(b.part),
          company: toFormValue(b.company),
          number: toFormValue(b.number),
          details: toFormValue(b.details),
          batch_attribute_1: toFormValue(b.batch_attribute_1),
          batch_attribute_2: toFormValue(b.batch_attribute_2),
        })));
      } else {
        setBatches([createDefaultBatch(nextForm, nextDraft?.quantity)]);
      }
      const isManualReceiving = nextDraft?.inspection_context?.is_manual === true;
      if (nextDraft?.status === 'POSTED') {
        const lastStep = (isManualReceiving ? MANUAL_INTAKE_STEPS.length : STANDARD_GRPO_STEPS.length) - 1;
        setActiveStep(lastStep);
        setMaxReachedStep(lastStep);
      } else if (location.state?.activeStep !== undefined) {
        const targetStep = location.state.activeStep;
        setActiveStep(targetStep);
        setMaxReachedStep((prev) => Math.max(prev, targetStep));
      } else if (isManualReceiving) {
        setActiveStep(4);
        setMaxReachedStep(4);
      } else {
        setActiveStep(0);
        setMaxReachedStep(0);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.error || t('quality.grpoDraftLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [draftId, toast, t, createDefaultBatch, location.state]);

  useEffect(() => {
    if (manualCreate) {
      setLoading(false);
      setActiveStep(0);
      setMaxReachedStep(0);
      setBatches([createDefaultBatch(createDraftForm(), 0)]);
      return;
    }
    loadDraft();
  }, [loadDraft, manualCreate, createDefaultBatch]);





  useEffect(() => {
    let cancelled = false;
    setTaxCodesLoading(true);
    loadTaxCodes()
      .then((list) => {
        if (!cancelled) setTaxCodes(Array.isArray(list) ? list : []);
      })
      .catch((error) => {
        console.error('Failed to load tax codes:', error);
        if (!cancelled) toast.error(t('quality.loadTaxCodesFailed'));
      })
      .finally(() => {
        if (!cancelled) setTaxCodesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, t]);

  useEffect(() => {
    if (!isManual) return;
    let cancelled = false;

    setItemGroupsLoading(true);
    loadQualityItemGroups()
      .then((groups) => {
        if (!cancelled) {
          const mapped = (Array.isArray(groups) ? groups : []).map((g) => {
            const code = String(g.code || g.ItmsGrpCod || '').trim();
            const name = String(g.name || g.ItmsGrpNam || code).trim();
            return {
              ...g,
              code,
              name,
              ItmsGrpCod: g.ItmsGrpCod ?? code,
              ItmsGrpNam: g.ItmsGrpNam ?? name,
            };
          });
          setItemGroups(mapped);
        }
      })
      .catch((err) => console.error('Failed to load item groups:', err))
      .finally(() => {
        if (!cancelled) setItemGroupsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isManual]);



  const filteredFarms = useMemo(() => {
    if (farmGroupFilter === 'all') return farms;
    return farms.filter((f) => f.groupName === farmGroupFilter);
  }, [farms, farmGroupFilter]);

  const validateBatchAgainstSap = useCallback(async (batchNum, itemCode) => {
    const cleanBatch = String(batchNum || '').trim();
    const cleanItem = String(itemCode || '').trim();
    if (!cleanBatch || !cleanItem) return true;

    setCheckingBatch(true);
    try {
      const sapBatch = await checkBatchDetails(cleanBatch);
      if (sapBatch && String(sapBatch.item_code || '').trim().toLowerCase() === cleanItem.toLowerCase()) {
        const errorMsg = t('grpo.batchAlreadyRegistered');
        setErrors((prev) => ({ ...prev, batch_number: errorMsg }));
        toast.error(errorMsg);
        return false;
      }
      setErrors((prev) => {
        if (!prev.batch_number || prev.batch_number !== t('grpo.batchAlreadyRegistered')) return prev;
        const next = { ...prev };
        delete next.batch_number;
        return next;
      });
      return true;
    } catch (err) {
      console.error('Error validating batch in SAP:', err);
      return true;
    } finally {
      setCheckingBatch(false);
    }
  }, [t, toast]);

  const updateItemGroup = (groupCode) => {
    const cleanGroupCode = String(groupCode || '').trim();
    setForm((prev) => ({
      ...prev,
      item_group_code: cleanGroupCode,
      item_code: '',
      item_name: '',
      uom_code: '',
      uom_name: '',
      raw_material_type: '',
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.item_group_code;
      delete next.item_code;
      delete next.item_name;
      delete next.uom_code;
      return next;
    });
  };

  const updateItem = (itemCode) => {
    const cleanItemCode = String(itemCode || '').trim();
    const groupKey = form.item_group_code ? String(form.item_group_code).trim() : '';
    const groupItems = itemsByGroup[groupKey] || [];
    const item = groupItems.find((i) => String(i.item_code).trim() === cleanItemCode);
    const uom = String(item?.uom_code || item?.uom_name || 'KG').trim().toUpperCase() || 'KG';
    const itemName = String(item?.item_name || cleanItemCode).trim();
    setForm((prev) => ({
      ...prev,
      item_code: cleanItemCode,
      item_name: itemName,
      uom_code: uom,
      uom_name: item?.uom_name || uom,
      raw_material_type: item?.raw_material_type || '',
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.item_code;
      delete next.item_name;
      delete next.uom_code;
      return next;
    });
    if (form.batch_number) {
      validateBatchAgainstSap(form.batch_number, cleanItemCode);
    }
  };

  const updateFarm = (farmCode) => {
    const farm = farms.find((f) => f.code === farmCode);
    setForm((prev) => ({
      ...prev,
      vendor_card_code: farmCode,
      vendor_name: farm?.name || farmCode,
      farm_origin: farmCode,
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.vendor_card_code;
      delete next.vendor_name;
      return next;
    });
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setBatches((prev) => {
      if (prev.length === 1) {
        if (field === 'quantity') return [{ ...prev[0], quantity: value }];
        if (field === 'batch_number') return [{ ...prev[0], batch_number: value }];
        if (field === 'manufacturing_date') return [{ ...prev[0], manufacturing_date: value }];
        if (field === 'admission_date') return [{ ...prev[0], admission_date: value }];
        if (field === 'expiry_date') return [{ ...prev[0], expiry_date: value }];
      }
      return prev;
    });
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const updateWarehouse = (warehouseCode) => {
    setForm((prev) => ({
      ...prev,
      warehouse_code: warehouseCode,
      bin_code: '',
      bin_abs_entry: '',
    }));
    setBatches((prev) => {
      if (prev.length <= 1) {
        return prev.map((b) => ({ ...b, bin_location_code: '', bin_abs_entry: '' }));
      }
      return prev.map((b, idx) => (idx === 0 ? { ...b, bin_location_code: '', bin_abs_entry: '' } : b));
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next.warehouse_code;
      delete next.bin_code;
      delete next.bin_abs_entry;
      delete next.batch_0_bin;
      return next;
    });
  };

  const updateBin = (binCode) => {
    const bin = binLocations.find((item) => item.code === binCode);
    const abs = toFormValue(bin?.absEntry ?? bin?.AbsEntry ?? bin?.abs_entry);
    setForm((prev) => ({
      ...prev,
      bin_code: binCode,
      bin_abs_entry: abs,
    }));
    setBatches((prev) => {
      if (prev.length === 0) {
        return [{ ...createDefaultBatch(form, form.quantity), bin_location_code: binCode, bin_abs_entry: abs }];
      }
      return prev.map((b, idx) => (idx === 0 ? { ...b, bin_location_code: binCode, bin_abs_entry: abs } : b));
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next.bin_code;
      delete next.bin_abs_entry;
      delete next.batch_0_bin;
      return next;
    });
  };

  const buildPayload = () => {
    const manualItemCode = form.item_code.trim() || form.item_name.trim();
    const manualUom = (form.uom_code.trim() || 'KG').toUpperCase();
    const primaryBatch = batches[0] || {};
    return {
      vendor_card_code: form.vendor_card_code.trim(),
      vendor_name: form.vendor_name.trim(),
      vendor_ref_no: form.vendor_ref_no.trim(),
      posting_date: nullable(form.posting_date),
      document_date: nullable(form.document_date),
      due_date: nullable(form.due_date),
      journal_remark: form.journal_remark.trim(),
      comments: form.comments,
      location: form.location.trim(),
      general: form.general.trim(),
      car_number: form.car_number.trim(),
      quantity: Number(form.quantity || 0),
      container_quantity: Math.max(0, parseInt(form.container_quantity || '0', 10) || 0),
      warehouse_code: form.warehouse_code.trim(),
      unit_price: decimalOrNull(form.unit_price),
      tax_code: form.tax_code.trim(),
      discount_percent: decimalOrNull(form.discount_percent),
      batch_number: (primaryBatch.batch_number || form.batch_number).trim(),
      manufacturing_date: nullable(primaryBatch.manufacturing_date || form.manufacturing_date),
      admission_date: nullable(primaryBatch.admission_date || form.admission_date),
      expiry_date: nullable(primaryBatch.expiry_date || form.expiry_date),
      bin_code: (primaryBatch.bin_location_code || form.bin_code).trim(),
      bin_abs_entry: String(primaryBatch.bin_abs_entry || form.bin_abs_entry).trim(),
      batches: batches.map((b) => ({
        batch_id: b.id,
        batch_number: String(b.batch_number || '').trim(),
        quantity: Number(b.quantity || 0),
        bin_code: String(b.bin_code || b.bin_location_code || form.bin_code || '').trim(),
        bin_location_code: String(b.bin_location_code || b.bin_code || form.bin_code || '').trim(),
        bin_abs_entry: b.bin_abs_entry ? String(b.bin_abs_entry).trim() : String(form.bin_abs_entry || '').trim(),
        manufacturing_date: nullable(b.manufacturing_date),
        admission_date: nullable(b.admission_date),
        expiry_date: nullable(b.expiry_date),
        size: String(b.size || '').trim(),
        brand: String(b.brand || '').trim(),
        category: String(b.category || '').trim(),
        packing: String(b.packing || '').trim(),
        season: String(b.season || '').trim(),
        extra_specification: String(b.extra_specification || b.extraSpecification || '').trim(),
        vendor: String(b.vendor || '').trim(),
        part: String(b.part || '').trim(),
        company: String(b.company || '').trim(),
        number: String(b.number || '').trim(),
        details: String(b.details || '').trim(),
        batch_attribute_1: String(b.batch_attribute_1 || '').trim(),
        batch_attribute_2: String(b.batch_attribute_2 || '').trim(),
      })),
      ...(isManual ? {
        container_number: form.car_number.trim(),
        item_code: manualItemCode,
        item_name: form.item_name.trim() || manualItemCode,
        uom_code: manualUom,
        uom_name: manualUom,
      } : {}),
    };
  };

  const fieldError = (field) => {
    const value = errors[field];
    if (Array.isArray(value)) return value.join(' ');
    return value || '';
  };

  const validateStep = (stepIndex) => {
    if (!canEdit && !isManualCreate) return true;
    const nextErrors = {};
    const required = (field, message) => {
      if (!hasValue(form[field])) nextErrors[field] = message;
    };

    if (isManual) {
      if (stepIndex === 0) {
        required('car_number', t('quality.containerNumberRequired') || t('quality.carNumberRequired'));
        if (form.container_quantity !== '' && form.container_quantity !== undefined && form.container_quantity !== null) {
          const cQty = Number(form.container_quantity);
          if (isNaN(cQty) || cQty < 0 || !Number.isInteger(cQty)) {
            nextErrors.container_quantity = t('quality.invalidNoPacked');
          }
        }
      } else if (stepIndex === 1) {
        required('vendor_name', t('quality.vendorNameRequired'));
        required('vendor_card_code', t('quality.vendorCardCodeRequired'));
      } else if (stepIndex === 2) {
        required('item_group_code', t('quality.itemGroupRequired'));
        if (!hasValue(form.item_code)) {
          nextErrors.item_code = t('quality.itemCodeRequired');
        }
        if (!hasValue(form.uom_code)) {
          nextErrors.uom_code = t('quality.uomRequired');
        }
        required('quantity', t('quality.quantityRequired'));
        if (Number(form.quantity || 0) <= 0) {
          nextErrors.quantity = t('quality.quantityMustBeGreaterThanZero');
        }
      } else if (stepIndex === 3) {
        required('warehouse_code', t('quality.warehouseRequired'));
        if (binManaged) {
          required('bin_code', t('quality.binLocationRequired'));
        }
      } else if (stepIndex === 4) {
        if (!hasValue(form.item_code || draft?.item_code)) nextErrors.item_code = t('quality.itemCodeRequired');
        if (!hasValue(form.item_name || draft?.item_name)) nextErrors.item_name = t('quality.itemNameRequired');
        if (!hasValue(form.uom_code || draft?.uom_code)) nextErrors.uom_code = t('quality.uomRequired');
        required('quantity', t('quality.quantityRequired'));
        required('unit_price', t('quality.unitPriceRequired'));
        required('tax_code', t('quality.taxCodeRequired'));
        if (Number(form.quantity || 0) <= 0) {
          nextErrors.quantity = t('quality.quantityMustBeGreaterThanZero');
        }
        if (form.discount_percent !== '' && Number(form.discount_percent) < 0) {
          nextErrors.discount_percent = t('quality.discountPercentCannotBeNegative');
        }
        required('warehouse_code', t('quality.warehouseRequired'));
        if (binManaged) {
          required('bin_code', t('quality.binLocationRequired'));
        }
      } else if (stepIndex === operationalIndex) {
        required('posting_date', t('quality.postingDateRequired'));
        required('document_date', t('quality.documentDateRequired'));
        required('due_date', t('quality.dueDateRequired'));
        if (form.container_quantity !== '' && form.container_quantity !== undefined && form.container_quantity !== null) {
          const cQty = Number(form.container_quantity);
          if (isNaN(cQty) || cQty < 0 || !Number.isInteger(cQty)) {
            nextErrors.container_quantity = t('quality.invalidNoPacked');
          }
        }
      } else if (stepIndex === 6) {
        // Step 7: Intake Review - no form fields to validate
      } else if (stepIndex === 7) {
        required('batch_number', t('quality.batchRequired'));
        required('manufacturing_date', t('quality.manufacturingDateRequired'));
        required('admission_date', t('quality.admissionDateRequired'));
        if (errors.batch_number) {
          nextErrors.batch_number = errors.batch_number;
        }
      } else if (stepIndex === batchesIndex) {
        if (!batches.length) {
          nextErrors.batches = t('quality.noBatchesAdded') || 'At least one batch is required';
        } else {
          batches.forEach((b, i) => {
            if (!hasValue(b.batch_number)) {
              nextErrors[`batch_${i}_number`] = t('quality.batchRequired');
            }
            if (Number(b.quantity || 0) <= 0) {
              nextErrors[`batch_${i}_qty`] = t('quality.quantityMustBeGreaterThanZero');
            }
          });
          const totalReq = Number(form.quantity) || 0;
          const totalAlloc = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
          if (Math.abs(totalReq - totalAlloc) > 0.001) {
            const mismatchMsg = t('quality.quantityMismatch', Math.abs(totalReq - totalAlloc).toFixed(3));
            nextErrors.batches_balance = mismatchMsg;
            toast.error(mismatchMsg);
          }
        }
      }
    } else {
      if (stepIndex === itemIndex) {
        if (!hasValue(form.item_code || draft?.item_code)) nextErrors.item_code = t('quality.itemCodeRequired');
        if (!hasValue(form.item_name || draft?.item_name)) nextErrors.item_name = t('quality.itemNameRequired');
        if (!hasValue(form.uom_code || draft?.uom_code)) nextErrors.uom_code = t('quality.uomRequired');
        required('quantity', t('quality.quantityRequired'));
        required('unit_price', t('quality.unitPriceRequired'));
        required('tax_code', t('quality.taxCodeRequired'));
        if (Number(form.quantity || 0) <= 0) {
          nextErrors.quantity = t('quality.quantityMustBeGreaterThanZero');
        }
        if (form.discount_percent !== '' && Number(form.discount_percent) < 0) {
          nextErrors.discount_percent = t('quality.discountPercentCannotBeNegative');
        }
      }

      if (stepIndex === warehouseIndex) {
        required('warehouse_code', t('quality.warehouseRequired'));
        if (binManaged) {
          required('bin_code', t('quality.binLocationRequired'));
        }
      }

      if (stepIndex === operationalIndex) {
        required('posting_date', t('quality.postingDateRequired'));
        required('document_date', t('quality.documentDateRequired'));
        required('due_date', t('quality.dueDateRequired'));
        if (form.container_quantity !== '' && form.container_quantity !== undefined && form.container_quantity !== null) {
          const cQty = Number(form.container_quantity);
          if (isNaN(cQty) || cQty < 0 || !Number.isInteger(cQty)) {
            nextErrors.container_quantity = t('quality.invalidNoPacked');
          }
        }
      }

      if (stepIndex === batchesIndex) {
        if (!batches.length) {
          nextErrors.batches = t('quality.noBatchesAdded') || 'At least one batch is required';
        } else {
          batches.forEach((b, i) => {
            if (!hasValue(b.batch_number)) {
              nextErrors[`batch_${i}_number`] = t('quality.batchRequired');
            }
            if (Number(b.quantity || 0) <= 0) {
              nextErrors[`batch_${i}_qty`] = t('quality.quantityMustBeGreaterThanZero');
            }
          });
          const totalReq = Number(form.quantity) || 0;
          const totalAlloc = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
          if (Math.abs(totalReq - totalAlloc) > 0.001) {
            const mismatchMsg = t('quality.quantityMismatch', Math.abs(totalReq - totalAlloc).toFixed(3));
            nextErrors.batches_balance = mismatchMsg;
            toast.error(mismatchMsg);
          }
        }
      }
    }

    if (Object.keys(nextErrors).length) {
      setErrors((prev) => ({ ...prev, ...nextErrors }));
      return false;
    }
    return true;
  };

  const validateAllEditableSteps = () => {
    if (!canEdit && !isManualCreate) return true;
    const checks = {};
    const required = (field, message) => {
      if (!hasValue(form[field])) checks[field] = message;
    };

    if (isManualCreate) {
      required('car_number', t('quality.containerNumberRequired') || t('quality.carNumberRequired'));
      if (form.container_quantity !== '' && form.container_quantity !== undefined && form.container_quantity !== null) {
        const cQty = Number(form.container_quantity);
        if (isNaN(cQty) || cQty < 0 || !Number.isInteger(cQty)) {
          checks.container_quantity = t('quality.invalidNoPacked');
        }
      }
      required('vendor_card_code', t('quality.vendorCardCodeRequired'));
      required('vendor_name', t('quality.vendorNameRequired'));
      required('item_group_code', t('quality.itemGroupRequired'));
      required('item_code', t('quality.itemCodeRequired'));
      required('uom_code', t('quality.uomRequired'));
      required('quantity', t('quality.quantityRequired'));
      if (Number(form.quantity || 0) <= 0) checks.quantity = t('quality.quantityMustBeGreaterThanZero');
      required('warehouse_code', t('quality.warehouseRequired'));
      if (binManaged) {
        required('bin_code', t('quality.binLocationRequired'));
      }
      required('batch_number', t('quality.batchRequired'));
      required('manufacturing_date', t('quality.manufacturingDateRequired'));
      required('admission_date', t('quality.admissionDateRequired'));
    } else {
      required('vendor_card_code', t('quality.vendorCardCodeRequired'));
      required('vendor_name', t('quality.vendorNameRequired'));
      required('posting_date', t('quality.postingDateRequired'));
      required('document_date', t('quality.documentDateRequired'));
      required('due_date', t('quality.dueDateRequired'));
      required('tax_code', t('quality.taxCodeRequired'));
      required('quantity', t('quality.quantityRequired'));
      required('unit_price', t('quality.unitPriceRequired'));
      required('warehouse_code', t('quality.warehouseRequired'));
      if (binManaged) {
        required('bin_code', t('quality.binLocationRequired'));
      }
      if (Number(form.quantity || 0) <= 0) checks.quantity = t('quality.quantityMustBeGreaterThanZero');
      if (form.discount_percent !== '' && Number(form.discount_percent) < 0) {
        checks.discount_percent = t('quality.discountPercentCannotBeNegative');
      }
      if (form.container_quantity !== '' && form.container_quantity !== undefined && form.container_quantity !== null) {
        const cQty = Number(form.container_quantity);
        if (isNaN(cQty) || cQty < 0 || !Number.isInteger(cQty)) {
          checks.container_quantity = t('quality.invalidNoPacked');
        }
      }
      if (!batches.length) {
        checks.batches = t('quality.noBatchesAdded') || 'At least one batch is required';
      } else {
        batches.forEach((b, i) => {
          if (!hasValue(b.batch_number)) checks[`batch_${i}_number`] = t('quality.batchRequired');
          if (Number(b.quantity || 0) <= 0) checks[`batch_${i}_qty`] = t('quality.quantityMustBeGreaterThanZero');
        });
        const totalReq = Number(form.quantity) || 0;
        const totalAlloc = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
        if (Math.abs(totalReq - totalAlloc) > 0.001) {
          const mismatchMsg = t('quality.quantityMismatch', Math.abs(totalReq - totalAlloc).toFixed(3));
          checks.batches_balance = mismatchMsg;
          toast.error(mismatchMsg);
        }
      }
    }

    if (Object.keys(checks).length) {
      setErrors((prev) => ({ ...prev, ...checks }));
      setActiveStep(firstErrorStep(checks));
      return false;
    }
    return true;
  };

  const saveDraft = async ({ silent = false } = {}) => {
    if (!draft || saving || !canEdit) return null;
    setSaving(true);
    setErrors({});
    try {
      const saved = await savePurchaseGRPODraft(draft.id, buildPayload());
      setDraft(saved);
      setForm(createDraftForm(saved || {}));
      setPostingPreview(null);
      if (!silent) toast.success(t('quality.grpoDraftSaved'));
      return saved;
    } catch (error) {
      console.error(error);
      const responseErrors = error.response?.data?.errors;
      if (responseErrors && typeof responseErrors === 'object') {
        setErrors(responseErrors);
        setActiveStep(firstErrorStep(responseErrors));
      }
      toast.error(error.response?.data?.error || t('quality.grpoDraftSaveFailed'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const createManualDraft = async (targetStep = 6) => {
    if (creatingManual) return null;
    const isBatchValid = await validateBatchAgainstSap(form.batch_number, form.item_code);
    if (!isBatchValid) return null;

    setCreatingManual(true);
    setErrors({});
    try {
      const manualUom = (form.uom_code.trim() || 'KG').toUpperCase();
      const manualItemCode = form.item_code.trim() || form.item_name.trim();
      const result = await createManualReceivingRequest({
        car_number: form.car_number.trim(),
        container_number: form.car_number.trim(),
        container_quantity: Math.max(0, parseInt(form.container_quantity || '0', 10) || 0),
        vendor_name: form.vendor_name.trim(),
        vendor_card_code: form.vendor_card_code.trim(),
        farm_origin: form.farm_origin ? form.farm_origin.trim() : form.vendor_card_code.trim(),
        contractor_name: '',
        contractor_code: '',
        item_code: manualItemCode,
        item_name: form.item_name.trim() || manualItemCode,
        raw_material_type: form.raw_material_type || '',
        quantity: Number(form.quantity || 0),
        unit_price: decimalOrNull(form.unit_price),
        tax_code: form.tax_code ? form.tax_code.trim() : '',
        discount_percent: decimalOrNull(form.discount_percent),
        uom_code: manualUom,
        uom_name: manualUom,
        warehouse_code: form.warehouse_code.trim(),
        bin_code: form.bin_code.trim(),
        bin_abs_entry: form.bin_abs_entry.trim(),
        batch_number: form.batch_number.trim(),
        manufacturing_date: form.manufacturing_date || null,
        admission_date: form.admission_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.comments.trim(),
        location: form.location.trim(),
        general: form.general.trim(),
        vendor_ref_no: form.vendor_ref_no ? form.vendor_ref_no.trim() : '',
        journal_remark: form.journal_remark ? form.journal_remark.trim() : '',
      });
      const draftId = result?.draft_id;
      if (!draftId) {
        toast.error(t('grpo.openFailed'));
        return null;
      }
      toast.success(t('grpo.manualReceivingSuccess'));
      navigate(`/grpo/${draftId}`, { replace: true, state: { activeStep: targetStep } });
      return result;
    } catch (error) {
      console.error(error);
      const errMsg = error.response?.data?.error || t('quality.grpoDraftSaveFailed');
      if (errMsg.toLowerCase().includes('batch') || errMsg.includes('التشغيلة')) {
        setErrors((prev) => ({ ...prev, batch_number: errMsg }));
      }
      toast.error(errMsg);
      return null;
    } finally {
      setCreatingManual(false);
    }
  };

  const handlePreviewPosting = async () => {
    if (!draft || previewLoading || !canPostToSap) return;
    setPreviewLoading(true);
    setPostingPreview(null);
    try {
      const preview = await previewPurchaseGRPOPosting(draft.id, false);
      setPostingPreview(preview);
      toast.success(t('quality.grpoPostingReadinessReady'));
    } catch (error) {
      console.error(error);
      const responseErrors = error.response?.data?.errors;
      if (responseErrors && typeof responseErrors === 'object') {
        setErrors(responseErrors);
        setActiveStep(firstErrorStep(responseErrors));
      }
      toast.error(error.response?.data?.error || t('quality.grpoPreviewFailed'));
    } finally {
      setPreviewLoading(false);
    }
  };

  

  const handlePostToSap = async () => {
    if (!draft || posting || isPosted || !canPostToSap) return;
    if (canEdit && !validateAllEditableSteps()) return;
    setPosting(true);
    setErrors({});
    try {
      if (canEdit) {
        const saved = await saveDraft({ silent: true });
        if (!saved) {
          setPosting(false);
          return;
        }
      }
      const result = await postPurchaseGRPODraftToSAP(draft.id);
      if (result?.draft) {
        setDraft(result.draft);
        setForm(createDraftForm(result.draft));
        setActiveStep(reviewIndex);
        setMaxReachedStep(reviewIndex);
      }
      setPostingPreview(null);
      toast.success(t('quality.grpoDraftPostedSuccess'));
    } catch (error) {
      console.error(error);
      const responseErrors = error.response?.data?.errors;
      if (responseErrors && typeof responseErrors === 'object') {
        setErrors(responseErrors);
        setActiveStep(firstErrorStep(responseErrors));
      }
      const failedDraft = error.response?.data?.data?.draft;
      if (failedDraft) {
        setDraft(failedDraft);
        setForm(createDraftForm(failedDraft));
      }
      toast.error(error.response?.data?.error || t('quality.grpoPostFailed'));
    } finally {
      setPosting(false);
    }
  };

  const handlePrintGrpo = async () => {
    const docToPrint = draft;
    if (!docToPrint || (!docToPrint.sap_doc_num && !docToPrint.sap_doc_entry)) {
      toast.error('لا يمكن طباعة المستند قبل صدور رقم المستند من SAP');
      return;
    }
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      return;
    }
    setIsPreparingPrint(true);
    try {
      const preparedRecord = await prepareShippingReceivingPrintRecord({
        ...docToPrint,
        item_name: docToPrint.item_name || form.item_name,
        uom_name: docToPrint.uom_name || docToPrint.uom_code || form.uom_name || form.uom_code,
      });
      setPrintingRecord(preparedRecord);
      setPrintRequest({ printWindow });
    } catch (printError) {
      printWindow.close();
      console.error('Failed to prepare receiving document identifiers:', printError);
      toast.error('Unable to prepare document barcode.');
      setIsPreparingPrint(false);
    }
  };

  useEffect(() => {
    if (!printRequest) return undefined;

    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []);
      const opened = writePrintDocument({
        printWindow: printRequest.printWindow,
        title: 'EGAST Goods Receiving Document',
        elements: sheets,
      });

      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      }

      setPrintRequest(null);
      setPrintingRecord(null);
      setIsPreparingPrint(false);
    }, 100);

    return () => window.clearTimeout(timer);
  }, [printRequest, toast, t]);

  const goToStep = (stepIndex) => {
    if (isPosted) return;
    if (stepIndex <= maxReachedStep) setActiveStep(stepIndex);
  };

  const handleNext = async () => {
    if (isPosted) return;
    if (!validateStep(activeStep)) return;

    if (isManual) {
      if (activeStep === 7) {
        const isBatchValid = await validateBatchAgainstSap(form.batch_number, form.item_code);
        if (!isBatchValid) return;
        if (!draft) {
          await createManualDraft(8);
          return;
        }
      }
      if (activeStep === reviewIndex - 1) {
        if (!validateAllEditableSteps()) return;
        const saved = await saveDraft({ silent: true });
        if (!saved) return;
      }
      const next = Math.min(activeStep + 1, reviewIndex);
      setActiveStep(next);
      setMaxReachedStep((prev) => Math.max(prev, next));
      return;
    }

    if (activeStep === reviewIndex - 1) {
      if (!validateAllEditableSteps()) return;
      const saved = await saveDraft({ silent: true });
      if (!saved) return;
    }
    const next = Math.min(activeStep + 1, reviewIndex);
    setActiveStep(next);
    setMaxReachedStep((prev) => Math.max(prev, next));
  };

  const handlePrevious = () => {
    if (isPosted) return;
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  const renderInput = ({
    field,
    label,
    type = 'text',
    step,
    readOnly = false,
    value,
    forceEditable = false,
  }) => {
    const canInput = canEdit || forceEditable;
    return (
      <label className="form-field" key={field}>
        <span>{label}</span>
        <input
          className={`app-input${fieldError(field) ? ' app-input--error' : ''}`}
          type={type}
          step={step}
          value={value ?? form[field] ?? ''}
          readOnly={readOnly || !canInput}
          disabled={!canInput && !readOnly}
          onChange={(event) => updateField(field, event.target.value)}
        />
        {fieldError(field) && <span className="form-field__hint grpo-field-error">{fieldError(field)}</span>}
      </label>
    );
  };

  const resolveInfoIcon = (label, value) => {
    if (label === t('grpo.documentStatus') || label === t('quality.grpoDraftStatus')) return '✅';
    if (label === t('quality.sapDocEntry') || label === t('quality.colInspectionId') || label === t('grpo.referenceNumber') || label === t('quality.vendorRefNo')) return '🔢';
    if (label === t('quality.postedAt') || label === t('quality.postingDate') || label === t('quality.documentDate') || label === t('quality.dueDate') || label === t('quality.manufacturingDate') || label === t('quality.admissionDate') || label === t('quality.expiryDate')) return '📅';
    if (label === t('quality.vendorName')) return '🏢';
    if (label === t('quality.containerNumber')) return '🚚';
    if (label === t('quality.noPacked') || label === t('quality.location') || label === t('quality.general')) return '📊';
    if (label === t('quality.productName')) return getProductIcon(value);
    if (label === t('quality.grpoQuantity')) return '⚖️';
    if (label === t('quality.unitPrice') || label === t('quality.taxCode') || label === t('quality.discountPercent')) return '💰';
    if (label === t('quality.selectWarehouse')) return '🏭';
    if (label === t('quality.binLocation')) return '📍';
    if (label === t('quality.batchNumber')) return '🏷️';
    return '📋';
  };

  const renderInfoItem = (label, value) => {
    const icon = resolveInfoIcon(label, value);
    return (
      <div className="grpo-summary-item" key={label}>
        <span className="grpo-summary-item__label">
          <span className="meta-label-icon" aria-hidden="true">{icon}</span>
          {label}
        </span>
        <strong className="grpo-summary-item__value">{fmtValue(value)}</strong>
      </div>
    );
  };

  const renderReadonlyField = (field, label, value, emptyText) => (
    <div className={`form-field grpo-readonly-field${fieldError(field) ? ' grpo-readonly-field--error' : ''}`} key={field}>
      <span>{label}</span>
      <strong>{hasValue(value) ? value : (emptyText || fmtValue(value))}</strong>
      {fieldError(field) && <span className="form-field__hint grpo-field-error">{fieldError(field)}</span>}
    </div>
  );

  const renderSapDocumentInfo = () => {
    if (!hasSapDocumentInfo) return null;
    return (
      <div className="grpo-review-grid grpo-sap-info-grid">
        {renderInfoItem(t('grpo.documentStatus'), statusLabel(draft.status))}
        {renderInfoItem(t('quality.sapDocEntry'), draft.sap_doc_entry)}
        {renderInfoItem(t('grpo.referenceNumber'), draft.sap_doc_num)}
      </div>
    );
  };

  const renderWizardNav = () => {
    return (
      <div className="wizard-nav-row grpo-wizard-nav">
        {!isPosted && (
          <button
            type="button"
            className="app-button app-button--secondary wizard-nav-btn"
            onClick={activeStep === 0 && !draft ? handleBack : handlePrevious}
            disabled={(activeStep === 0 && Boolean(draft)) || loading}
          >
            {activeStep === 0 && !draft ? t('common.back') : t('common.previous')}
          </button>
        )}

        <div className="grpo-wizard-nav__actions">
          {isPosted ? null : activeStep < reviewIndex ? (
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn"
              onClick={handleNext}
              disabled={loading || saving || creatingManual}
            >
              {saving || creatingManual ? t('common.pleaseWait') : t('common.next')}
            </button>
          ) : (
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn"
              onClick={handlePostToSap}
              disabled={!canPostToSap || posting || saving}
              aria-busy={posting ? 'true' : 'false'}
            >
              {posting ? (
                <>
                  <AppSpinner size="sm" />
                  <span>{t('common.postingToSap')}</span>
                </>
              ) : (
                (t('quality.confirmAndPostGrpoToSap') || t('quality.postGrpoToSap'))
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderPostedSummary = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('quality.grpoPostedFinalTitle')}</h1>
        <p className="quality-wizard-subtitle">{t('quality.grpoPostedFinalDesc')}</p>
      </div>
      <div className="feedback-message feedback-message--success grpo-draft-card__notice">
        {t('quality.grpoPostedToSap')}
      </div>
      <div className="grpo-review-grid">
        {renderInfoItem(t('quality.colInspectionId'), draft.inspection)}
        {renderInfoItem(t('grpo.documentStatus'), statusLabel(draft.status))}
        {renderInfoItem(t('quality.sapDocEntry'), draft.sap_doc_entry)}
        {renderInfoItem(t('grpo.referenceNumber'), draft.sap_doc_num)}
        {renderInfoItem(t('quality.postedAt'), formatPostedAt(draft.posted_at))}
        {renderInfoItem(t('quality.vendorName'), `${fmtValue(draft.vendor_card_code)} - ${fmtValue(draft.vendor_name)}`)}
        {draft?.quotation && renderInfoItem('مرجع الشحن المرتبط', `#${draft.quotation_number || draft.quotation}${draft.quotation_sap_doc_entry ? ` (المرجع: ${draft.quotation_sap_doc_entry})` : ''}`)}
        {renderInfoItem(t('quality.containerNumber'), draft?.inspection_context?.car_number || draft?.car_number || '-')}
        {renderInfoItem(t('quality.noPacked'), draft?.container_quantity !== undefined && draft?.container_quantity !== null ? draft.container_quantity : '0')}
        {renderInfoItem(t('quality.productName'), `${fmtValue(draft.item_code)} - ${fmtValue(draft.item_name)}`)}
        {renderInfoItem(t('quality.grpoQuantity'), `${fmtValue(draft.quantity)} ${fmtValue(draft.uom_name || draft.uom_code)}`)}
        {renderInfoItem(t('quality.unitPrice'), draft.unit_price)}
        {renderInfoItem(t('quality.postingDate'), draft.posting_date)}
        {renderInfoItem(t('quality.documentDate'), draft.document_date)}
        {renderInfoItem(t('quality.dueDate'), draft.due_date)}
        {renderInfoItem(t('quality.vendorRefNo'), draft.vendor_ref_no)}
        {renderInfoItem(t('quality.journalRemark'), draft.journal_remark)}
        {renderInfoItem(t('quality.taxCode'), draft.tax_code)}
        {renderInfoItem(t('quality.discountPercent'), draft.discount_percent)}
        {renderInfoItem(t('quality.location'), getCostCenterDisplay(draft.location, costCentersDim1))}
        {renderInfoItem(t('quality.general'), getCostCenterDisplay(draft.general, costCentersDim2))}
        {renderInfoItem(t('quality.selectWarehouse'), draft.warehouse_code)}
        {renderInfoItem(t('quality.binLocation'), draft.bin_code)}
        {renderInfoItem(t('quality.batchNumber'), draft.batch_number)}
        {renderInfoItem(t('quality.manufacturingDate'), draft.manufacturing_date)}
        {renderInfoItem(t('quality.admissionDate'), draft.admission_date)}
        {renderInfoItem(t('quality.expiryDate'), draft.expiry_date)}
      </div>
      {batches.length > 0 && (
        <div className="grpo-review-section" style={{ marginTop: '24px' }}>
          <h3 className="grpo-review-section__title">
            🏷️ {t('quality.batchBreakdown')} ({batches.length})
          </h3>
          <div className="grpo-review-batches-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
            {batches.map((batch, bIdx) => (
              <div
                key={batch.id || bIdx}
                className="card-panel"
                style={{ background: 'var(--bg-muted, #f8f9fa)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <strong>{t('quality.batchLabel', bIdx + 1)}: {batch.batch_number || '-'}</strong>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                    {fmtValue(batch.quantity)} {draft?.uom_name || draft?.uom_code || ''}
                  </span>
                </div>
                <div className="details-grid details-grid--sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📍</span>{t('quality.binLocation')}</span><div className="detail-item__value">{batch.bin_location_code || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.manufacturingDate')}</span><div className="detail-item__value">{batch.manufacturing_date || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.admissionDate')}</span><div className="detail-item__value">{batch.admission_date || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.expiryDate')}</span><div className="detail-item__value">{batch.expiry_date || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏢</span>{t('quality.batchAttrs.vendor')}</span><div className="detail-item__value">{batch.vendor || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏷️</span>{t('quality.batchAttrs.part')}</span><div className="detail-item__value">{batch.part || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏢</span>{t('quality.batchAttrs.company')}</span><div className="detail-item__value">{batch.company || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.batchAttrs.season')}</span><div className="detail-item__value">{batch.season || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏷️</span>{t('quality.batchAttrs.batchAttribute1')}</span><div className="detail-item__value">{batch.batch_attribute_1 || '-'}</div></div>
                  <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏷️</span>{t('quality.batchAttrs.batchAttribute2')}</span><div className="detail-item__value">{batch.batch_attribute_2 || '-'}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="app-button app-button--secondary"
          onClick={handlePrintGrpo}
          disabled={isPreparingPrint}
          aria-busy={isPreparingPrint ? 'true' : 'false'}
        >
          {isPreparingPrint ? (
            <>
              <AppSpinner size="xs" />
              <span>{t('common.preparingPrint')}</span>
            </>
          ) : (
            `🖨️ ${t('quality.printGrpoDocument') || 'طباعة مستند الاستلام'}`
          )}
        </button>
        <button
          type="button"
          className="app-button app-button--primary"
          onClick={handleBack}
        >
          {isStandaloneGrpo
            ? (location.pathname.startsWith('/grpo/documents') || location.state?.from === '/grpo/review'
                ? t('grpo.backToReview')
                : t('grpo.backToPending'))
            : (t('quality.backToReview') || t('common.back'))}
        </button>
      </div>
    </section>
  );

  const renderManualVehicleStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('quality.manualStepVehicleTitle')}</h1>
        <p className="quality-wizard-subtitle">{t('quality.manualStepVehicleDesc')}</p>
      </div>
      <div className="quality-form-grid qrev-meta-grid">
        {/* Container No. */}
        <label className="form-field">
          <span>{t('quality.containerNumber')} *</span>
          <input
            className={`app-input${fieldError('car_number') ? ' app-input--error' : ''}`}
            type="text"
            value={form.car_number}
            onChange={(e) => updateField('car_number', e.target.value)}
            placeholder={t('quality.containerNumberPlaceholder')}
            autoFocus
          />
          {fieldError('car_number') && <span className="form-field__hint grpo-field-error">{fieldError('car_number')}</span>}
        </label>

        {/* No. Packed */}
        <label className="form-field">
          <span>{t('quality.noPacked')} *</span>
          <input
            className={`app-input${fieldError('container_quantity') ? ' app-input--error' : ''}`}
            type="number"
            min="0"
            step="1"
            value={form.container_quantity}
            placeholder={t('quality.noPackedPlaceholder')}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                updateField('container_quantity', '');
                return;
              }
              if (/^\d+$/.test(val)) {
                updateField('container_quantity', val);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === '.' || e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                e.preventDefault();
              }
            }}
            onBlur={() => {
              if (form.container_quantity === '') {
                updateField('container_quantity', '0');
              }
            }}
          />
          {fieldError('container_quantity') && <span className="form-field__hint grpo-field-error">{fieldError('container_quantity')}</span>}
        </label>

        {/* Comments / Remarks */}
        <label className="form-field quality-form-field--full">
          <span>{t('quality.grpoComments')}</span>
          <textarea
            className="app-input"
            rows={3}
            value={form.comments}
            placeholder={t('quality.grpoComments')}
            onChange={(event) => updateField('comments', event.target.value)}
          />
          {fieldError('comments') && <span className="form-field__hint grpo-field-error">{fieldError('comments')}</span>}
        </label>
      </div>
      {renderWizardNav()}
    </section>
  );

  const renderManualSupplierStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('quality.manualStepSupplierTitle')}</h1>
        <p className="quality-wizard-subtitle">{t('grpo.manualSupplierDesc')}</p>
      </div>
      <div className="quality-form-grid qrev-meta-grid">
        {/* Farm / Supplier (Vendor) with Tab Filters */}
        <div className="form-field quality-form-field--full">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontWeight: 600 }}>{t('quality.vendorName')} *</span>
            <div style={{ display: 'inline-flex', gap: '14px', fontSize: '0.85rem' }}>
              {[
                { id: 'all', label: t('quality.farmFilterAll') },
                { id: 'مزارع الشركة', label: t('quality.farmFilterCompany') },
                { id: 'موردين خام', label: t('quality.farmFilterSuppliers') },
              ].map((tab) => (
                <label key={tab.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 500 }}>
                  <input
                    type="radio"
                    name="manualFarmFilter"
                    checked={farmGroupFilter === tab.id}
                    onChange={() => setFarmGroupFilter(tab.id)}
                  />
                  <span>{tab.label}</span>
                </label>
              ))}
            </div>
          </div>
          <SearchableSelect
            className={`app-input${fieldError('vendor_name') || fieldError('vendor_card_code') ? ' app-input--error' : ''}`}
            searchSource={{ ...farmSearch, params: { group_name: farmGroupFilter === 'all' ? '' : farmGroupFilter } }}
            onSearchResults={(rows) => setFarms(rows.map((row) => ({ ...row, code: row.farmCode, name: row.farmName, groupName: row.GroupName })))}
            value={form.vendor_card_code}
            onChange={(e) => updateFarm(e.target.value)}
            disabled={farmsLoading}
            loading={farmsLoading}
            placeholder={farmsLoading ? t('common.loading') : t('quality.selectSupplier')}
          >
            <option value="">{farmsLoading ? t('common.loading') : t('quality.selectSupplier')}</option>
            {filteredFarms.map((farm) => (
              <option key={farm.code} value={farm.code}>
                {farm.code} - {farm.name}
              </option>
            ))}
          </SearchableSelect>
          {(fieldError('vendor_name') || fieldError('vendor_card_code')) && (
            <span className="form-field__hint grpo-field-error">
              {fieldError('vendor_name') || fieldError('vendor_card_code')}
            </span>
          )}
        </div>
      </div>
      {renderWizardNav()}
    </section>
  );

  const renderManualProductStep = () => {
    const currentGroupKey = form.item_group_code ? String(form.item_group_code).trim() : '';
    const currentGroupItems = currentGroupKey ? (itemsByGroup[currentGroupKey] || []) : [];

    return (
      <section className="card-panel quality-wizard-card--wide grpo-draft-card">
        <div className="quality-wizard-heading">
          <h1 className="page-title">{t('quality.manualStepProductTitle')}</h1>
          <p className="quality-wizard-subtitle">{t('grpo.manualProductDesc')}</p>
        </div>
        <div className="quality-form-grid qrev-meta-grid">
          {/* Item Group */}
          <label className="form-field quality-form-field--full">
            <span>{t('quality.itemGroup')} *</span>
            <SearchableSelect
              className={`app-input${fieldError('item_group_code') ? ' app-input--error' : ''}`}
              value={form.item_group_code || ''}
              onChange={(e) => updateItemGroup(e.target.value)}
              disabled={itemGroupsLoading}
              loading={itemGroupsLoading}
              placeholder={itemGroupsLoading ? t('common.loading') : t('quality.selectItemGroup')}
            >
              <option value="">{itemGroupsLoading ? t('common.loading') : t('quality.selectItemGroup')}</option>
              {itemGroups.map((g) => {
                const code = String(g.code || g.ItmsGrpCod || '').trim();
                const name = String(g.name || g.ItmsGrpNam || code).trim();
                return (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                );
              })}
            </SearchableSelect>
            {fieldError('item_group_code') && <span className="form-field__hint grpo-field-error">{fieldError('item_group_code')}</span>}
          </label>

          {/* Item (from SAP) */}
          <label className="form-field">
            <span>{t('quality.productName')} *</span>
            <SearchableSelect
              className={`app-input${fieldError('item_code') || fieldError('item_name') ? ' app-input--error' : ''}`}
              searchSource={{ ...itemSearch, params: { item_group_code: form.item_group_code } }}
              onSearchResults={(rows) => setItemsByGroup((previous) => ({ ...previous, [form.item_group_code]:
                [...new Map([...(previous[form.item_group_code] || []).filter((row) => row.item_code === form.item_code), ...rows].map((row) => [row.item_code, row])).values()] }))}
              value={form.item_code || ''}
              onChange={(e) => updateItem(e.target.value)}
              disabled={!form.item_group_code || itemsLoading}
              loading={itemsLoading}
              placeholder={itemsLoading ? t('common.loading') : t('quality.selectItem')}
            >
              <option value="">
                {!form.item_group_code
                  ? t('quality.selectItemGroup')
                  : itemsLoading
                    ? t('common.loading')
                    : t('quality.selectItem')}
              </option>
              {form.item_code && !currentGroupItems.some((i) => String(i.item_code).trim() === String(form.item_code).trim()) && (
                <option value={form.item_code}>
                  {form.item_code} - {form.item_name || form.item_code}
                </option>
              )}
              {currentGroupItems.map((item) => (
                <option key={item.item_code} value={item.item_code}>
                  {item.item_code} - {item.item_name}
                </option>
              ))}
            </SearchableSelect>
            {(fieldError('item_code') || fieldError('item_name')) && (
              <span className="form-field__hint grpo-field-error">
                {fieldError('item_code') || fieldError('item_name')}
              </span>
            )}
          </label>

          {/* Unit of Measure (UOM) - Locked read-only from SAP item */}
          <div className="form-field grpo-readonly-field">
            <span>{t('quality.unitOfMeasure')}</span>
            <strong style={{ fontSize: '1.05rem', paddingTop: '6px' }}>
              {form.uom_code || form.uom_name || '-'}
            </strong>
          </div>

          {/* GRPO Quantity */}
          <label className="form-field">
            <span>{t('quality.grpoQuantity')} *</span>
            <input
              className={`app-input${fieldError('quantity') ? ' app-input--error' : ''}`}
              type="number"
              step="any"
              value={form.quantity}
              onChange={(e) => updateField('quantity', e.target.value)}
              placeholder="0.00"
            />
            {fieldError('quantity') && <span className="form-field__hint grpo-field-error">{fieldError('quantity')}</span>}
          </label>
        </div>
        {renderWizardNav()}
      </section>
    );
  };

  const renderWarehouseFields = () => (
    <>
      <div className="quality-form-grid qrev-meta-grid">
        {/* Destination Warehouse */}
        <label className="form-field quality-form-field--full">
          <span>{t('quality.selectWarehouse')} *</span>
          <SearchableSelect
            className={`app-input${fieldError('warehouse_code') ? ' app-input--error' : ''}`}
            searchSource={warehouseSearch}
            onSearchResults={setWarehouses}
            value={form.warehouse_code}
            onChange={(event) => updateWarehouse(event.target.value)}
            disabled={!canEdit || warehousesLoading}
            loading={warehousesLoading}
            placeholder={warehousesLoading ? t('common.loading') : t('quality.selectWarehouse')}
          >
            <option value="">{warehousesLoading ? t('common.loading') : t('quality.selectWarehouse')}</option>
            {form.warehouse_code && !warehouses.some((w) => (w.code || w.WarehouseCode) === form.warehouse_code) && (
              <option value={form.warehouse_code}>{form.warehouse_code}</option>
            )}
            {warehouses.map((warehouse) => {
              const code = warehouse.code || warehouse.WarehouseCode;
              const name = warehouse.name || warehouse.WarehouseName || code;
              return <option key={code} value={code}>{code} - {name}</option>;
            })}
          </SearchableSelect>
          {fieldError('warehouse_code') && <span className="form-field__hint grpo-field-error">{fieldError('warehouse_code')}</span>}
        </label>

        {/* Bin Location */}
        <label className="form-field quality-form-field--full" style={{ marginTop: '8px' }}>
          <span>{t('quality.binLocation')}{binManaged ? ' *' : ''}</span>
          <SearchableSelect
            className={`app-input${(fieldError('bin_code') || fieldError('bin_abs_entry')) ? ' app-input--error' : ''}`}
            key={form.warehouse_code}
            searchSource={remoteBinSearch(form.warehouse_code)}
            onSearchResults={(rows) => setBinLocations((previous) => [...new Map([...previous, ...rows].map((row) => [row.code, row])).values()])}
            value={form.bin_code}
            onChange={(event) => updateBin(event.target.value)}
            disabled={!canEdit || !form.warehouse_code}
            loading={binsLoading}
            placeholder={
              !form.warehouse_code
                ? t('quality.selectWarehouseFirst')
                : binsLoading
                  ? t('quality.loadingBinLocations')
                  : binLocations.length === 0
                    ? t('wizard.noBins')
                    : t('quality.selectBinLocation')
            }
          >
            <option value="">
              {!form.warehouse_code
                ? t('quality.selectWarehouseFirst')
                : binsLoading
                  ? t('quality.loadingBinLocations')
                  : binLocations.length === 0
                    ? t('wizard.noBins')
                    : t('quality.selectBinLocation')}
            </option>
            {form.bin_code && !binLocations.some((b) => (b.code || b.BinCode) === form.bin_code) && (
              <option value={form.bin_code}>{form.bin_code}</option>
            )}
            {binLocations.map((bin) => {
              const code = bin.code || bin.BinCode;
              const name = bin.name || bin.BinName || code;
              return (
                <option key={code} value={code}>
                  {code}{name && name !== code ? ` - ${name}` : ''}
                </option>
              );
            })}
          </SearchableSelect>
          {(fieldError('bin_code') || fieldError('bin_abs_entry')) && (
            <span className="form-field__hint grpo-field-error">
              {fieldError('bin_code') || fieldError('bin_abs_entry')}
            </span>
          )}
        </label>
      </div>
    </>
  );

  const renderManualWarehouseStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('quality.manualStepWarehouseTitle')}</h1>
        <p className="quality-wizard-subtitle">{t('quality.manualStepWarehouseDesc')}</p>
      </div>
      {renderWarehouseFields()}
      {renderWizardNav()}
    </section>
  );

  const renderManualBatchStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('quality.manualStepBatchTitle')}</h1>
        <p className="quality-wizard-subtitle">{t('quality.manualStepBatchDesc')}</p>
      </div>
      <div className="quality-form-grid qrev-meta-grid">
        {/* Batch Number - 100% MANUAL with SAP duplicate check */}
        <label className="form-field quality-form-field--full">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('quality.batchNumber')} *</span>
            {checkingBatch && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {t('grpo.batchChecking')}
              </span>
            )}
          </div>
          <input
            className={`app-input${fieldError('batch_number') ? ' app-input--error' : ''}`}
            type="text"
            value={form.batch_number}
            onChange={(e) => updateField('batch_number', e.target.value)}
            onBlur={() => {
              if (form.batch_number && form.item_code) {
                validateBatchAgainstSap(form.batch_number, form.item_code);
              }
            }}
            placeholder={t('quality.batchNumber')}
          />
          {fieldError('batch_number') && (
            <span className="form-field__hint grpo-field-error">
              {fieldError('batch_number')}
            </span>
          )}
        </label>

        {/* Manufacturing Date */}
        <label className="form-field">
          <span>{t('quality.manufacturingDate')} *</span>
          <input
            className={`app-input${fieldError('manufacturing_date') ? ' app-input--error' : ''}`}
            type="date"
            value={form.manufacturing_date}
            onChange={(e) => updateField('manufacturing_date', e.target.value)}
          />
          {fieldError('manufacturing_date') && <span className="form-field__hint grpo-field-error">{fieldError('manufacturing_date')}</span>}
        </label>

        {/* Admission Date */}
        <label className="form-field">
          <span>{t('quality.admissionDate')} *</span>
          <input
            className={`app-input${fieldError('admission_date') ? ' app-input--error' : ''}`}
            type="date"
            value={form.admission_date}
            onChange={(e) => updateField('admission_date', e.target.value)}
          />
          {fieldError('admission_date') && <span className="form-field__hint grpo-field-error">{fieldError('admission_date')}</span>}
        </label>

        {/* Expiry Date (Optional) */}
        <label className="form-field">
          <span>{t('quality.expiryDate')} ({t('common.optional') || 'Optional'})</span>
          <input
            className="app-input"
            type="date"
            value={form.expiry_date}
            onChange={(e) => updateField('expiry_date', e.target.value)}
          />
        </label>
      </div>
      {renderWizardNav()}
    </section>
  );

  const renderManualReviewStep = () => {
    const selectedWarehouse = warehouses.find((w) => (w.code || w.WarehouseCode) === form.warehouse_code);
    const selectedGroup = itemGroups.find((g) => g.code === form.item_group_code);

    return (
      <section className="card-panel quality-wizard-card--wide grpo-draft-card">
        <div className="quality-wizard-heading">
          <h1 className="page-title">{t('quality.manualStepReviewTitle')}</h1>
          <p className="quality-wizard-subtitle">{t('quality.manualStepReviewDesc')}</p>
        </div>

        <div className="feedback-message feedback-message--info grpo-draft-card__notice" style={{ marginBottom: '18px' }}>
          {t('grpo.reviewPhase1Prompt')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '24px' }}>
          {/* Section 1: Shipment & Vehicle */}
          <div className="grpo-review-section">
            <h3 className="grpo-review-section__title">
              🚚 {t('quality.manualSteps.vehicle')}
            </h3>
            <div className="grpo-review-grid">
              {renderInfoItem(t('quality.containerNumber'), form.car_number)}
              {renderInfoItem(t('quality.noPacked'), form.container_quantity !== undefined && form.container_quantity !== null && form.container_quantity !== '' ? form.container_quantity : '0')}
              {hasValue(form.vendor_ref_no) && renderInfoItem(t('quality.vendorRefNo'), form.vendor_ref_no)}
              {renderInfoItem(t('quality.grpoComments'), form.comments || '-')}
            </div>
          </div>

          {/* Section 2: Supplier */}
          <div className="grpo-review-section">
            <h3 className="grpo-review-section__title">
              🏢 {t('quality.manualSteps.supplier')}
            </h3>
            <div className="grpo-review-grid">
              {renderInfoItem(t('quality.vendorName'), `${fmtValue(form.vendor_card_code)} - ${fmtValue(form.vendor_name)}`)}
            </div>
          </div>

          {/* Section 3: Product & Material */}
          <div className="grpo-review-section">
            <h3 className="grpo-review-section__title">
              📦 {t('quality.manualSteps.product')}
            </h3>
            <div className="grpo-review-grid">
              {renderInfoItem(t('quality.itemGroup'), selectedGroup?.name || form.item_group_code || '-')}
              {renderInfoItem(t('quality.productName'), `${fmtValue(form.item_code)} - ${fmtValue(form.item_name)}`)}
              {renderInfoItem(t('quality.grpoQuantity'), `${form.quantity} ${form.uom_name || form.uom_code || 'KG'}`)}
              {renderInfoItem(t('quality.unitOfMeasure'), form.uom_name || form.uom_code || 'KG')}
            </div>
          </div>

          {/* Section 4: Warehouse & Bin */}
          <div className="grpo-review-section">
            <h3 className="grpo-review-section__title">
              📍 {t('quality.manualSteps.warehouse')}
            </h3>
            <div className="grpo-review-grid">
              {renderInfoItem(t('quality.selectWarehouse'), selectedWarehouse ? `${selectedWarehouse.code || selectedWarehouse.WarehouseCode} - ${selectedWarehouse.name || selectedWarehouse.WarehouseName}` : form.warehouse_code || '-')}
              {renderInfoItem(t('quality.binLocation'), form.bin_code ? `${form.bin_code}${selectedBin?.name ? ` - ${selectedBin.name}` : ''}` : '-')}
            </div>
          </div>

          {/* Section 5: Batch & Dates */}
          {hasValue(form.batch_number) && (
            <div className="grpo-review-section">
              <h3 className="grpo-review-section__title">
                🏷️ {t('quality.manualSteps.batch')}
              </h3>
              <div className="grpo-review-grid">
                {renderInfoItem(t('quality.batchNumber'), form.batch_number)}
                {renderInfoItem(t('quality.manufacturingDate'), form.manufacturing_date)}
                {renderInfoItem(t('quality.admissionDate'), form.admission_date)}
                {renderInfoItem(t('quality.expiryDate'), form.expiry_date || '-')}
              </div>
            </div>
          )}
        </div>

        {Object.keys(errors).length > 0 && (
          <div className="feedback-message feedback-message--error grpo-validation-summary">
            {t('quality.validationErrorsFound')}
          </div>
        )}
        {renderWizardNav()}
      </section>
    );
  };

  const renderCurrentStep = () => {
    const renderItemFields = () => (
      <div className="quality-form-grid qrev-meta-grid">
        {renderInput({ field: 'item_code', label: t('quality.itemCode'), value: form.item_code || draft?.item_code, readOnly: true })}
        {renderInput({ field: 'item_name', label: t('quality.productName'), value: form.item_name || draft?.item_name, readOnly: true })}
        {renderInput({ field: 'quantity', label: t('quality.grpoQuantity'), type: 'number', step: 'any' })}
        {renderReadonlyField('uom_code', t('quality.unitOfMeasure'), form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code, t('quality.uomRequired'))}
        {renderInput({ field: 'unit_price', label: t('quality.unitPrice'), type: 'number', step: '0.000001' })}
        <label className="form-field">
          <span>{t('quality.taxCode')}</span>
          <SearchableSelect
            className={`app-input${fieldError('tax_code') ? ' app-input--error' : ''}`}
            value={form.tax_code || ''}
            disabled={!canEdit || taxCodesLoading}
            loading={taxCodesLoading}
            onChange={(val) => {
              const nextVal = typeof val === 'object' && val !== null ? (val.target?.value ?? '') : String(val ?? '');
              updateField('tax_code', nextVal);
            }}
            placeholder={taxCodesLoading ? t('common.loading') : t('quality.selectTaxCode')}
          >
            <option value="">{taxCodesLoading ? t('common.loading') : t('quality.selectTaxCode')}</option>
            {form.tax_code && !taxCodes.some((tc) => (tc.value || tc.TaxCode || tc.code) === form.tax_code) && (
              <option value={form.tax_code}>{form.tax_code}</option>
            )}
            {taxCodes.map((tc) => {
              const code = tc.value || tc.code || tc.TaxCode;
              const rate = tc.rate ?? tc.VatPercent ?? 0;
              const name = tc.name || tc.TaxName;
              const label = tc.label || (name && name !== code ? `${code} (${rate}%) - ${name}` : `${code} (${rate}%)`);
              return (
                <option key={code} value={code}>
                  {label}
                </option>
              );
            })}
          </SearchableSelect>
          {fieldError('tax_code') && <span className="form-field__hint grpo-field-error">{fieldError('tax_code')}</span>}
        </label>
        {renderInput({ field: 'discount_percent', label: t('quality.discountPercent'), type: 'number', step: '0.0001' })}
        <label className="form-field">
          <span>{`${t('quality.location')} (${t('common.optional')})`}</span>
          <SearchableSelect
            className="app-input"
            value={form.location || ''}
            disabled={!canEdit || costCentersLoading}
            loading={costCentersLoading}
            onChange={(event) => updateField('location', event.target.value)}
            placeholder={costCentersLoading ? t('common.loading') : t('quality.selectLocationOptional')}
          >
            <option value="">{costCentersLoading ? t('common.loading') : t('quality.selectLocationOptional')}</option>
            {form.location && !costCentersDim1.some((cc) => cc.code === form.location) && (
              <option value={form.location}>{form.location}</option>
            )}
            {costCentersDim1.map((cc) => (
              <option key={cc.code} value={cc.code}>
                {cc.code} - {cc.name}
              </option>
            ))}
          </SearchableSelect>
          {costCenterError1 && (
            <span className="form-field__hint grpo-field-error">
              {t('quality.costCenterLoadFailed')}
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => reloadCostCenter(1)}
              >
                {t('common.retry')}
              </button>
            </span>
          )}
        </label>
        <label className="form-field">
          <span>{`${t('quality.general')} (${t('common.optional')})`}</span>
          <SearchableSelect
            className="app-input"
            value={form.general || ''}
            disabled={!canEdit || costCentersLoading}
            loading={costCentersLoading}
            onChange={(event) => updateField('general', event.target.value)}
            placeholder={costCentersLoading ? t('common.loading') : t('quality.selectGeneralOptional')}
          >
            <option value="">{costCentersLoading ? t('common.loading') : t('quality.selectGeneralOptional')}</option>
            {form.general && !costCentersDim2.some((cc) => cc.code === form.general) && (
              <option value={form.general}>{form.general}</option>
            )}
            {costCentersDim2.map((cc) => (
              <option key={cc.code} value={cc.code}>
                {cc.code} - {cc.name}
              </option>
            ))}
          </SearchableSelect>
          {costCenterError2 && (
            <span className="form-field__hint grpo-field-error">
              {t('quality.costCenterLoadFailed')}
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => reloadCostCenter(2)}
              >
                {t('common.retry')}
              </button>
            </span>
          )}
        </label>
      </div>
    );



    // Manual Intake flow: steps 0 to 7 (operational, batches, and review handled by common step index branches)
    if (isManual) {
      if (activeStep === 0) return renderManualVehicleStep();
      if (activeStep === 1) return renderManualSupplierStep();
      if (activeStep === 2) return renderManualProductStep();
      if (activeStep === 3) return renderManualWarehouseStep();
      if (activeStep === 4) {
        return (
          <section className="card-panel quality-wizard-card--wide grpo-draft-card">
            <div className="quality-wizard-heading">
              <h1 className="page-title">{t('quality.grpoSteps.manualItemWarehouse')}</h1>
              <p className="quality-wizard-subtitle">{t('quality.grpoItemDetailsDesc')}</p>
            </div>
            <div className="feedback-message feedback-message--info grpo-draft-card__notice">
              {t('grpo.manualIntakeNotice')}
            </div>

            {/* SECTION 1: بيانات الصنف والتسعير */}
            <div className="grpo-review-section" style={{ marginTop: '16px', marginBottom: '24px' }}>
              <h3 className="grpo-review-section__title">
                📦 {t('quality.grpoSteps.itemAndPricingSection')}
              </h3>
              {renderItemFields()}
            </div>

            {/* SECTION 2: المخزن والخلية التخزينية */}
            <div className="grpo-review-section" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
              <h3 className="grpo-review-section__title">
                📍 {t('quality.grpoSteps.warehouseAndBinSection')}
              </h3>
              {renderWarehouseFields()}
            </div>

            {renderWizardNav()}
          </section>
        );
      }
      if (activeStep === 6) return renderManualReviewStep();
      if (activeStep === 7) return renderManualBatchStep();
    }

    // Standard / Quality / Weighbridge GRPO flow: 5 steps intact
    if (!isManual && activeStep === itemIndex) {
      return (
        <section className="card-panel quality-wizard-card--wide grpo-draft-card">
          <div className="quality-wizard-heading">
            <h1 className="page-title">{t('quality.grpoItemDetails')}</h1>
            <p className="quality-wizard-subtitle">{t('quality.grpoItemDetailsDesc')}</p>
          </div>
          {renderItemFields()}
          {renderWizardNav()}
        </section>
      );
    }

    if (!isManual && activeStep === warehouseIndex) {
      return (
        <section className="card-panel quality-wizard-card--wide grpo-draft-card">
          <div className="quality-wizard-heading">
            <h1 className="page-title">{t('quality.grpoSteps.warehouse')}</h1>
            <p className="quality-wizard-subtitle">{t('quality.warehouseBinDesc')}</p>
          </div>
          {renderWarehouseFields()}
          {renderWizardNav()}
        </section>
      );
    }

  const renderBatchDataStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('quality.batchDataTitle')}</h1>
        <p className="quality-wizard-subtitle">{t('quality.batchDataDesc')}</p>
      </div>

      {/* ── Balance Indicator Banner ── */}
      <div className={`batch-balance-banner ${isBalanced ? 'batch-balance-banner--success' : 'batch-balance-banner--warning'}`}>
        <div className="batch-balance-metrics">
          <div className="batch-balance-metric">
            <span className="batch-balance-label">{t('quality.totalRequiredQty')}</span>
            <strong className="batch-balance-val">
              {requiredQty} {form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code || 'KG'}
            </strong>
          </div>
          <div className="batch-balance-metric">
            <span className="batch-balance-label">{t('quality.allocatedQty')}</span>
            <strong className="batch-balance-val">
              {totalAllocated} {form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code || 'KG'}
            </strong>
          </div>
          <div className="batch-balance-metric">
            <span className="batch-balance-label">{t('quality.remainingBalance')}</span>
            <strong
              className="batch-balance-val"
              style={{ color: isBalanced ? 'var(--success, #2e7d32)' : 'var(--danger, #c62828)' }}
            >
              {remainingBalance} {form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code || 'KG'}
            </strong>
          </div>
        </div>
        <div className="batch-balance-status">
          {isBalanced ? (
            <span className="batch-balance-msg batch-balance-msg--ok">
              ✅ {t('quality.quantitiesBalanced')}
            </span>
          ) : (
            <span className="batch-balance-msg batch-balance-msg--err">
              ⚠️ {t('quality.quantityMismatch', Math.abs(remainingBalance).toFixed(3))}
            </span>
          )}
        </div>
      </div>

      {errors.batches_balance && (
        <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
          {errors.batches_balance}
        </div>
      )}

      {/* ── Batches List ── */}
      <div className="batch-list" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {batches.map((batch, index) => {
          const subStep = batchSubSteps[batch.id] ?? (isPosted ? 2 : 0);
          const isConfirmed = subStep >= 2;
          const attrIdx = batchAttrIdx[batch.id] ?? 0;
          const attrDef = ATTR_FIELDS[attrIdx] || ATTR_FIELDS[0];

          const rawAttrOpts = attrDef.text
            ? []
            : attrDef.key === 'company'
              ? companyOptions
              : attrDef.key === 'vendor'
                ? getBatchFieldOptions('vendor', batch.vendor, [
                    ...(form.vendor_name ? [{ value: form.vendor_name, label: form.vendor_name }] : []),
                    ...farms.map((f) => ({ value: f.name, label: `${f.code} - ${f.name}` })),
                  ])
                : getBatchFieldOptions(attrDef.key, batch[attrDef.stateKey]);

          const goToSubStep = (nextSub) => {
            setBatchSubSteps((s) => ({ ...s, [batch.id]: nextSub }));
          };

          const attrNext = () => {
            if (attrIdx < ATTR_FIELDS.length - 1) {
              setBatchAttrIdx((s) => ({ ...s, [batch.id]: attrIdx + 1 }));
            } else {
              setBatchAttrIdx((s) => ({ ...s, [batch.id]: 0 }));
              setBatchSubSteps((s) => ({ ...s, [batch.id]: 2 }));
            }
          };

          const attrPrev = () => {
            if (attrIdx > 0) {
              setBatchAttrIdx((s) => ({ ...s, [batch.id]: attrIdx - 1 }));
            } else {
              setBatchSubSteps((s) => ({ ...s, [batch.id]: 0 }));
            }
          };

          /* ── SUB-STEP 2: CONFIRMED COMPACT SUMMARY ── */
          if (isConfirmed) {
            return (
              <article key={batch.id} className="batch-card batch-card--confirmed">
                <div className="batch-card__header">
                  <div className="batch-card__title">
                    <span className="batch-card__index batch-card__index--success">
                      ✅ {t('quality.batchLabel', index + 1)}
                    </span>
                    <strong style={{ fontSize: '13px' }}>
                      🏷️ {batch.batch_number || t('quality.batchRequired')}
                    </strong>
                  </div>
                  {canEdit && (
                    <div className="batch-card__actions grpo-batch-card-actions">
                      <button
                        type="button"
                        className="app-button app-button--secondary batch-card__action-btn"
                        onClick={() => goToSubStep(0)}
                      >
                        {t('quality.editBatch')}
                      </button>
                      <button
                        type="button"
                        className="app-button app-button--secondary batch-card__action-btn"
                        onClick={() => handleDuplicateBatch(batch)}
                      >
                        {t('quality.duplicateBatch')}
                      </button>
                      {batches.length > 1 && (
                        <button
                          type="button"
                          className="app-button app-button--secondary batch-card__action-btn"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => handleRemoveBatch(batch.id)}
                        >
                          {t('quality.removeBatch')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="details-grid details-grid--sm">
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.grpoQuantity')}</span>
                    <input
                      className="app-input"
                      type="number"
                      step="any"
                      min="0"
                      value={batch.quantity ?? 0}
                      readOnly={!canEdit}
                      onChange={(e) => handleBatchChange(batch.id, 'quantity', e.target.value)}
                    />
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.binLocation')}</span>
                    <div className="detail-item__value detail-item__value--sm">
                      {batch.bin_location_code || '-'}
                    </div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.manufacturingDate')}</span>
                    <div className="detail-item__value detail-item__value--sm">
                      {batch.manufacturing_date || '-'}
                    </div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.admissionDate')}</span>
                    <div className="detail-item__value detail-item__value--sm">
                      {batch.admission_date || '-'}
                    </div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.batchAttrs.vendor')}</span>
                    <div className="detail-item__value detail-item__value--sm">{batch.vendor || '-'}</div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.batchAttrs.part')}</span>
                    <div className="detail-item__value detail-item__value--sm">{batch.part || '-'}</div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.batchAttrs.company')}</span>
                    <div className="detail-item__value detail-item__value--sm">{batch.company || '-'}</div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.batchAttrs.season')}</span>
                    <div className="detail-item__value detail-item__value--sm">{batch.season || '-'}</div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.batchAttrs.batchAttribute1')}</span>
                    <div className="detail-item__value detail-item__value--sm">{batch.batch_attribute_1 || '-'}</div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--xs">{t('quality.batchAttrs.batchAttribute2')}</span>
                    <div className="detail-item__value detail-item__value--sm">{batch.batch_attribute_2 || '-'}</div>
                  </div>
                </div>
              </article>
            );
          }

          /* ── SUB-STEP 0 & 1: ACTIVE BATCH MINI-WIZARD ── */

          return (
            <article key={batch.id} className="batch-card batch-card--active">
              <div className="batch-card__header">
                <div className="batch-card__title">
                  <span className="batch-card__index">{t('quality.batchLabel', index + 1)}</span>
                  <strong style={{ fontSize: '13px' }}>
                    🏷️ {batch.batch_number || t('quality.batchRequired')}
                  </strong>
                </div>
                {batches.length > 1 && canEdit && (
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    onClick={() => handleRemoveBatch(batch.id)}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Sub-step indicator */}
              <div className="attr-stepper-scroll" style={{ marginBottom: '16px' }}>
                <div className="attr-stepper-row">
                  <button
                    type="button"
                    className="attr-stepper-btn"
                    data-attr-active={String(subStep === 0)}
                    onClick={() => goToSubStep(0)}
                  >
                    <div
                      className="attr-stepper-circle"
                      style={{
                        background: subStep > 0 ? 'var(--success)' : 'var(--primary)',
                        color: '#fff',
                      }}
                    >
                      {subStep > 0 ? '✓' : '1'}
                    </div>
                    <span className="attr-stepper-label">{t('quality.basicAndBin')}</span>
                  </button>
                  <div
                    className="attr-connector"
                    style={{ background: subStep > 0 ? 'var(--success)' : 'var(--border)' }}
                  />
                  <button
                    type="button"
                    className="attr-stepper-btn"
                    data-attr-active={String(subStep === 1)}
                    onClick={() => goToSubStep(1)}
                  >
                    <div
                      className="attr-stepper-circle"
                      style={{
                        background: subStep === 1 ? 'var(--primary)' : 'var(--bg-muted)',
                        color: subStep === 1 ? '#fff' : 'var(--text-subtle)',
                      }}
                    >
                      2
                    </div>
                    <span className="attr-stepper-label">{t('quality.batchProperties')}</span>
                  </button>
                </div>
              </div>

              {/* ── Sub-step 0: Basic & Bin ── */}
              {subStep === 0 && (
                <div className="wizard-bin-wrap">
                  <div className="quality-form-grid qrev-meta-grid" style={{ marginBottom: '16px' }}>
                    <label className="form-field">
                      <span>{t('quality.batchNumber')} *</span>
                      <input
                        className="app-input"
                        type="text"
                        value={batch.batch_number}
                        onChange={(e) => handleBatchChange(batch.id, 'batch_number', e.target.value)}
                        placeholder={t('quality.batchNumber')}
                      />
                    </label>
                    <label className="form-field">
                      <span>{t('quality.grpoQuantity')} *</span>
                      <input
                        className="app-input"
                        type="number"
                        step="any"
                        min="0"
                        value={batch.quantity}
                        onChange={(e) => handleBatchChange(batch.id, 'quantity', e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{t('quality.manufacturingDate')}</span>
                      <input
                        className="app-input"
                        type="date"
                        value={batch.manufacturing_date}
                        onChange={(e) => handleBatchChange(batch.id, 'manufacturing_date', e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{t('quality.admissionDate')}</span>
                      <input
                        className="app-input"
                        type="date"
                        value={batch.admission_date}
                        onChange={(e) => handleBatchChange(batch.id, 'admission_date', e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{t('quality.expiryDate')}</span>
                      <input
                        className="app-input"
                        type="date"
                        value={batch.expiry_date}
                        onChange={(e) => handleBatchChange(batch.id, 'expiry_date', e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="grpo-assigned-bin-badge" style={{ marginTop: '8px', marginBottom: '16px', padding: '10px 14px', background: 'var(--bg-muted, #f8f9fa)', borderRadius: '6px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.2rem' }}>📍</span>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>{t('quality.binLocation')}</div>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          {batch.bin_location_code || form.bin_code || '-'}
                        </div>
                      </div>
                    </div>
                    {form.warehouse_code && (
                      <span className="rr-status-badge rr-status-badge--info" style={{ fontSize: '0.75rem' }}>
                        {form.warehouse_code}
                      </span>
                    )}
                  </div>

                  <div className="wizard-nav-row" style={{ marginTop: '16px' }}>
                    <button
                      type="button"
                      className="app-button app-button--primary app-button--block wizard-nav-btn--sm"
                      onClick={() => goToSubStep(1)}
                    >
                      {t('common.next')} ({t('quality.batchProperties')}) ➔
                    </button>
                  </div>
                </div>
              )}

              {/* ── Sub-step 1: Batch Properties (6 attributes) ── */}
              {subStep === 1 && (
                <div>
                  {batchAttributesLoading && (
                    <div className="feedback-message feedback-message--info" style={{ marginBottom: '14px' }}>
                      ⏳ {t('common.loading')}
                    </div>
                  )}

                  {/* Attr Stepper Row */}
                  <div className="attr-stepper-scroll">
                    <div className="attr-stepper-row">
                      {ATTR_FIELDS.map((field, i) => {
                        const isDone = i < attrIdx;
                        const isActive = i === attrIdx;
                        return (
                          <React.Fragment key={field.key}>
                            <button
                              type="button"
                              onClick={() => setBatchAttrIdx((s) => ({ ...s, [batch.id]: i }))}
                              className="attr-stepper-btn"
                              data-attr-active={String(isActive)}
                            >
                              <div
                                className="attr-stepper-circle"
                                style={{
                                  background: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--bg-muted)',
                                  color: isDone || isActive ? '#fff' : 'var(--text-subtle)',
                                  border: `1.5px solid ${isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--border)'}`,
                                }}
                              >
                                {isDone ? '✓' : i + 1}
                              </div>
                              <span
                                className="attr-stepper-label"
                                style={{
                                  fontWeight: isActive ? 700 : 500,
                                  color: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--text-subtle)',
                                }}
                              >
                                {t(field.labelKey) || field.label}
                              </span>
                            </button>
                            {i < ATTR_FIELDS.length - 1 && (
                              <div
                                className="attr-connector"
                                style={{ background: i < attrIdx ? 'var(--success)' : 'var(--border)' }}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {/* Current Attribute Header */}
                  <div style={{ margin: '14px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong>
                      {attrIdx + 1}. {t(attrDef.labelKey) || attrDef.label}
                    </strong>
                    {batch[attrDef.stateKey] && (
                      <span className="attr-selected-chip">✓ {batch[attrDef.stateKey]}</span>
                    )}
                  </div>

                  {/* Non-text attribute cards */}
                  {!attrDef.text && (() => {
                    const isBrand = attrDef.key === 'brand';
                    const isEmpty = !batch[attrDef.stateKey];
                    return (
                      <div
                        className="attr-options-grid"
                        style={{
                          gridTemplateColumns: `repeat(auto-fill, minmax(${isBrand ? '120px' : '105px'}, 1fr))`,
                          marginBottom: '16px',
                        }}
                      >
                        <button
                          type="button"
                          className={`attr-option-empty${isEmpty ? ' attr-option-empty--selected' : ''}`}
                          onClick={() => {
                            handleBatchChange(batch.id, attrDef.stateKey, '');
                            attrNext();
                          }}
                        >
                          <span className="attr-option-empty__icon">⊘</span>
                          <span>{t('wizard.empty') || 'Empty'}</span>
                        </button>

                        {rawAttrOpts.map((opt) => {
                          const selected = batch[attrDef.stateKey] === opt.value;
                          const brandImg = isBrand ? getBrandImage(opt.value) : null;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              style={{
                                position: 'relative',
                                padding: isBrand ? '12px 8px 10px' : '10px 8px',
                                border: '2px solid',
                                borderRadius: '10px',
                                background: selected && !isBrand ? 'var(--primary)' : 'transparent',
                                borderColor: selected ? 'var(--primary)' : 'var(--border)',
                                boxShadow: selected && isBrand ? '0 0 0 1px var(--primary)' : 'none',
                                color: selected && !isBrand ? '#fff' : 'var(--text)',
                                cursor: 'pointer',
                                fontSize: isBrand ? '11px' : '13px',
                                fontWeight: selected ? 700 : 400,
                                textAlign: 'center',
                                lineHeight: 1.3,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '7px',
                                transition: 'border-color 0.12s, background 0.12s',
                              }}
                              onClick={() => {
                                handleBatchChange(batch.id, attrDef.stateKey, opt.value);
                                attrNext();
                              }}
                            >
                              {isBrand && <BrandAvatar src={brandImg} label={opt.label} selected={selected} />}
                              <span>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Text input attribute */}
                  {attrDef.text && (
                    <div className="form-field" style={{ marginBottom: '16px' }}>
                      <input
                        className="app-input"
                        type="text"
                        value={batch[attrDef.stateKey] || ''}
                        placeholder={attrDef.placeholder || t(attrDef.labelKey) || attrDef.label}
                        onChange={(e) => handleBatchChange(batch.id, attrDef.stateKey, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && attrNext()}
                      />
                    </div>
                  )}

                  {/* Sub-step 1 Nav */}
                  <div className="wizard-nav-row">
                    <button
                      type="button"
                      className="app-button app-button--secondary wizard-nav-btn--sm"
                      onClick={attrPrev}
                    >
                      {t('common.previous')}
                    </button>
                    <button
                      type="button"
                      className="app-button app-button--primary app-button--block wizard-nav-btn--sm"
                      onClick={attrNext}
                    >
                      {attrIdx === ATTR_FIELDS.length - 1 ? `✓ ${t('quality.doneBatch')}` : `${t('common.next')} ➔`}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* ── Add Batch Button ── */}
      {canEdit && (
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={handleAddBatch}
          >
            {t('quality.addBatch')}
          </button>
        </div>
      )}

      {renderWizardNav()}
    </section>
  );

    if (activeStep === operationalIndex) {
      return (
        <section className="card-panel quality-wizard-card--wide grpo-draft-card">
          <div className="quality-wizard-heading">
            <h1 className="page-title">{t('quality.grpoSteps.operational')}</h1>
            <p className="quality-wizard-subtitle">{t('quality.batchInfoDesc')}</p>
          </div>
          <div className="grpo-status-strip">
            <span className="section-kicker">{t('quality.grpoDraftStatus')}</span>
            <span className={`rr-status-badge rr-status-badge--${draft?.status || 'DRAFT'}`}>{statusLabel(draft?.status)}</span>
          </div>
          {renderSapDocumentInfo()}
          <div className="grpo-review-grid" style={{ marginBottom: '20px' }}>
            {renderInfoItem(t('quality.colInspectionId'), draft?.inspection || '-')}
            {renderInfoItem(t('quality.productName'), `${fmtValue(form.item_code || draft?.item_code)} - ${fmtValue(form.item_name || draft?.item_name)}`)}
            {renderInfoItem(t('quality.grpoQuantity'), `${fmtValue(form.quantity)} ${fmtValue(form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code)}`)}
            {renderInfoItem(t('quality.selectWarehouse'), form.warehouse_code || '-')}
            {renderInfoItem(t('quality.binLocation'), form.bin_code || '-')}
          </div>
          <div className="quality-form-grid qrev-meta-grid">
            {renderInput({
              field: 'car_number',
              label: t('quality.containerNumber'),
              value: form.car_number || draft?.inspection_context?.car_number || draft?.car_number || '-',
              readOnly: !isManualDraft || !canEdit,
            })}
            <label className="form-field">
              <span>{t('quality.noPacked')} *</span>
              <input
                className={`app-input${fieldError('container_quantity') ? ' app-input--error' : ''}`}
                type="number"
                min="0"
                step="1"
                value={form.container_quantity}
                disabled={!canEdit}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    updateField('container_quantity', '');
                    return;
                  }
                  if (/^\d+$/.test(val)) {
                    updateField('container_quantity', val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === '.' || e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                    e.preventDefault();
                  }
                }}
                onBlur={() => {
                  if (form.container_quantity === '') {
                    updateField('container_quantity', '0');
                  }
                }}
              />
              {fieldError('container_quantity') && <span className="form-field__hint grpo-field-error">{fieldError('container_quantity')}</span>}
            </label>
            {renderInput({ field: 'posting_date', label: t('quality.postingDate'), type: 'date' })}
            {renderInput({ field: 'document_date', label: t('quality.documentDate'), type: 'date' })}
            {renderInput({ field: 'due_date', label: t('quality.dueDate'), type: 'date' })}
            {renderInput({ field: 'vendor_ref_no', label: t('quality.vendorRefNo'), placeholder: t('quality.vendorRefNoPlaceholder') })}
            {renderInput({ field: 'journal_remark', label: t('quality.journalRemark'), placeholder: t('quality.journalRemarkPlaceholder') })}
            <label className="form-field quality-form-field--full">
              <span>{t('quality.grpoComments')}</span>
              <textarea
                className="app-input"
                rows={3}
                value={form.comments}
                readOnly={!canEdit}
                onChange={(event) => updateField('comments', event.target.value)}
              />
            </label>
          </div>
          {renderWizardNav()}
        </section>
      );
    }

    if (activeStep === batchesIndex) {
      return renderBatchDataStep();
    }

    return (
      <section className="card-panel quality-wizard-card--wide grpo-draft-card">
        <div className="quality-wizard-heading">
          <h1 className="page-title">{t('quality.grpoReviewPostingTitle')}</h1>
          <p className="quality-wizard-subtitle">{t('quality.grpoReviewPostingDesc')}</p>
        </div>
        <div className="grpo-review-grid">
          {renderInfoItem(t('quality.colInspectionId'), draft.inspection)}
          {renderInfoItem(t('quality.grpoDraftStatus'), statusLabel(draft.status))}
          {hasSapDocumentInfo && renderInfoItem(t('grpo.documentStatus'), statusLabel(draft.status))}
          {hasSapDocumentInfo && renderInfoItem(t('quality.sapDocEntry'), draft.sap_doc_entry)}
          {hasSapDocumentInfo && renderInfoItem(t('grpo.referenceNumber'), draft.sap_doc_num)}
          {renderInfoItem(t('quality.vendorName'), `${fmtValue(form.vendor_card_code)} - ${fmtValue(form.vendor_name)}`)}
          {draft?.quotation && renderInfoItem('مرجع الشحن المرتبط', `#${draft.quotation_number || draft.quotation}${draft.quotation_sap_doc_entry ? ` (المرجع: ${draft.quotation_sap_doc_entry})` : ''}`)}
          {renderInfoItem(t('quality.containerNumber'), form.car_number || draft?.inspection_context?.car_number || draft?.car_number || '-')}
          {renderInfoItem(t('quality.noPacked'), form.container_quantity !== undefined && form.container_quantity !== null && form.container_quantity !== '' ? form.container_quantity : (draft?.container_quantity ?? '0'))}
          {renderInfoItem(t('quality.productName'), `${fmtValue(form.item_code || draft?.item_code)} - ${fmtValue(form.item_name || draft?.item_name)}`)}
          {renderInfoItem(t('quality.grpoQuantity'), `${fmtValue(form.quantity)} ${fmtValue(form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code)}`)}
          {renderInfoItem(t('quality.unitPrice'), form.unit_price)}
          {renderInfoItem(t('quality.postingDate'), form.posting_date)}
          {renderInfoItem(t('quality.documentDate'), form.document_date)}
          {renderInfoItem(t('quality.dueDate'), form.due_date)}
          {renderInfoItem(t('quality.vendorRefNo'), form.vendor_ref_no)}
          {renderInfoItem(t('quality.journalRemark'), form.journal_remark)}
          {renderInfoItem(t('quality.taxCode'), form.tax_code)}
          {renderInfoItem(t('quality.discountPercent'), form.discount_percent)}
          {renderInfoItem(t('quality.location'), getCostCenterDisplay(form.location, costCentersDim1))}
          {renderInfoItem(t('quality.general'), getCostCenterDisplay(form.general, costCentersDim2))}
          {renderInfoItem(t('quality.selectWarehouse'), form.warehouse_code)}
          {renderInfoItem(t('quality.binLocation'), form.bin_code)}
          {renderInfoItem(t('quality.batchNumber'), form.batch_number)}
          {renderInfoItem(t('quality.manufacturingDate'), form.manufacturing_date)}
          {renderInfoItem(t('quality.admissionDate'), form.admission_date)}
          {renderInfoItem(t('quality.expiryDate'), form.expiry_date)}
        </div>

        {/* Batch Allocation Breakdown */}
        {batches.length > 0 && (
          <div className="grpo-review-section" style={{ marginTop: '24px' }}>
            <h3 className="grpo-review-section__title">
              🏷️ {t('quality.batchBreakdown')} ({batches.length})
            </h3>
            <div className="grpo-review-batches-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
              {batches.map((batch, bIdx) => (
                <div
                  key={batch.id || bIdx}
                  className="card-panel"
                  style={{ background: 'var(--bg-muted, #f8f9fa)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                    <strong>{t('quality.batchLabel', bIdx + 1)}: {batch.batch_number || '-'}</strong>
                    <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                      {fmtValue(batch.quantity)} {form.uom_name || form.uom_code || draft?.uom_name || draft?.uom_code || ''}
                    </span>
                  </div>
                  <div className="details-grid details-grid--sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📍</span>{t('quality.binLocation')}</span><div className="detail-item__value">{batch.bin_location_code || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.manufacturingDate')}</span><div className="detail-item__value">{batch.manufacturing_date || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.admissionDate')}</span><div className="detail-item__value">{batch.admission_date || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.expiryDate')}</span><div className="detail-item__value">{batch.expiry_date || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏢</span>{t('quality.batchAttrs.vendor')}</span><div className="detail-item__value">{batch.vendor || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏷️</span>{t('quality.batchAttrs.part')}</span><div className="detail-item__value">{batch.part || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏢</span>{t('quality.batchAttrs.company')}</span><div className="detail-item__value">{batch.company || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">📅</span>{t('quality.batchAttrs.season')}</span><div className="detail-item__value">{batch.season || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏷️</span>{t('quality.batchAttrs.batchAttribute1')}</span><div className="detail-item__value">{batch.batch_attribute_1 || '-'}</div></div>
                    <div className="detail-item detail-item--sm"><span className="detail-item__label"><span className="meta-label-icon" aria-hidden="true">🏷️</span>{t('quality.batchAttrs.batchAttribute2')}</span><div className="detail-item__value">{batch.batch_attribute_2 || '-'}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grpo-preview-actions">
          <button
            type="button"
            className="app-button app-button--secondary app-button--compact"
            onClick={handlePreviewPosting}
            disabled={previewLoading || !canPostToSap}
          >
            {previewLoading ? t('common.pleaseWait') : t('quality.checkGrpoPostingReadiness')}
          </button>
        </div>

        {postingPreview && (
          <div className="feedback-message feedback-message--info grpo-draft-card__notice">
            {t('quality.grpoPostingReadinessReady')}
          </div>
        )}

        {Object.keys(errors).length > 0 && (
          <div className="feedback-message feedback-message--error grpo-validation-summary">
            {t('quality.validationErrorsFound')}
          </div>
        )}
        {renderWizardNav()}
      </section>
    );
  };

  return (
    <div className="page-shell quality-wizard grpo-draft-page">
      <header className="page-header grpo-wizard-page-header">
        <div>
          <span className="section-kicker">
            {isManual
              ? `${t('grpo.continuousWorkflow')} • ${t('grpo.manualPhaseTitle')}`
              : isStandaloneGrpo
                ? (t('grpo.kicker') || 'Receiving')
                : t('quality.purchaseGrpoKicker')}
          </span>
          <h1 className="page-title">
            {isManual
              ? t('grpo.manualReceivingTitle')
              : postedViewOnly
                ? t('quality.purchaseGrpoDocumentTitle')
                : t('quality.purchaseGrpoDraftTitle')}
          </h1>
        </div>
        <div className="grpo-header-actions">
          {!postedViewOnly && !isPosted && Boolean(draft) && (
            <button
              type="button"
              className="app-button app-button--secondary qrev-header-button"
              onClick={loadDraft}
              disabled={saving || approving || posting || loading}
            >
              {t('quality.reloadDraft')}
            </button>
          )}
          <button
            type="button"
            className="app-button app-button--secondary qrev-header-button"
            onClick={handleBack}
          >
            {t('common.back')}
          </button>
        </div>
      </header>

      {loading ? (
        <section className="card-panel quality-wizard-card--wide grpo-draft-card">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '1.25rem' }}>
            <AppSpinner size="md" label={t('common.loading')} />
            <LoadingSkeleton rows={4} style={{ width: '100%', maxWidth: '600px' }} />
          </div>
        </section>
      ) : (!draft && !isManualCreate) ? (
        <section className="card-panel quality-wizard-card--wide grpo-draft-card">
          <div className="feedback-message feedback-message--error">
            {t('quality.grpoDraftNotFound')}
          </div>
        </section>
      ) : isInvalidPostedDocumentView ? (
        <section className="card-panel quality-wizard-card--wide grpo-draft-card">
          <div className="feedback-message feedback-message--error">
            {t('quality.grpoDocumentNotPosted')}
          </div>
        </section>
      ) : isPosted ? (
        renderPostedSummary()
      ) : (
        <>
          {isManual && (
            <ContinuousPhaseTracker
              activeStep={activeStep}
              draft={draft}
              t={t}
            />
          )}

          <div className="quality-stepper grpo-stepper">
            <Stepper
              activeStep={activeStep}
              alternativeLabel
              nonLinear
              className="quality-mui-stepper"
            >
              {wizardSteps.map(({ id, labelKey, icon }, index) => {
                const canClick = index <= maxReachedStep;
                return (
                  <Step key={id} completed={index < activeStep}>
                    <StepButton
                      disabled={!canClick}
                      onClick={() => goToStep(index)}
                    >
                      <StepLabel icon={icon} slots={{ stepIcon: GrpoStepIcon }}>
                        {t(labelKey)}
                      </StepLabel>
                    </StepButton>
                  </Step>
                );
              })}
            </Stepper>
          </div>

          <div className="quality-step-viewport grpo-step-viewport">
            {renderCurrentStep()}
          </div>
        </>
      )}

      {/* Hidden printable sheet for GRPO direct print */}
      {printingRecord && (
        <div
          className="qrev-print-report"
          aria-hidden="true"
          style={{ display: 'none' }}
          ref={printContainerRef}
        >
          <div
            className="a4-print-sheet"
            style={{
              position: 'relative',
              width: '100%',
              minHeight: '297mm',
              boxSizing: 'border-box',
              direction: 'rtl',
            }}
          >
            {/* Top Logo Section */}
            <div className="report-print-logo-row">
              <div className="report-header-brand">
                <img
                  src={egastLogo}
                  alt="EGAST Group"
                  className="report-header-logo"
                />
                <div className="report-header-text">
                  <h2>الشركة المصرية للخدمات الزراعية (إيجاست)</h2>
                  <p>SHIPPING &amp; RECEIVING OPERATIONS</p>
                </div>
              </div>
              <div className="report-doc-no">
                <span className="report-badge">مستند استلام مسجل</span>
                <PrintDocumentBarcode identification={printingRecord._printIdentification} />
              </div>
            </div>

            {/* Main Title */}
            <div className="report-main-title">
              <h1>مستند استلام</h1>
              <span>GOODS RECEIVING DOCUMENT</span>
            </div>

            {/* Metadata Grid */}
            <div className="report-info-grid">
              <div className="info-cell">
                <span className="cell-lbl">رقم المرجع الداخلي:</span>{' '}
                <strong>#{printingRecord.id}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">رقم المستند (SAP):</span>{' '}
                <strong>{printingRecord.sap_doc_num || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">DocEntry (SAP):</span>{' '}
                <strong>{printingRecord.sap_doc_entry || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">رقم التشغيلة:</span>{' '}
                <strong>{printingRecord.batch_number || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">رقم السيارة:</span>{' '}
                <strong>{printingRecord.car_number || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">المورد:</span>{' '}
                <strong>{printingRecord.vendor_name || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">كود المورد:</span>{' '}
                <strong>{printingRecord.vendor_card_code || '-'}</strong>
              </div>
              {printingRecord.vendor_ref_no && (
                <div className="info-cell">
                  <span className="cell-lbl">رقم مرجع المورد:</span>{' '}
                  <strong>{printingRecord.vendor_ref_no}</strong>
                </div>
              )}
              <div className="info-cell">
                <span className="cell-lbl">كود الصنف:</span>{' '}
                <strong>{printingRecord.item_code || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">اسم الصنف:</span>{' '}
                <strong>{printingRecord.item_name || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">الكمية المستلمة:</span>{' '}
                <strong>
                  {Number(printingRecord.quantity || 0).toLocaleString()} {printingRecord.uom_name || printingRecord.uom_code || 'KG'}
                </strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">المستودع:</span>{' '}
                <strong>{printingRecord.warehouse_code || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">الموقع:</span>{' '}
                <strong>{printingRecord.bin_code || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">تاريخ الاستلام:</span>{' '}
                <strong>{printingRecord.posted_at ? String(printingRecord.posted_at).slice(0, 10) : (printingRecord.posting_date || '-')}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">تاريخ المستند:</span>{' '}
                <strong>{printingRecord.document_date || '-'}</strong>
              </div>
              <div className="info-cell">
                <span className="cell-lbl">حالة المستند:</span>{' '}
                <strong style={{ color: '#16a34a' }}>تم تسجيل الاستلام في SAP</strong>
              </div>
            </div>

            {/* Line Items Table */}
            <h4 className="report-section-header" style={{ marginTop: '24px' }}>
              بيانات البنود المستلمة (Received Items)
            </h4>
            <table
              className="excel-matrix-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginBottom: '24px',
                fontSize: '12px',
              }}
            >
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', width: '40px' }}>#</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start' }}>كود الصنف</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start' }}>الوصف / المنتج</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>المخزن</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>الموقع</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>رقم التشغيلة</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end' }}>الكمية</th>
                  <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>الوحدة</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>1</td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start', fontFamily: 'monospace' }}>
                    {printingRecord.item_code || '-'}
                  </td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start', fontWeight: 600 }}>
                    {printingRecord.item_name || '-'}
                  </td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                    {printingRecord.warehouse_code || '-'}
                  </td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                    {printingRecord.bin_code || '-'}
                  </td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', fontFamily: 'monospace' }}>
                    {printingRecord.batch_number || '-'}
                  </td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end', fontWeight: 700 }}>
                    {Number(printingRecord.quantity || 0).toLocaleString()}
                  </td>
                  <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                    {printingRecord.uom_name || printingRecord.uom_code || 'KG'}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Signatures */}
            <div className="report-signature-row" style={{ marginTop: '48px' }}>
              <div className="sig-column">
                <p>أمين المستودع (المستلم)</p>
                <div className="sig-line" />
                <span className="sig-date-placeholder">التوقيع والتاريخ</span>
              </div>
              <div className="sig-column">
                <p>مسؤول فحص الجودة</p>
                <div className="sig-line" />
                <span className="sig-date-placeholder">التوقيع والتاريخ</span>
              </div>
              <div className="sig-column">
                <p>مدير إدارة المشتريات / المخازن</p>
                <div className="sig-line" />
                <span className="sig-date-placeholder">التوقيع والتاريخ</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PurchaseGRPODraftPage;
