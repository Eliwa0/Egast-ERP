import StandardDropdown from '../components/ui/StandardDropdown';
import ProductionPalletCards from '../components/ProductionPalletCards';
import '../styles/pages/receipt-quantity.css';
import { PrintActionButton } from '../components/ui/ActionIconButton';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import Loading from '../components/Loading';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { canManageProduction } from '../utils/roles';
import {
  escapeHtml, getCleanProductName, getUomMeasurement, printBatchLabels,
} from '../utils/printBatchLabels';

// ── brand images (drop files into src/assets/brands/ — auto-discovered) ───────
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

// ── helpers ───────────────────────────────────────────────────────────────────

const formatSapDate = (dateStr) => {
  if (!dateStr) return '—';
  const s = String(dateStr).split('T')[0].replace(/-/g, '');
  if (s.length !== 8 || !/^\d{8}$/.test(s)) return String(dateStr);
  return `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
};

const formatLocalDate = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const normalizeDateForCompare = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';

  const dateOnly = text.split('T')[0].split(' ')[0];

  let match = dateOnly.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = dateOnly.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatLocalDate(parsed);

  return '';
};

const getOrderCompareDate = (order) => (
  normalizeDateForCompare(order?.postDate) ||
  normalizeDateForCompare(order?.orderDate) ||
  normalizeDateForCompare(order?.OrderDate) ||
  normalizeDateForCompare(order?.PostingDate) ||
  normalizeDateForCompare(order?.PostDate)
);

const countRuleValues = (rules = {}) =>
  Object.values(rules || {}).reduce((sum, values) => (
    sum + (Array.isArray(values) ? values.length : 0)
  ), 0);

const ruleKeys = (rules = {}) => Object.keys(rules || {});

const traceRules = (label, payload = {}) => {
  console.log('[RULE-TRACE][FE]', label, {
    at: performance.now().toFixed(1),
    ...payload,
  });
};


import { getProductIcon } from '../utils/productIcon';

const getUomRuleValue = (uom) =>
  String(uom?.uomEntry ?? uom?.UomEntry ?? uom?.value ?? uom?.AbsEntry ?? uom?.absEntry ?? '').trim();

// Returns true only for KG / ton UOMs — grams, liters, and count units are excluded.
const isWeightBasedUom = (uom) => {
  const text = `${uom?.label || ''} ${uom?.code || ''} ${uom?.uomName || ''} ${uom?.name || ''}`.toLowerCase();

  // Reject grams first (before any weight check)
  if (
    text.includes('جرام') || text.includes('gram') || text.includes('grams') ||
    /\bgm\b/.test(text) || /\b g\b/.test(text) || /\bg\b/.test(text)
  ) return false;

  return (
    text.includes('كيلو') || text.includes('kg') ||
    text.includes('طن')   || text.includes('ton') ||
    text.includes('pallet') || text.includes('بالت') || text.includes('بالة')
  );
};

// Applies order + user + warehouse rules as an intersection filter (UI-only — never touches state/payload).
// If a rule list is absent or empty it is skipped (all-allowed). Intersection = only values present in ALL applicable rules.
const applyAllowedRules = (fieldKey, options, orderRules, userRules, warehouseAttrRules) => {
  let visible = options;
  const orderAllowed = orderRules?.[fieldKey];
  if (Array.isArray(orderAllowed) && orderAllowed.length > 0) {
    const s = new Set(orderAllowed);
    visible = visible.filter((o) => s.has(o.value));
  }
  const userAllowed = userRules?.[fieldKey];
  if (Array.isArray(userAllowed) && userAllowed.length > 0) {
    const s = new Set(userAllowed);
    visible = visible.filter((o) => s.has(o.value));
  }
  const whAllowed = warehouseAttrRules?.[fieldKey];
  if (Array.isArray(whAllowed) && whAllowed.length > 0) {
    const s = new Set(whAllowed);
    visible = visible.filter((o) => s.has(o.value));
  }
  return visible;
};

const STEPS = [
  { labelKey: 'wizard.stepOrder',      icon: '📦' },
  { labelKey: 'wizard.stepQuantity',   icon: '⚖️' },
  { labelKey: 'wizard.stepBatchSetup', icon: '🏷️' },
  { labelKey: 'wizard.stepReview',     icon: '📋' },
  { labelKey: 'wizard.stepDone',       icon: '🎉' },
];

const BATCH_MINI_STEPS = [
  { labelKey: 'wizard.subBin',        icon: '📍' },
  { labelKey: 'wizard.subAttributes', icon: '⚙️' },
  { labelKey: 'wizard.subReview',     icon: '✓'  },
];

const makeBatchId = () => `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const deepCloneBatch = (batch) => {
  if (typeof structuredClone === 'function') return structuredClone(batch);
  return JSON.parse(JSON.stringify(batch));
};

const isTargetBatch = (batch, id, targetIndex, currentIndex) => (
  String(batch.id) === String(id) && (targetIndex === undefined || targetIndex === currentIndex)
);

const ATTR_FIELDS = [
  { key: 'size',                stateKey: 'size',               label: 'Size' },
  { key: 'brand',               stateKey: 'brand',              label: 'Brand' },
  { key: 'category',            stateKey: 'category',           label: 'Category' },
  { key: 'packing',             stateKey: 'packing',            label: 'Packing' },
  { key: 'season',              stateKey: 'season',             label: 'Season' },
  { key: 'extra_specification', stateKey: 'extraSpecification', label: 'Extra Spec.' },
  { key: 'vendor',              stateKey: 'vendor',             label: 'Vendor' },
  { key: 'part',                stateKey: 'part',               label: 'Part' },
  { key: 'company',             stateKey: 'company',            label: 'Company' },
  { key: 'number',              stateKey: 'number',             label: 'Number',  text: true },
  { key: 'details',             stateKey: 'details',            label: 'Details', text: true, placeholder: 'Optional notes' },
];

// ── step indicator ────────────────────────────────────────────────────────────

const DONE_STEP = STEPS.length - 1;

function StepBar({ step, maxReachedStep, onStepClick, receiptPosted }) {
  const { t } = useI18n();
  const stepbarRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const activeStep = stepbarRef.current?.querySelector('.wizard-step--active');
    activeStep?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [step]);

  return (
    <div className="wizard-stepbar-wrap" ref={stepbarRef}>
      {STEPS.map(({ labelKey, icon }, i) => {
        const isDone   = i < step;
        const isActive = i === step;
        const canClick = i === DONE_STEP
          ? (step === DONE_STEP || !!receiptPosted)
          : i <= maxReachedStep;
        const cls = [
          'wizard-step',
          isDone   ? 'wizard-step--done'      : '',
          isActive ? 'wizard-step--active'    : '',
          canClick ? 'wizard-step--clickable' : 'wizard-step--locked',
        ].filter(Boolean).join(' ');
        return (
          <React.Fragment key={labelKey}>
            <div
              className={cls}
              onClick={() => canClick && onStepClick(i)}
              title={!canClick ? t('wizard.unlockHint') : undefined}
            >
              <div className="wizard-step__circle">
                {isDone ? '✓' : icon}
              </div>
              <span className="wizard-step__label">{t(labelKey)}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`wizard-connector${isDone ? ' wizard-connector--done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MiniStepBar({ currentStep, maxReachedStep, onStepClick }) {
  const { t } = useI18n();
  return (
    <div className="mini-wizard-wrap">
      {BATCH_MINI_STEPS.map(({ labelKey, icon }, i) => {
        const isDone   = i < currentStep;
        const isActive = i === currentStep;
        const canClick = i <= maxReachedStep;
        const cls = [
          'mini-wizard-step',
          isDone   ? 'mini-wizard-step--done'      : '',
          isActive ? 'mini-wizard-step--active'    : '',
          canClick ? 'mini-wizard-step--clickable' : 'mini-wizard-step--locked',
        ].filter(Boolean).join(' ');
        return (
          <React.Fragment key={labelKey}>
            <div
              className={cls}
              onClick={() => canClick && onStepClick(i)}
              title={!canClick ? t('wizard.unlockHint') : undefined}
            >
              <div className="mini-wizard-step__circle">
                {isDone ? '✓' : icon}
              </div>
              <span className="mini-wizard-step__label">{t(labelKey)}</span>
            </div>
            {i < BATCH_MINI_STEPS.length - 1 && (
              <div className={`mini-wizard-connector${isDone ? ' mini-wizard-connector--done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

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


// ── safe timer helpers (module-level — survive StrictMode remounts) ───────────
// Prevents "Timer already exists" / "Timer does not exist" console warnings
// that occur when React StrictMode fires effects twice.
const _activeTimers = new Set();
const safeTime = (label) => {
  if (_activeTimers.has(label)) return;
  _activeTimers.add(label);
  console.time(label);
};
const safeTimeEnd = (label) => {
  if (!_activeTimers.has(label)) return;
  _activeTimers.delete(label);
  console.timeEnd(label);
};

const MAX_TOTAL_BATCHES = 10;

// ── wizard ────────────────────────────────────────────────────────────────────

function ReceiptWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const ar = lang === 'ar';
  const isAdmin = canManageProduction(user);
  const [step, setStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);

  // step 0 — order list
  const [openOrders, setOpenOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateDisplay, setDateDisplay] = useState(() => {
    const iso = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; // dd/mm/yyyy
  });
  const [dateInvalid, setDateInvalid] = useState(false);

  const handleDateInput = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    setDateDisplay(formatted);

    const m = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
      const valid = dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1000;
      setDateFilter(valid ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : '');
      setDateInvalid(!valid);
    } else {
      setDateFilter('');
      setDateInvalid(false);
    }
  };
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [userWarehouse, setUserWarehouse] = useState(() => localStorage.getItem('userWarehouse') || '');

  // loaded after order selected
  const [orderFull, setOrderFull] = useState(null);
  const [itemName, setItemName] = useState('');
  const [warehouse, setWarehouse] = useState(null);
  const [binLocations, setBinLocations] = useState([]);
  const [binLocationsLoading, setBinLocationsLoading] = useState(false);
  const [binLocationsError, setBinLocationsError] = useState(false);
  const [batchAttributes, setBatchAttributes] = useState({});
  const [batchAttributesLoading, setBatchAttributesLoading] = useState(false);
  const [batchAttributesError, setBatchAttributesError] = useState(false);
  const [uomOptions, setUomOptions] = useState([]);
  const [uomDisplayOptions, setUomDisplayOptions] = useState([]);
  const [selectedUom, setSelectedUom] = useState(null);
  const [companyOptions, setCompanyOptions] = useState([]);
  const [batchUdfMetadata, setBatchUdfMetadata] = useState({});
  const [nextBatchReservation, setNextBatchReservation] = useState({ batch_number: '', reservation_id: null });
  const [addingBatch, setAddingBatch] = useState(false);
  const [loadingOrderData, setLoadingOrderData] = useState(false);
  const [orderLoadError, setOrderLoadError] = useState('');

  // per-item caches (refs = no re-render, always current in callbacks)
  const itemNameCacheRef       = useRef({});
  const itemAttrCacheRef       = useRef({});
  const binLocationsCacheRef   = useRef({}); // { [warehouseCode]: locations[] }
  const orderRulesCacheRef         = useRef({});  // { [docEntry]: rules }
  const orderVisCacheRef           = useRef({});  // { [docEntry]: hiddenFields[] }
  const warehouseRulesCacheRef     = useRef({});  // { [warehouseCode]: hiddenFields[] }
  const warehouseAttrRulesCacheRef = useRef({}); // { [warehouseCode]: { field_key: [values] } }
  const ruleTraceSeqRef            = useRef(0);
  const nextRuleTraceId = (label) => {
    ruleTraceSeqRef.current += 1;
    return `${label}#${ruleTraceSeqRef.current}`;
  };

  // refs for attribute stepper scroll containers — keyed by batch.id
  const attrStepperScrollRefs = useRef({});
  const batchCardRefs = useRef({});

  // load-once guards — React StrictMode fires each useEffect twice in dev;
  // these refs (preserved across the strict-mode remount) prevent duplicate SAP requests.
  const openOrdersLoadedRef  = useRef(false);
  const generalDataLoadedRef = useRef(false);
  const userRulesLoadedRef   = useRef(false);

  // step 1 — quantity
  const [quantity, setQuantity] = useState('');
  const [palletTypes, setPalletTypes] = useState([]);
  const [palletTypeId, setPalletTypeId] = useState('');
  const [palletTypesError, setPalletTypesError] = useState('');
  const [palletTypesLoading, setPalletTypesLoading] = useState(true);
  const [manualPalletQuantity, setManualPalletQuantity] = useState(false);
  useEffect(() => {
    API.get('/production/pallet-types/').then(({ data }) => {
      setPalletTypes(data.types || []);
    })
      .catch((err) => setPalletTypesError(err.message)).finally(() => setPalletTypesLoading(false));
  }, [ar]);
  const palletError = (batch) => {
    if (batch.palletTypeId === 'none') return '';
    if (!batch.palletTypeId) return ar ? 'اختر نوع البالتة أو تخطَّ لو بدون بالتات.' : 'Choose a pallet type, or skip if there are no pallets.';
    if (!palletTypes.length) return '';
    const type = palletTypes.find((row) => String(row.id) === String(batch.palletTypeId));
    if (!type) return ar ? 'اختر نوع البالتة' : 'Choose a pallet type';
    if (!(Number(batch.quantity) > 0)) return ar ? 'وزن البالتة يجب أن يكون أكبر من صفر.' : 'Pallet weight must be greater than zero.';
    if (Number(batch.quantity) > Number(type.capacity_kg)) return ar ? `نوع ${type.name} يسمح بحد أقصى ${type.capacity_kg} كجم. الوزن المدخل ${batch.quantity} كجم.` : `${type.name} allows at most ${type.capacity_kg} kg. Entered weight: ${batch.quantity} kg.`;
    return '';
  };
  const [unitCount, setUnitCount] = useState(''); // number of UOM packages; '' = not yet entered
  const [uomSearch, setUomSearch] = useState('');

  // step 2 — batch setup
  const [batches, setBatches] = useState([]);
  const [batchSubSteps, setBatchSubSteps] = useState({});      // { [id]: 0-5 }
  const [batchSubMaxReached, setBatchSubMaxReached] = useState({}); // { [id]: max sub-step reached }
  const [batchEditQtySteps, setBatchEditQtySteps] = useState({}); // edit-only qty pre-screen by batch id
  const [batchAttrIdx, setBatchAttrIdx] = useState({});        // { [id]: 0..ATTR_FIELDS.length-1 }
  const [batchAttrMaxReached, setBatchAttrMaxReached] = useState({}); // { [id]: max index reached }
  const [binSearches, setBinSearches] = useState({});                 // { [id]: search string }
  const [orderAttributeRules, setOrderAttributeRules] = useState({}); // { field_key: [allowed values] } — {} = no rules
  const [orderHiddenFields, setOrderHiddenFields]     = useState([]); // fields hidden by order visibility rule
  const [userAttributeRules, setUserAttributeRules]   = useState({});   // loaded once on mount
  const [userHiddenFields, setUserHiddenFields]       = useState([]); // fields hidden by user visibility rule
  const [warehouseHiddenFields, setWarehouseHiddenFields] = useState([]); // fields hidden for current warehouse
  const [warehouseAttrRules, setWarehouseAttrRules]   = useState({});   // { field_key: [allowed values] } per warehouse

  // step 3 / 4 — submit + complete
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [receiptResult, setReceiptResult] = useState(null);

  // ── derived ────────────────────────────────────────────────────────────────
  const orderNumber = orderFull?.DocumentNumber || orderFull?.DocNum || selectedOrder?.orderNumber;
  const itemCode = orderFull?.ItemNo || orderFull?.ItemCode || selectedOrder?.itemCode;
  const displayedItemName = itemName || orderFull?.ItemName || orderFull?.ItemDescription || itemCode || '';
  const plannedQty = orderFull?.PlannedQuantity || selectedOrder?.plannedQty || 0;
  const completedQty = orderFull?.CompletedQuantity || selectedOrder?.completedQty || 0;
  const remainingQty = plannedQty - completedQty;

  useEffect(() => {
    traceRules('wizard-user-state', {
      user,
      hasUser: Boolean(user),
      isAdmin,
      userWarehouse,
      openOrdersLoaded: openOrdersLoadedRef.current,
      userRulesLoaded: userRulesLoadedRef.current,
    });
  }, [user, isAdmin, userWarehouse]);

  // uomMeasurement: parsed from name first, SAP fields as fallback
  const uomMeasurement = useMemo(() => getUomMeasurement(selectedUom), [selectedUom]);
  const uomFactor = uomMeasurement.factor;

  // log on UOM selection for debugging
  useEffect(() => {
    if (selectedUom) {
      console.log('UOM selected:', selectedUom);
      console.log('UOM measurement:', getUomMeasurement(selectedUom));
    }
  }, [selectedUom]);

  // quantity = what goes to SAP = unitCount × uomFactor; '' when unitCount not yet entered
  // Once batches exist, batch rows are the source of truth and sync the header totals.
  useEffect(() => {
    if (step >= 2 && batches.length > 0) return;
    if (manualPalletQuantity) return;
    if (unitCount === '') { setQuantity(''); return; }
    setQuantity(Math.round(Number(unitCount) * uomFactor * 1000) / 1000);
  }, [unitCount, uomFactor, step, batches.length, manualPalletQuantity]);

  // ── fetch open orders ──────────────────────────────────────────────────────
  // Guard: runs exactly once — even under React StrictMode double-invocation.
  // ordersError is set ONLY when this specific request fails.
  useEffect(() => {
    if (openOrdersLoadedRef.current) return;
    openOrdersLoadedRef.current = true;
    (async () => {
      try {
        const res = await API.get('/open-production-orders/');
        if (res.data.success && Array.isArray(res.data.data?.orders)) {
          setOpenOrders(res.data.data.orders);
        } else {
          setOrdersError('No orders returned.');
        }
      } catch {
        setOrdersError('Could not load open production orders.');
      } finally {
        setOrdersLoading(false);
      }
    })();
  }, []);

  // ── load general (non-order-specific) data once on mount ─────────────────
  // Rules:
  //   • Each request fires independently — a slow SAP call never blocks the others.
  //   • open-production-orders / item-attributes / next-batch / bin-locations
  //     must NOT appear here.
  //   • All requests are optional: failures warn to console and leave state empty.
  //   • Guard ref prevents double-fire under React StrictMode.
  useEffect(() => {
    if (generalDataLoadedRef.current) return;
    generalDataLoadedRef.current = true;

    safeTime('fetch-uoms');
    API.get('/uoms/')
      .then((res) => {
        safeTimeEnd('fetch-uoms');
        if (res.data.data?.uoms) setUomOptions(res.data.data.uoms);
      })
      .catch((err) => {
        safeTimeEnd('fetch-uoms');
        console.warn('fetch-uoms failed:', err?.response?.data || err.message);
      });

    safeTime('fetch-batch-udf-metadata');
    API.get('/batch-udf-metadata/')
      .then((res) => {
        safeTimeEnd('fetch-batch-udf-metadata');
        if (res.data.data?.fields) setBatchUdfMetadata(res.data.data.fields);
      })
      .catch((err) => {
        safeTimeEnd('fetch-batch-udf-metadata');
        console.warn('fetch-batch-udf-metadata failed:', err?.response?.data || err.message);
      });

    safeTime('fetch-uom-options');
    API.get('/uom-options/')
      .then((res) => {
        safeTimeEnd('fetch-uom-options');
        const rawUoms =
          Array.isArray(res.data)             ? res.data :
          Array.isArray(res.data?.results)    ? res.data.results :
          Array.isArray(res.data?.value)      ? res.data.value :
          Array.isArray(res.data?.uoms)       ? res.data.uoms :
          Array.isArray(res.data?.data?.uoms) ? res.data.data.uoms :
          [];
        setUomDisplayOptions(rawUoms);
      })
      .catch((err) => {
        safeTimeEnd('fetch-uom-options');
        console.warn('fetch-uom-options failed:', err?.response?.data || err.message);
      });

    safeTime('fetch-company-options');
    API.get('/company-options/')
      .then((res) => {
        safeTimeEnd('fetch-company-options');
        const raw = res.data;
        const list =
          Array.isArray(raw?.companies)       ? raw.companies :
          Array.isArray(raw?.data?.companies) ? raw.data.companies :
          [];
        setCompanyOptions(list.map((c) => ({ value: c.value ?? c, label: c.label ?? c.value ?? c })));
      })
      .catch((err) => {
        safeTimeEnd('fetch-company-options');
        console.warn('fetch-company-options failed:', err?.response?.data || err.message);
      });
  }, []);

  // ── load current user's attribute rules + visibility once on mount ──────
  useEffect(() => {
    if (userRulesLoadedRef.current) return;
    userRulesLoadedRef.current = true;
    const traceId = nextRuleTraceId('user-rules');
    traceRules('user-rules/request-start', {
      traceId,
      user,
      hasUser: Boolean(user),
      sessionMaybeHydrating: !user,
    });
    Promise.allSettled([
      API.get('/user-attribute-rules/me/'),
      API.get('/user-attribute-visibility/me/'),
    ]).then(([rulesRes, visRes]) => {
      const rules = rulesRes.status === 'fulfilled' ? rulesRes.value.data.data?.rules || {} : {};
      const hidden = visRes.status === 'fulfilled' ? visRes.value.data.data?.hidden_fields || [] : [];
      traceRules('user-rules/response', {
        traceId,
        rulesStatus: rulesRes.status,
        visibilityStatus: visRes.status,
        rulesKeys: ruleKeys(rules),
        rulesCount: ruleKeys(rules).length,
        valueCount: countRuleValues(rules),
        hiddenFieldsCount: hidden.length,
        receivedEmptyRules: ruleKeys(rules).length === 0,
        receivedEmptyHiddenFields: hidden.length === 0,
        rulesError: rulesRes.status === 'rejected' ? (rulesRes.reason?.response?.data || rulesRes.reason?.message) : null,
        visibilityError: visRes.status === 'rejected' ? (visRes.reason?.response?.data || visRes.reason?.message) : null,
      });
      setUserAttributeRules(rules);
      setUserHiddenFields(hidden);
    });
  }, []);

  // ── auto-scroll active attribute chip into view (mobile UX) ──────────────
  useEffect(() => {
    Object.keys(batchAttrIdx).forEach((batchId) => {
      const container = attrStepperScrollRefs.current[batchId];
      if (!container) return;
      const activeBtn = container.querySelector('[data-attr-active="true"]');
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
  }, [batchAttrIdx]);

  // ── batch attributes — background loader (slow SAP call, cached per itemCode) ─
  const loadBatchAttributesForItem = useCallback((itemCode) => {
    if (!itemCode) return;
    if (itemAttrCacheRef.current[itemCode]) {
      setBatchAttributes(itemAttrCacheRef.current[itemCode]);
      setBatchAttributesLoading(false);
      setBatchAttributesError(false);
      return;
    }
    setBatchAttributesLoading(true);
    setBatchAttributesError(false);
    setBatchAttributes({});

    const handleAttrSuccess = (res) => {
      const data = res.data.data || {};
      itemAttrCacheRef.current[itemCode] = data;
      setBatchAttributes(data);
      setBatchAttributesError(false);
      setBatchAttributesLoading(false);
    };
    const handleAttrFail = (err) => {
      console.error('Batch attributes failed:', err?.response?.data || err);
      setBatchAttributesError(true);
      setBatchAttributesLoading(false);
    };

    API.get(`/item-batch-attributes/${itemCode}/`)
      .then(handleAttrSuccess)
      .catch(() => {
        // auto-retry once after 1 s before showing the warning
        setTimeout(() => {
          API.get(`/item-batch-attributes/${itemCode}/`)
            .then(handleAttrSuccess)
            .catch(handleAttrFail);
        }, 1000);
      });
  }, []);

  // ── bin locations — loader & cache per warehouseCode ────────────────────────
  const loadBinLocationsForWarehouse = useCallback((whCode) => {
    if (!whCode) return Promise.resolve([]);
    if (binLocationsCacheRef.current[whCode]) {
      setBinLocations(binLocationsCacheRef.current[whCode]);
      setBinLocationsLoading(false);
      setBinLocationsError(false);
      return Promise.resolve(binLocationsCacheRef.current[whCode]);
    }
    setBinLocationsLoading(true);
    setBinLocationsError(false);
    return API.get(`/bin-locations/${whCode}/`)
      .then((r) => {
        if (r.data?.success && Array.isArray(r.data?.data?.locations)) {
          const bins = r.data.data.locations.filter((l) => (l.code || '').startsWith(`${whCode}-`));
          const result = bins.length > 0 ? bins : r.data.data.locations;
          setBinLocations(result);
          binLocationsCacheRef.current[whCode] = result;
          setBinLocationsError(false);
          return result;
        } else {
          setBinLocations([]);
          return [];
        }
      })
      .catch((err) => {
        console.error('Bin locations failed:', err?.response?.data || err);
        setBinLocationsError(true);
        return [];
      })
      .finally(() => {
        setBinLocationsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (warehouse?.code && binLocations.length === 0 && !binLocationsLoading && !binLocationsError) {
      loadBinLocationsForWarehouse(warehouse.code);
    }
  }, [warehouse?.code, binLocations.length, binLocationsLoading, binLocationsError, loadBinLocationsForWarehouse]);

  // ── load order data after selection ───────────────────────────────────────
  const loadOrderData = useCallback(async (order) => {
    const loadTraceId = nextRuleTraceId('order-load');
    traceRules('order-load/start', {
      traceId: loadTraceId,
      order,
      currentUser: user,
      currentWarehouseState: warehouse,
      cacheSizes: {
        orderRules: Object.keys(orderRulesCacheRef.current).length,
        orderVisibility: Object.keys(orderVisCacheRef.current).length,
        warehouseVisibility: Object.keys(warehouseRulesCacheRef.current).length,
        warehouseAttrRules: Object.keys(warehouseAttrRulesCacheRef.current).length,
      },
    });
    setLoadingOrderData(true);
    const docNum = order.orderNumber;
    const iCode  = order.itemCode;
    console.time('load-order-data');
    console.log('Selecting order:', docNum, iCode);
    try {
      // 1. order full details (always fresh — drives docEntry for everything else)
      console.time('fetch-order-full');
      const fullRes = await API.get(`/production-orders/by-number/${docNum}/`);
      console.timeEnd('fetch-order-full');
      const full = fullRes.data.data?.order || null;
      if (!full) {
        throw new Error(`Order #${docNum} could not be retrieved.`);
      }
      setOrderFull(full);
      setOrderLoadError('');
      const docEntry = full?.AbsoluteEntry || full?.DocEntry;
      traceRules('order-load/full-order', {
        traceId: loadTraceId,
        docNum,
        docEntry,
        itemCode: iCode,
        hasFullOrder: Boolean(full),
      });

      // 2. Critical parallel: warehouse + item name + order rules only
      //    fetch-batch-attributes is intentionally EXCLUDED — it can take 30-60 s against SAP.
      //    Batch number reservation is deferred entirely to submit time.
      const iNamePromise = itemNameCacheRef.current[iCode]
        ? Promise.resolve({ data: { data: { item_name: itemNameCacheRef.current[iCode] } } })
        : API.get(`/item-name/${iCode}/`);

      const rulesCached = orderRulesCacheRef.current[docEntry] !== undefined;
      traceRules('order-rules/request-start', {
        traceId: loadTraceId,
        docEntry,
        fromCache: rulesCached,
        cachedKeys: rulesCached ? ruleKeys(orderRulesCacheRef.current[docEntry]) : [],
        cachedEmpty: rulesCached ? ruleKeys(orderRulesCacheRef.current[docEntry]).length === 0 : null,
      });
      const rulesPromise = rulesCached
        ? Promise.resolve({ data: { data: { rules: orderRulesCacheRef.current[docEntry] } } })
        : API.get(`/production-order-attribute-rules/${docEntry}/`);

      const orderVisCached = orderVisCacheRef.current[docEntry] !== undefined;
      traceRules('order-visibility/request-start', {
        traceId: loadTraceId,
        docEntry,
        fromCache: orderVisCached,
        cachedHiddenFieldsCount: orderVisCached ? orderVisCacheRef.current[docEntry].length : null,
        cachedEmpty: orderVisCached ? orderVisCacheRef.current[docEntry].length === 0 : null,
      });
      const orderVisPromise = orderVisCached
        ? Promise.resolve({ data: { data: { hidden_fields: orderVisCacheRef.current[docEntry] } } })
        : API.get(`/order-attribute-visibility/${docEntry}/`).catch((err) => {
            traceRules('order-visibility/request-error-fallback-empty', {
              traceId: loadTraceId,
              docEntry,
              error: err?.response?.data || err.message,
            });
            return { data: { data: { hidden_fields: [] } } };
          });

      console.time('fetch-order-parallel');
      console.time('fetch-warehouse');
      console.time('fetch-item-name');
      console.time('fetch-order-rules');

      const [whRes, iNameRes, rulesRes, orderVisRes] = await Promise.allSettled([
        API.get(`/production-order-warehouse/${docEntry}/`).then((r) => { console.timeEnd('fetch-warehouse');    return r; }),
        iNamePromise.then((r)                                           => { console.timeEnd('fetch-item-name'); return r; }),
        rulesPromise.then((r)                                           => { console.timeEnd('fetch-order-rules'); return r; }),
        orderVisPromise,
      ]);
      console.timeEnd('fetch-order-parallel');

      // item name (cached per itemCode)
      if (iNameRes.status === 'fulfilled' && iNameRes.value.data.data?.item_name) {
        const name = iNameRes.value.data.data.item_name;
        setItemName(name);
        itemNameCacheRef.current[iCode] = name;
      }

      // order attribute rules (cached per docEntry)
      if (rulesRes.status === 'fulfilled') {
        const rules = rulesRes.value.data.data?.rules || {};
        traceRules('order-rules/response-set-state', {
          traceId: loadTraceId,
          docEntry,
          status: rulesRes.status,
          rulesKeys: ruleKeys(rules),
          rulesCount: ruleKeys(rules).length,
          valueCount: countRuleValues(rules),
          receivedEmptyRules: ruleKeys(rules).length === 0,
          cacheBeforeEmpty: orderRulesCacheRef.current[docEntry] !== undefined
            ? ruleKeys(orderRulesCacheRef.current[docEntry]).length === 0
            : null,
        });
        setOrderAttributeRules(rules);
        orderRulesCacheRef.current[docEntry] = rules;
      } else {
        traceRules('order-rules/request-error-fallback-empty', {
          traceId: loadTraceId,
          docEntry,
          error: rulesRes.reason?.response?.data || rulesRes.reason?.message,
          cacheWillStoreEmpty: true,
        });
        console.warn('Order rules unavailable, falling back to show-all', rulesRes.reason);
        setOrderAttributeRules({});
        orderRulesCacheRef.current[docEntry] = {};
      }

      // order attribute visibility (hidden fields per order, cached per docEntry)
      const orderHidden = orderVisRes.status === 'fulfilled'
        ? orderVisRes.value.data.data?.hidden_fields || []
        : [];
      traceRules('order-visibility/response-set-state', {
        traceId: loadTraceId,
        docEntry,
        status: orderVisRes.status,
        hiddenFields: orderHidden,
        hiddenFieldsCount: orderHidden.length,
        receivedEmptyHiddenFields: orderHidden.length === 0,
        cacheBeforeEmpty: orderVisCacheRef.current[docEntry] !== undefined
          ? orderVisCacheRef.current[docEntry].length === 0
          : null,
      });
      setOrderHiddenFields(orderHidden);
      orderVisCacheRef.current[docEntry] = orderHidden;

      // warehouse → bin locations + visibility rules in parallel (both cached per warehouseCode)
      if (whRes.status === 'fulfilled' && whRes.value.data.success) {
        const whCode = whRes.value.data.data.warehouse_code;
        const whName = whRes.value.data.data.warehouse_name || whCode;
        traceRules('warehouse/response', {
          traceId: loadTraceId,
          docEntry,
          warehouseCode: whCode,
          warehouseName: whName,
          previousWarehouseState: warehouse,
          warehouseUndefined: !whCode,
        });
        setWarehouse({ code: whCode, name: whName });

        // Start timers before kicking off requests
        const needVisRules  = warehouseRulesCacheRef.current[whCode] === undefined;
        const needAttrRules = warehouseAttrRulesCacheRef.current[whCode] === undefined;
        if (needVisRules)  console.time('fetch-warehouse-visibility-rules');
        if (needAttrRules) console.time('fetch-warehouse-attr-rules');
        traceRules('warehouse-rules/request-plan', {
          traceId: loadTraceId,
          docEntry,
          warehouseCode: whCode,
          needVisRules,
          needAttrRules,
          cachedVisibilityCount: !needVisRules ? warehouseRulesCacheRef.current[whCode].length : null,
          cachedVisibilityEmpty: !needVisRules ? warehouseRulesCacheRef.current[whCode].length === 0 : null,
          cachedAttrKeys: !needAttrRules ? ruleKeys(warehouseAttrRulesCacheRef.current[whCode]) : [],
          cachedAttrEmpty: !needAttrRules ? ruleKeys(warehouseAttrRulesCacheRef.current[whCode]).length === 0 : null,
        });

        // Bin locations: use cache or fetch
        const binPromise = loadBinLocationsForWarehouse(whCode);

        // Warehouse visibility rules: use cache or fetch
        const visPromise = !needVisRules
          ? (
              traceRules('warehouse-visibility/cache-set-state', {
                traceId: loadTraceId,
                warehouseCode: whCode,
                hiddenFields: warehouseRulesCacheRef.current[whCode],
                hiddenFieldsCount: warehouseRulesCacheRef.current[whCode].length,
                cachedEmpty: warehouseRulesCacheRef.current[whCode].length === 0,
              }),
              setWarehouseHiddenFields(warehouseRulesCacheRef.current[whCode]),
              Promise.resolve()
            )
          : API.get(`/warehouse-attribute-visibility-rules/${whCode}/`).then((r) => {
              console.timeEnd('fetch-warehouse-visibility-rules');
              const fields = r.data.data?.hidden_fields || [];
              traceRules('warehouse-visibility/response-set-state', {
                traceId: loadTraceId,
                warehouseCode: whCode,
                hiddenFields: fields,
                hiddenFieldsCount: fields.length,
                receivedEmptyHiddenFields: fields.length === 0,
                cacheBeforeEmpty: warehouseRulesCacheRef.current[whCode] !== undefined
                  ? warehouseRulesCacheRef.current[whCode].length === 0
                  : null,
              });
              setWarehouseHiddenFields(fields);
              warehouseRulesCacheRef.current[whCode] = fields;
            }).catch((err) => {
              console.timeEnd('fetch-warehouse-visibility-rules');
              traceRules('warehouse-visibility/request-error-fallback-empty', {
                traceId: loadTraceId,
                warehouseCode: whCode,
                error: err?.response?.data || err.message,
                cacheWillStoreEmpty: true,
              });
              setWarehouseHiddenFields([]);
              warehouseRulesCacheRef.current[whCode] = [];
            });

        // Warehouse attribute rules (value filtering): use cache or fetch
        const whAttrPromise = !needAttrRules
          ? (
              traceRules('warehouse-attr-rules/cache-set-state', {
                traceId: loadTraceId,
                warehouseCode: whCode,
                rulesKeys: ruleKeys(warehouseAttrRulesCacheRef.current[whCode]),
                rulesCount: ruleKeys(warehouseAttrRulesCacheRef.current[whCode]).length,
                valueCount: countRuleValues(warehouseAttrRulesCacheRef.current[whCode]),
                cachedEmpty: ruleKeys(warehouseAttrRulesCacheRef.current[whCode]).length === 0,
              }),
              setWarehouseAttrRules(warehouseAttrRulesCacheRef.current[whCode]),
              Promise.resolve()
            )
          : API.get(`/warehouse-attribute-rules/${whCode}/`).then((r) => {
              console.timeEnd('fetch-warehouse-attr-rules');
              const rules = r.data.data?.rules || {};
              traceRules('warehouse-attr-rules/response-set-state', {
                traceId: loadTraceId,
                warehouseCode: whCode,
                rulesKeys: ruleKeys(rules),
                rulesCount: ruleKeys(rules).length,
                valueCount: countRuleValues(rules),
                receivedEmptyRules: ruleKeys(rules).length === 0,
                cacheBeforeEmpty: warehouseAttrRulesCacheRef.current[whCode] !== undefined
                  ? ruleKeys(warehouseAttrRulesCacheRef.current[whCode]).length === 0
                  : null,
              });
              setWarehouseAttrRules(rules);
              warehouseAttrRulesCacheRef.current[whCode] = rules;
            }).catch((err) => {
              console.timeEnd('fetch-warehouse-attr-rules');
              traceRules('warehouse-attr-rules/request-error-fallback-empty', {
                traceId: loadTraceId,
                warehouseCode: whCode,
                error: err?.response?.data || err.message,
                cacheWillStoreEmpty: true,
              });
              setWarehouseAttrRules({});
              warehouseAttrRulesCacheRef.current[whCode] = {};
            });

        // Await warehouse config and bin data so initial wizard step opens fully ready
        await Promise.allSettled([binPromise, visPromise, whAttrPromise]);
      } else {
        traceRules('warehouse/request-missing-or-failed', {
          traceId: loadTraceId,
          docEntry,
          status: whRes.status,
          success: whRes.status === 'fulfilled' ? whRes.value.data?.success : null,
          error: whRes.status === 'rejected' ? (whRes.reason?.response?.data || whRes.reason?.message) : null,
          warehouseStateRemains: warehouse,
        });
      }

      // Batch number is generated and reserved at submit time, not here.
      setNextBatchReservation({ batch_number: '', reservation_id: null });

      // Batch attributes: fire-and-forget — can timeout (30-60 s against SAP).
      // Cached per itemCode; shows loading indicator inside Step 3 attributes sub-step.
      loadBatchAttributesForItem(iCode);

    } catch (err) {
      traceRules('order-load/error', {
        traceId: loadTraceId,
        order,
        error: err?.response?.data || err.message,
      });
      console.error('loadOrderData error', err);
      setOrderLoadError(err?.response?.data?.error || err.message || t('common.errorLoadingData'));
    } finally {
      traceRules('order-load/end', {
        traceId: loadTraceId,
        order,
        finalStateSnapshot: {
          warehouse: warehouse?.code || null,
          orderRulesCount: ruleKeys(orderAttributeRules).length,
          userRulesCount: ruleKeys(userAttributeRules).length,
          warehouseRulesCount: ruleKeys(warehouseAttrRules).length,
          orderHiddenFieldsCount: orderHiddenFields.length,
          userHiddenFieldsCount: userHiddenFields.length,
          warehouseHiddenFieldsCount: warehouseHiddenFields.length,
        },
      });
      setLoadingOrderData(false);
      console.timeEnd('load-order-data');
    }
  }, [
    loadBatchAttributesForItem,
    loadBinLocationsForWarehouse,
    user,
    warehouse,
    orderAttributeRules,
    userAttributeRules,
    warehouseAttrRules,
    orderHiddenFields,
    userHiddenFields,
    warehouseHiddenFields,
  ]);

  // ── filtered / sorted orders ───────────────────────────────────────────────
  const availableWarehouses = useMemo(() => {
    const seen = new Set();
    return openOrders.map((o) => o.warehouse).filter((w) => w && !seen.has(w) && seen.add(w)).sort();
  }, [openOrders]);

  const filteredOrders = useMemo(() => openOrders.filter((o) => {
    if (userWarehouse && o.warehouse !== userWarehouse) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (
        !String(o.orderNumber ?? '').toLowerCase().includes(q) &&
        !String(o.itemCode ?? '').toLowerCase().includes(q) &&
        !String(o.itemName ?? '').toLowerCase().includes(q)
      ) return false;
    }
    if (o.status !== 'R') return false;
    if (dateFilter) {
      const selectedDate = normalizeDateForCompare(dateFilter);
      const orderDate = getOrderCompareDate(o);
      if (!orderDate || orderDate !== selectedDate) return false;
    }
    return true;
  }).sort((a, b) => {
    const da = getOrderCompareDate(a).replace(/-/g, '');
    const db = getOrderCompareDate(b).replace(/-/g, '');
    return db.localeCompare(da);
  }), [openOrders, search, statusFilter, dateFilter, userWarehouse]);

  const hasActiveFilters = search.trim() || statusFilter !== 'all' || dateFilter;

  // ── batch helpers ─────────────────────────────────────────────────────────
  const getUdfDefault = useCallback((key, fallback = '') => {
    const meta = batchUdfMetadata[key];
    if (!meta) return fallback;
    if (meta.default_value) return meta.default_value;
    if (meta.valid_values?.length) return meta.valid_values[0].value || fallback;
    return fallback;
  }, [batchUdfMetadata]);

  const getInitialField = useCallback((key, fallback = '') =>
    batchAttributes.latest_batch_fields?.[key] || getUdfDefault(key, fallback),
    [batchAttributes, getUdfDefault]);

  const getBatchFieldOptions = useCallback((fieldKey, currentValue = '', fallbackOptions = []) => {
    const stored = (batchAttributes.field_options?.[fieldKey] || []).map((i) => ({
      value: i.value, label: i.description && i.description !== i.value ? `${i.value} - ${i.description}` : i.value,
    }));
    const meta = (batchUdfMetadata[fieldKey]?.valid_values || []).map((i) => ({
      value: i.value, label: i.description && i.description !== i.value ? `${i.value} - ${i.description}` : i.value,
    }));
    const fallbacks = fallbackOptions
      .map((i) => typeof i === 'string' ? { value: i, label: i } : { value: i.value ?? i.code ?? '', label: i.label ?? i.name ?? i.value ?? '' })
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

  const normalizedUomOptions = useMemo(() =>
    (uomOptions || []).map((u) => ({ value: u.value, label: `${u.value} - ${u.label}` })),
    [uomOptions]);

  const ruleFilteredUomOptions = useMemo(() => {
    const normalize = (v) => { const s = String(v).trim(); const m = s.match(/^-?\d+/); return m ? m[0] : s; };
    let result = uomDisplayOptions.filter(isWeightBasedUom); // show weight-based UOMs only
    const orderAllowed = orderAttributeRules?.uom;
    if (Array.isArray(orderAllowed) && orderAllowed.length > 0) {
      const set = new Set(orderAllowed.map(normalize));
      result = result.filter((uom) => set.has(getUomRuleValue(uom)));
    }
    const userAllowed = userAttributeRules?.uom;
    if (Array.isArray(userAllowed) && userAllowed.length > 0) {
      const set = new Set(userAllowed.map(normalize));
      result = result.filter((uom) => set.has(getUomRuleValue(uom)));
    }
    const whAllowed = warehouseAttrRules?.uom;
    if (Array.isArray(whAllowed) && whAllowed.length > 0) {
      const set = new Set(whAllowed.map(normalize));
      result = result.filter((uom) => set.has(getUomRuleValue(uom)));
    }
    return result;
  }, [uomDisplayOptions, orderAttributeRules, userAttributeRules, warehouseAttrRules]);

  const findBatchUomOption = useCallback((batch) => {
    const entry = String(batch?.uom || selectedUom?.value || '').trim();
    const options = [...ruleFilteredUomOptions, ...uomDisplayOptions, selectedUom].filter(Boolean);
    return options.find((uom) => getUomRuleValue(uom) === entry) || selectedUom || null;
  }, [ruleFilteredUomOptions, uomDisplayOptions, selectedUom]);

  const getBatchUomLabel = useCallback((batch) => (
    batch?.uomLabel || findBatchUomOption(batch)?.label || selectedUom?.label || 'units'
  ), [findBatchUomOption, selectedUom]);

  const calculateBatchQuantity = useCallback((units, uom) => {
    const measurement = getUomMeasurement(uom);
    return Math.round((Number(units) || 0) * measurement.factor * 1000) / 1000;
  }, []);

  const syncReceiptTotalsFromBatches = useCallback((nextBatches) => {
    const nextUnitCount = nextBatches.reduce((sum, b) => sum + (parseInt(b.unitCount, 10) || 0), 0);
    const nextQuantity = nextBatches.reduce((sum, b) => sum + (parseFloat(b.quantity) || 0), 0);
    setUnitCount(nextUnitCount);
    setQuantity(Math.round(nextQuantity * 1000) / 1000);
  }, []);

  const visibleAttrFields = useMemo(() => {
    const allHidden = new Set([...warehouseHiddenFields, ...orderHiddenFields, ...userHiddenFields]);
    return ATTR_FIELDS.filter((f) => !allHidden.has(f.key));
  }, [warehouseHiddenFields, orderHiddenFields, userHiddenFields]);

  useEffect(() => {
    traceRules('merged-rules/state', {
      selectedOrder: selectedOrder?.orderNumber,
      warehouse: warehouse?.code || null,
      orderRulesKeys: ruleKeys(orderAttributeRules),
      orderRulesCount: ruleKeys(orderAttributeRules).length,
      userRulesKeys: ruleKeys(userAttributeRules),
      userRulesCount: ruleKeys(userAttributeRules).length,
      warehouseRulesKeys: ruleKeys(warehouseAttrRules),
      warehouseRulesCount: ruleKeys(warehouseAttrRules).length,
      orderHiddenFields,
      userHiddenFields,
      warehouseHiddenFields,
      visibleAttrFieldKeys: visibleAttrFields.map((field) => field.key),
      uomOptionsBeforeRules: uomDisplayOptions.filter(isWeightBasedUom).length,
      uomOptionsAfterRules: ruleFilteredUomOptions.length,
      anyEmptyRuleState: {
        orderRules: ruleKeys(orderAttributeRules).length === 0,
        userRules: ruleKeys(userAttributeRules).length === 0,
        warehouseRules: ruleKeys(warehouseAttrRules).length === 0,
        orderHiddenFields: orderHiddenFields.length === 0,
        userHiddenFields: userHiddenFields.length === 0,
        warehouseHiddenFields: warehouseHiddenFields.length === 0,
      },
    });
  }, [
    selectedOrder,
    warehouse,
    orderAttributeRules,
    userAttributeRules,
    warehouseAttrRules,
    orderHiddenFields,
    userHiddenFields,
    warehouseHiddenFields,
    visibleAttrFields,
    uomDisplayOptions,
    ruleFilteredUomOptions,
  ]);

  const vendorOptions = useMemo(() => {
    const stored = (batchAttributes.field_options?.vendor || []).map((i) => ({ code: i.value, name: i.description || i.value }));
    const meta = (batchUdfMetadata.vendor?.valid_values || []).map((i) => ({ code: i.value, name: i.description || i.value }));
    const seen = new Set();
    return [...stored, ...(batchAttributes.vendors || []), ...meta].filter((i) => {
      if (!i?.code || seen.has(i.code)) return false;
      seen.add(i.code);
      return true;
    });
  }, [batchAttributes, batchUdfMetadata]);

  const makeBatch = useCallback((batchNumber, qty, binCode, unitCnt = 0, reservationId = null) => {
    const bin = binLocations.find((b) => b.code === binCode);

    // Derive admission date from the production order date, not today.
    const orderDateIso = getOrderCompareDate(selectedOrder);
    const admissionDate = orderDateIso || formatLocalDate();

    return {
      id: makeBatchId(),
      palletTypeId,
      batchNumber,
      reservationId,
      autoGenerated: true,
      unitCount: unitCnt,
      quantity: qty,
      binLocationCode: binCode,
      binLocation: bin?.name || binCode,
      binAbsEntry: bin?.absEntry || '',
      mfrDate: admissionDate,
      admissionDate,
      details: '',
      size: '',
      brand: '',
      uom: '',
      uomLabel: '',
      vendor: '',
      part: '',
      category: '',
      packing: '',
      season: '',
      extraSpecification: '',
      number: '',
      company: '',
    };
  }, [binLocations, selectedOrder, palletTypeId]);

  const totalBatchQty = useMemo(() =>
    batches.reduce((s, b) => s + (parseFloat(b.quantity) || 0), 0), [batches]);
  const totalBatchUnitCount = useMemo(() =>
    batches.reduce((s, b) => s + (parseInt(b.unitCount) || 0), 0), [batches]);
  const batchTotalsMatch = Math.abs(totalBatchQty - Number(quantity || 0)) <= 0.01;
  const batchUnitCountsMatch = totalBatchUnitCount === Number(unitCount || 0);

  // ── step navigation ────────────────────────────────────────────────────────
  const goToStep = (nextStep) => {
    setStep(nextStep);
    setMaxReachedStep((prev) => Math.max(prev, nextStep));
  };

  const handleMainStepClick = (i) => {
    if (loadingOrderData) return;
    const canClick = i === DONE_STEP
      ? (step === DONE_STEP || !!receiptResult)
      : i <= maxReachedStep;
    if (canClick) setStep(i);
  };

  const handleSelectOrder = async (order) => {
    setPalletTypeId(''); setManualPalletQuantity(false);
    if (loadingOrderData) return;
    traceRules('state-reset/select-order-before-load', {
      order,
      clearing: ['orderFull', 'itemName', 'warehouse', 'binLocations', 'orderAttributeRules', 'warehouseHiddenFields'],
      notClearedHere: ['orderHiddenFields', 'warehouseAttrRules', 'userAttributeRules', 'userHiddenFields'],
      previousState: {
        warehouse: warehouse?.code || null,
        orderRulesKeys: ruleKeys(orderAttributeRules),
        orderHiddenFields,
        warehouseRulesKeys: ruleKeys(warehouseAttrRules),
        warehouseHiddenFields,
      },
    });
    setSelectedOrder(order);
    setUnitCount(1);
    setMaxReachedStep(1);
    goToStep(1);
    setLoadingOrderData(true);
    setOrderLoadError('');
    setOrderFull(null); setItemName(''); setWarehouse(null);
    setBinLocations([]); setBinLocationsLoading(false); setBinLocationsError(false);
    setNextBatchReservation({ batch_number: '', reservation_id: null });
    setBatches([]);
    setBatchEditQtySteps({});
    setReceiptResult(null); setSubmitError('');
    setSelectedUom(null);
    setOrderAttributeRules({});
    setWarehouseHiddenFields([]);
    setBatchAttributes({}); setBatchAttributesLoading(false); setBatchAttributesError(false);
    // uomDisplayOptions intentionally NOT cleared — pre-loaded on mount
    await loadOrderData(order);
  };

  const handleQuantityNext = () => {
    if (palletTypesLoading || palletTypesError) return;
    const error = palletError({ palletTypeId, quantity });
    if (error) { window.alert(error); return; }
    if (unitCount === '' || Number(unitCount) <= 0) return;
    if (quantity === '' || Number(quantity) <= 0) return;
    if (!selectedUom) return;
    const firstBatch = {
      ...makeBatch(
        '',
        quantity,
        '',
        unitCount,
        null,
      ),
      uom: selectedUom?.value || '',
      uomLabel: selectedUom?.label || '',
      palletTypeId,
    };
    setBatches([firstBatch]);
    setBatchSubSteps({ [firstBatch.id]: 0 });
    setBatchAttrIdx({ [firstBatch.id]: 0 });
    goToStep(2);
  };

  const handleBatchChange = (id, field, value, targetIndex) => {
    setBatches((prev) => prev.map((b, currentIndex) => {
      if (!isTargetBatch(b, id, targetIndex, currentIndex)) return b;
      return { ...deepCloneBatch(b), [field]: value };
    }));
  };

  const handleBinChange = (id, binCode, targetIndex) => {
    const bin = binLocations.find((b) => b.code === binCode);
    setBatches((prev) => prev.map((b, currentIndex) => !isTargetBatch(b, id, targetIndex, currentIndex) ? b : {
      ...deepCloneBatch(b), binLocationCode: binCode, binLocation: bin?.name || binCode, binAbsEntry: bin?.absEntry || '',
    }));
  };

  const handleAddBatch = () => {
    if (addingBatch) return;
    setAddingBatch(true);

    const last = batches[batches.length - 1];
    // Auto-assign remaining units to the new batch so totals balance automatically
    const usedUnits = batches.reduce((sum, b) => sum + (parseInt(b.unitCount, 10) || 0), 0);
    const remainingUnits = Math.max(0, unitCount - usedUnits);
    const newBatch = {
      ...makeBatch('', Math.round(remainingUnits * uomFactor * 1000) / 1000, last?.binLocationCode || '', remainingUnits, null),
      uom: selectedUom?.value || '',
      uomLabel: selectedUom?.label || '',
    };
    setBatches((prev) => [...prev, newBatch]);
    setBatchSubSteps((s) => ({ ...s, [newBatch.id]: 0 }));
    setBatchAttrIdx((s) => ({ ...s, [newBatch.id]: 0 }));
    setAddingBatch(false);
  };

  const handleRemoveBatch = (id) => {
    if (batches.length === 1) return;
    const nextBatches = batches.filter((b) => b.id !== id);
    if (nextBatches.length === batches.length) return;

    const nextUnitCount = nextBatches.reduce((sum, b) => sum + (parseInt(b.unitCount, 10) || 0), 0);
    const nextQuantity = nextBatches.reduce((sum, b) => sum + (parseFloat(b.quantity) || 0), 0);

    setBatches(nextBatches);
    setUnitCount(nextUnitCount);
    setQuantity(Math.round(nextQuantity * 1000) / 1000);

    const dropBatchState = (setter) => {
      setter((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };
    dropBatchState(setBatchSubSteps);
    dropBatchState(setBatchSubMaxReached);
    dropBatchState(setBatchEditQtySteps);
    dropBatchState(setBatchAttrIdx);
    dropBatchState(setBatchAttrMaxReached);
    dropBatchState(setBinSearches);
  };

  const handleDuplicateBatch = (sourceBatch) => {
    if (batches.length >= MAX_TOTAL_BATCHES) {
      window.alert(`Maximum total batches is ${MAX_TOTAL_BATCHES}.`);
      return;
    }

    // Deep-copy every field — no reference sharing.
    const clone = deepCloneBatch(sourceBatch);

    // Reset identity / SAP tracking fields.
    let cloneId = makeBatchId();
    while (batches.some((batch) => String(batch.id) === String(cloneId))) {
      cloneId = makeBatchId();
    }
    clone.id            = cloneId;
    clone.originId      = sourceBatch.originId || sourceBatch.id;  // "copy" label only
    clone.batchNumber   = '';
    clone.autoGenerated = true;
    clone.reservationId = null;

    clone.batchNumber = '';

    // Add to list already in the confirmed state — all values are pre-filled.
    setBatches((prev) => [...prev, clone]);
    setBatchSubSteps((s)      => ({ ...s, [clone.id]: 2 }));
    setBatchSubMaxReached((s) => ({ ...s, [clone.id]: 2 }));
    setBatchAttrIdx((s)       => ({ ...s, [clone.id]: 0 }));
    setBatchAttrMaxReached((s)=> ({ ...s, [clone.id]: 0 }));

    // Keep the totals in sync so batchUnitCountsMatch stays true after duplicate.
    const addedUnits = parseInt(clone.unitCount) || 0;
    const addedQty   = parseFloat(clone.quantity) || 0;
    setUnitCount((prev) => prev + addedUnits);
    setQuantity((prev)  => prev + addedQty);
  };

  const handleEditBatch = useCallback((batchId) => {
    setBatchSubSteps((s) => ({ ...s, [batchId]: 0 }));
    setBatchEditQtySteps((s) => ({ ...s, [batchId]: true }));

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const card = batchCardRefs.current[batchId];
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const firstField = card.querySelector('input, select, textarea');
        if (firstField && typeof firstField.focus === 'function') {
          firstField.focus({ preventScroll: true });
        }
      });
    });
  }, []);

  const handleBatchNext = () => {
    for (const batch of batches) { const error = palletError(batch); if (error) { window.alert(error); return; } }
    for (const b of batches) {
      if ((batchSubSteps[b.id] ?? 0) < 2) {
        window.alert(`Complete the setup for Batch "${b.batchNumber}" before continuing.`);
        return;
      }
    }
    if (!batchUnitCountsMatch) {
      window.alert(`Total unit count (${totalBatchUnitCount}) must equal selected units (${unitCount}).`);
      return;
    }
    for (const b of batches) {
      if ((parseInt(b.unitCount) || 0) <= 0) { window.alert(`Batch ${b.batchNumber} has zero quantity.`); return; }
      if (!b.binLocationCode) { window.alert(`Please select a bin location for batch ${b.batchNumber}.`); return; }
    }
    goToStep(3);
  };

  // ── submit (pending review flow) ──────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    const docEntry = orderFull?.AbsoluteEntry || orderFull?.DocEntry;
    const today = formatLocalDate();
    try {
      const res = await API.post('/pending-receipts/', {
        ProductionOrderEntry: docEntry,
        ProductionOrderNumber: orderNumber,
        BaseType: 202,
        BaseEntry: docEntry,
        TransactionType: 'botrntComplete',
        Quantity: quantity,
        Warehouse: warehouse?.code,
        PostingDate: today,
        DocumentDate: today,
        UomEntry: selectedUom?.value || '',
        UomLabel: selectedUom?.label || '',
        UnitCount: unitCount,
        Batches: batches.map((b) => ({
          palletTypeId: b.palletTypeId === 'none' ? null : b.palletTypeId,
          withoutPallet: b.palletTypeId === 'none',
          batchNumber:   b.batchNumber,
          reservationId: b.reservationId ?? null,
          autoGenerated: b.autoGenerated === true,
          quantity:      parseFloat(b.quantity),
          unitCount:     parseInt(b.unitCount) || 0,
          binAbsEntry:   b.binAbsEntry,
          binLocationCode: b.binLocationCode,
          binLocation:   b.binLocationCode,
          mfrDate:       b.mfrDate,
          admissionDate: b.admissionDate,
          details:       b.details,
          size:          b.size,
          brand:         b.brand,
          uom:           b.uom || selectedUom?.value || '',
          vendor:        b.vendor,
          part:          b.part,
          category:      b.category,
          packing:       b.packing,
          season:        b.season,
          extraSpecification: b.extraSpecification,
          number:        b.number,
          company:       b.company,
        })),
        Remarks: `Receipt from Production Order ${orderNumber}`,
      });

      if (res.data.success) {
        setReceiptResult(res.data.data);
        // Apply server-assigned batch numbers (reserved inside the submit transaction)
        const serverBatches = res.data.data?.batches;
        if (serverBatches?.length) {
          setBatches((prev) => prev.map((b, i) => {
            const srv = serverBatches[i];
            return srv ? { ...b, batchNumber: srv.batch_number } : b;
          }));
        }
        goToStep(4);
      } else {
        setSubmitError(res.data.error || 'Could not submit receipt for review.');
      }
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Error submitting receipt for review.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── print ──────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const specs = batches.map((batch) => {
      const batchUom = findBatchUomOption(batch);
      const uomLabel = getBatchUomLabel(batch);
      const m = getUomMeasurement(batchUom);
      const cleanProduct = getCleanProductName(displayedItemName);
      const unitCnt  = Number(batch.unitCount ?? 0);
      const netVal   = Math.round(unitCnt * m.factor * 1000) / 1000;
      const netLabel = m.type === 'volume' ? 'Net Volume' : 'Net Weight';
      const netStr   = netVal > 0 ? `${netVal.toLocaleString()} ${m.unitLabel}` : '';
      const brandName = (batch.brand || '').trim();
      const showBrand = brandName && brandName.toLowerCase() !== cleanProduct.toLowerCase();
      return {
        batchNumber: batch.batchNumber,
        topLine:     brandName || cleanProduct,
        subLine:     showBrand ? cleanProduct : null,
        infoRows: [
          { k: 'UOM',          v: uomLabel || '—' },
          { k: 'No. Packages', v: String(unitCnt) },
          netStr                  ? { k: netLabel,    v: netStr          } : null,
        ].filter(Boolean),
      };
    });
    printBatchLabels(specs);
  };

  // ── restart ────────────────────────────────────────────────────────────────
  const handleNewReceipt = () => {
    traceRules('state-reset/new-receipt', {
      clearing: ['orderAttributeRules', 'warehouseHiddenFields'],
      notClearedHere: ['orderHiddenFields', 'warehouseAttrRules', 'userAttributeRules', 'userHiddenFields'],
    });
    setStep(0); setMaxReachedStep(0); setSelectedOrder(null); setOrderFull(null); setItemName('');
    setPalletTypeId(''); setManualPalletQuantity(false); setWarehouse(null); setBinLocations([]); setBinLocationsLoading(false); setBinLocationsError(false); setQuantity(0); setUnitCount(1);
    setNextBatchReservation({ batch_number: '', reservation_id: null });
    setBatches([]); setBatchSubSteps({}); setBatchSubMaxReached({}); setBatchEditQtySteps({}); setBatchAttrIdx({}); setBatchAttrMaxReached({}); setReceiptResult(null); setSubmitError('');
    setSelectedUom(null); setOrderAttributeRules({}); setWarehouseHiddenFields([]);
    setBatchAttributes({}); setBatchAttributesLoading(false); setBatchAttributesError(false);
    // uomDisplayOptions intentionally NOT cleared — pre-loaded on mount
  };

  const resetToOrderSelection = () => {
    traceRules('state-reset/order-selection', {
      clearing: ['orderAttributeRules', 'warehouseHiddenFields'],
      notClearedHere: ['orderHiddenFields', 'warehouseAttrRules', 'userAttributeRules', 'userHiddenFields'],
    });
    setStep(0); setMaxReachedStep(0);
    setSelectedOrder(null); setOrderFull(null); setItemName('');
    setPalletTypeId(''); setManualPalletQuantity(false); setWarehouse(null); setBinLocations([]); setBinLocationsLoading(false); setBinLocationsError(false);
    setQuantity(0); setUnitCount(1); setUomSearch(''); setSelectedUom(null);
    setNextBatchReservation({ batch_number: '', reservation_id: null });
    setOrderAttributeRules({}); setWarehouseHiddenFields([]);
    setBatchAttributes({}); setBatchAttributesLoading(false); setBatchAttributesError(false);
    // uomDisplayOptions intentionally NOT cleared — pre-loaded on mount
    setBatches([]); setBatchSubSteps({}); setBatchSubMaxReached({}); setBatchEditQtySteps({}); setBatchAttrIdx({}); setBatchAttrMaxReached({});
    setSubmitError('');
    setOrderLoadError('');
    setLoadingOrderData(false);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-shell receipt-wizard">
      <StepBar step={step} maxReachedStep={maxReachedStep} onStepClick={handleMainStepClick} receiptPosted={!!receiptResult} />

      {/* ── STEP 0: SELECT ORDER ── */}
      {step === 0 && (
        <section className="card-panel">
          <div className="page-header__content" style={{ marginBottom: '16px' }}>
            <span className="section-kicker">{t('wizard.step1')}</span>
            <h1 className="page-title">📦 {t('wizard.pageTitle1')}</h1>
            <p className="page-copy">{t('wizard.tapCard')}</p>
          </div>

          {isAdmin && availableWarehouses.length > 0 && (
            <div className="wizard-wh-filter-row">
              <span className="wizard-wh-filter-label">{t('wizard.warehouseFilter')}</span>
              <button type="button"
                className={`app-button wizard-wh-btn ${!userWarehouse ? 'app-button--primary' : 'app-button--secondary'}`}
                onClick={() => { setUserWarehouse(''); localStorage.removeItem('userWarehouse'); }}>
                {t('wizard.allWarehouses')}
              </button>
              {availableWarehouses.map((wh) => (
                <button key={wh} type="button"
                  className={`app-button wizard-wh-btn ${userWarehouse === wh ? 'app-button--primary' : 'app-button--secondary'}`}
                  onClick={() => { setUserWarehouse(wh); localStorage.setItem('userWarehouse', wh); }}>
                  {wh}
                </button>
              ))}
            </div>
          )}
          {!isAdmin && user?.warehouse && (
            <div className="wizard-wh-filter-row">
              <span className="wizard-wh-filter-label">🏭 Warehouse:</span>
              <span className="wizard-wh-badge">{user.warehouse}</span>
            </div>
          )}

          <div className="form-field" style={{ marginBottom: '12px' }}>
            <input className="app-input" type="search" value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('wizard.filterPlaceholder')} />
          </div>

          <div className="wizard-filter-row">
            <button type="button" className="app-button app-button--primary wizard-filter-btn">
              {t('wizard.released')}
            </button>
            <input className={`app-input wizard-date-input${dateInvalid ? ' app-input--danger' : ''}`}
              type="text" placeholder="dd/mm/yyyy"
              value={dateDisplay} onChange={handleDateInput} title="Order date (dd/mm/yyyy)"
              maxLength={10}
              style={dateInvalid ? { borderColor: 'var(--danger)' } : undefined} />
            {hasActiveFilters && (
              <button type="button" className="app-button app-button--secondary wizard-filter-btn"
                onClick={() => { setSearch(''); setStatusFilter('all'); setDateFilter(''); setDateDisplay(''); setDateInvalid(false); }}>{t('wizard.clearFilters')}</button>
            )}
          </div>

          {ordersLoading && (
            <div style={{ padding: '24px 0' }}>
              <div className="feedback-message feedback-message--info" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <AppSpinner size="sm" />
                <span>{t('wizard.loadingOrders')}</span>
              </div>
              <LoadingSkeleton rows={4} />
            </div>
          )}
          {!ordersLoading && ordersError && <div className="feedback-message feedback-message--error">{ordersError}</div>}
          {!ordersLoading && !ordersError && filteredOrders.length === 0 && (
            <div className="empty-state">
              <p>{hasActiveFilters ? t('wizard.noOrdersFiltered') : t('wizard.noOrders')}</p>
            </div>
          )}

          {!ordersLoading && !ordersError && filteredOrders.length > 0 && (
            <div className="order-grid">
              {filteredOrders.map((order) => {
                const docNum = order.orderNumber ?? '—';
                const planned = order.plannedQty ?? 0;
                const completed = order.completedQty ?? 0;
                const remaining = order.remainingQty ?? (planned - completed);
                const isReleased = order.status === 'R';
                const statusName = order.statusName ?? order.status ?? '—';
                const isThisLoading = loadingOrderData && selectedOrder?.orderNumber === docNum;
                const isOtherLoading = loadingOrderData && !isThisLoading;
                const productText = [order.itemName, order.productName, order.description, order.itemDescription].filter(Boolean).join(' ');
                const productIcon = getProductIcon(productText);
                return (
                  <article key={docNum}
                    className={`batch-card wizard-order-card${isOtherLoading ? ' wizard-order-card--dimmed' : ''}`}
                    style={{ padding: '14px', gap: '10px' }}
                    onClick={() => !loadingOrderData && handleSelectOrder(order)}
                    role="button" tabIndex={isOtherLoading ? -1 : 0}
                    onKeyDown={(e) => e.key === 'Enter' && !loadingOrderData && handleSelectOrder(order)}>
                    <div className="batch-card__header">
                      <div className="wizard-order-card__info-wrap">
                        <span className="product-icon-badge">{productIcon}</span>
                        <div className="batch-card__title" style={{ minWidth: 0 }}>
                          <span className="batch-card__index">{t('wizard.orderLabel', docNum)}</span>
                          <strong className="wizard-order-card__item-name">{order.itemName ?? '—'}</strong>
                          <span className="wizard-order-card__item-code">🏷️ {order.itemCode ?? '—'}</span>
                        </div>
                      </div>
                      <span className={`wizard-order-card__status ${isReleased ? 'wizard-order-card__status--released' : 'wizard-order-card__status--pending'}`}>
                        {isReleased ? '✅' : '🕐'} {statusName}
                      </span>
                    </div>
                    <div className="details-grid details-grid--sm">
                      {[
                        { label: '📊 Planned',   value: Number(planned).toLocaleString(),   cls: '' },
                        { label: '♻️ Remaining', value: Number(remaining).toLocaleString(), cls: remaining <= 0 ? ' detail-item__value--warning' : ' detail-item__value--success' },
                        { label: '🏭 Warehouse', value: order.warehouse ?? '—',             cls: '' },
                        { label: '📍 Location',  value: order.location ?? '—',              cls: '' },
                        { label: '📅 Order date', value: formatSapDate(order.postDate),     cls: '' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="detail-item detail-item--sm">
                          <span className="detail-item__label detail-item__label--sm">{label}</span>
                          <div className={`detail-item__value detail-item__value--sm${cls}`}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {isThisLoading ? (
                      <div className="loading-state loading-state--row-start">
                        <Loading size="small" />
                        <span className="loading-primary-text">{t('wizard.loadingOrderDetails')}</span>
                      </div>
                    ) : (
                      <div className="wizard-order-card__cta" style={{ opacity: isOtherLoading ? 0 : 1 }}>
                        {t('wizard.tapToSelect')}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── STEP 1: QUANTITY ── */}
      {step === 1 && selectedOrder && (
        <section className="card-panel receipt-quantity-panel">
          <div className="page-header__content" style={{ marginBottom: '24px' }}>
            <span className="section-kicker">{t('wizard.step2', selectedOrder.orderNumber)}</span>
            <h1 className="page-title">⚖️ {displayedItemName || selectedOrder.itemName || selectedOrder.itemCode || selectedOrder.orderNumber}</h1>
            <p className="page-copy">{loadingOrderData ? t('wizard.loadingOrderData') : t('wizard.enterUnits')}</p>
          </div>

          {loadingOrderData ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '1.25rem' }}>
              <AppSpinner size="md" label={t('wizard.loadingOrderData')} />
              <LoadingSkeleton rows={4} style={{ width: '100%', maxWidth: '480px' }} />
            </div>
          ) : orderLoadError ? (
            <div>
              <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
                {orderLoadError}
              </div>
              <div className="wizard-nav-row" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="app-button app-button--secondary wizard-nav-btn"
                  onClick={() => { setOrderLoadError(''); setStep(0); }}
                >
                  {t('createUser.back')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {palletTypesError && <p role="alert" className="feedback-message feedback-message--error">{palletTypesError}</p>}
              <div className="receipt-quantity-grid">
              <div className="receipt-quantity-column">
              <ProductionPalletCards types={palletTypes} value={palletTypeId} disabled={palletTypesLoading || !!palletTypesError} onChange={(value) => { setPalletTypeId(value); if (value === 'none') setManualPalletQuantity(false); }} />
              {palletTypeId && palletTypeId !== 'none' && <div className="form-field">
                <label className="form-label">{ar ? 'وزن المنتج الفعلي (كجم)' : 'Actual product weight (kg)'}</label>
                <input className="app-input" type="number" min="0.001" step="0.001" disabled={!palletTypeId} max={palletTypes.find((row) => String(row.id) === String(palletTypeId))?.capacity_kg} value={quantity} onChange={(event) => { setManualPalletQuantity(true); setQuantity(event.target.value === '' ? '' : Number(event.target.value)); }} />
                {palletError({ palletTypeId, quantity }) && <p role="alert" className="feedback-message feedback-message--error">{palletError({ palletTypeId, quantity })}</p>}
                <small>{ar ? 'يسمح بالنواقص، ولا يسمح بتجاوز حد النوع.' : 'Partial pallets allowed; capacity cannot be exceeded.'}</small>
              </div>}
              <div className="qty-display-card">
                <div className="qty-display-card__value">
                  {unitCount === '' ? '—' : Number(quantity).toLocaleString()}
                </div>
                <div className="qty-display-card__label">
                  {manualPalletQuantity ? (ar ? 'وزن المنتج الفعلي المستلم (كجم)' : 'Actual received product weight (kg)') : unitCount !== '' && uomMeasurement.source !== 'no-uom' && uomMeasurement.source !== 'generic'
                    ? `${uomMeasurement.unitLabel} to receive  (${unitCount} × ${uomMeasurement.displayText})`
                    : `${selectedUom?.label || 'units'} to receive`}
                </div>
              </div>

              </div>
              <div className="receipt-quantity-column">
              <div className="form-field" style={{ marginBottom: '24px' }}>
                <label className="form-label">{t('wizard.unitsLabel')}</label>
                <input
                  className="app-input input-large-number"
                  type="number" min="1" max="150" step="1" disabled={palletTypesLoading || !!palletTypesError || !palletTypeId}
                  value={unitCount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { setUnitCount(''); return; }
                    const n = parseInt(v, 10);
                    if (!isNaN(n)) setUnitCount(Math.max(1, Math.min(150, n)));
                  }}
                  autoFocus
                />
                {unitCount > 150 && (
                  <span className="form-field__hint hint--danger">{t('wizard.maxUnits')}</span>
                )}
              </div>

              <div style={{ marginBottom: '20px' }}>
                <span className="section-microlabel">UOM</span>
                {ruleFilteredUomOptions.length > 0 && (
                  <input
                    className="app-input"
                    type="search"
                    value={uomSearch}
                    onChange={(e) => setUomSearch(e.target.value)}
                    placeholder={t('wizard.searchUom')}
                    style={{ marginBottom: '10px' }}
                  />
                )}
                <div className="uom-chips-wrap">
                  {(() => {
                    const q = uomSearch.trim().toLowerCase();
                    const isNumeric = /^\d+$/.test(q);
                    const filtered = q
                      ? ruleFilteredUomOptions.filter((u) => {
                          const entry = String(u.value ?? '').trim();
                          if (isNumeric) return entry === q;
                          const name = String(u.label || '').toLowerCase();
                          return name.includes(q);
                        })
                      : ruleFilteredUomOptions;
                    if (ruleFilteredUomOptions.length === 0) {
                      return (
                        <span className="uom-empty-text">
                          {t('wizard.noUom')}
                        </span>
                      );
                    }
                    if (filtered.length === 0) {
                      return <span className="uom-empty-text">{t('wizard.noUomSearch')}</span>;
                    }
                    return filtered.map((u) => {
                      const isSelected = selectedUom?.value === u.value;
                      return (
                        <button key={u.value} type="button" className="uom-card"
                          style={{
                            borderColor: isSelected ? 'var(--primary)' : 'var(--border)',
                            background: isSelected ? 'var(--primary)' : 'transparent',
                            color: isSelected ? '#fff' : 'var(--text)',
                            fontWeight: isSelected ? 700 : 400,
                          }}
                          onClick={() => setSelectedUom(isSelected ? null : u)}>
                          <span className="uom-card__name">{u.label}</span>
                          <span className="uom-card__entry">{u.value}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
                {selectedUom && (
                  <div className="uom-summary-box">
                    <div><strong>{selectedUom.label}</strong></div>
                    <div>
                      Count: {unitCount === '' ? '—' : unitCount} &nbsp;·&nbsp;
                      {!manualPalletQuantity && <>Unit: {uomMeasurement.displayText} &nbsp;·&nbsp;</>}
                      Total: <strong>{unitCount === '' ? '—' : quantity} {uomMeasurement.unitLabel}</strong>
                    </div>
                    <div className="uom-summary-box__note">U_UOM → {selectedUom.value} &nbsp;·&nbsp; source: {uomMeasurement.source}</div>
                  </div>
                )}
              </div>

              {!selectedUom && ruleFilteredUomOptions.length > 0 && (
                <p className="uom-required-warning">{t('wizard.selectUom')}</p>
              )}
              </div>
              </div>

              <div className="wizard-nav-row" style={{ marginTop: 0 }}>
                <button type="button" className="app-button app-button--secondary wizard-nav-btn"
                  onClick={() => setStep(0)}>{t('createUser.back')}</button>
                <button type="button" className="app-button app-button--primary app-button--block wizard-nav-btn"
                  disabled={palletTypesLoading || !!palletTypesError || !!palletError({ palletTypeId, quantity }) || unitCount === '' || Number(unitCount) <= 0 || Number(unitCount) > 150 || !selectedUom} onClick={handleQuantityNext}>{t('wizard.nextBtn')}</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── STEP 2: BATCH SETUP ── */}
      {step === 2 && (
        <section className="card-panel">
          <div className="page-header__content" style={{ marginBottom: '16px' }}>
            <span className="section-kicker">{t('wizard.step3', unitCount.toLocaleString(), selectedUom?.label || '', warehouse?.code || '')}</span>
            <h1 className="page-title">🏷️ {t('wizard.pageTitle3')}</h1>
            <p className="page-copy">{t('wizard.completeBatch')}</p>
          </div>

          <div className={`table-summary ${batchUnitCountsMatch ? 'table-summary--match' : 'table-summary--mismatch'}`}
            style={{ marginBottom: '16px' }}>
            <span>{t('wizard.totalBatchUnits')}</span>
            <strong>
              {totalBatchUnitCount.toLocaleString()} / {unitCount.toLocaleString()} {selectedUom?.label || 'units'}
            </strong>
          </div>

          <div className="batch-list">
            {batches.map((batch, index) => {
              const subStep = batchSubSteps[batch.id] ?? 0;
              const subMaxReached = batchSubMaxReached[batch.id] ?? 0;
              const isEditQtyStep = Boolean(batchEditQtySteps[batch.id]);
              const isConfirmed = subStep >= 2;
              const goToSubStep = (nextSub) => {
                setBatchSubSteps((s) => ({ ...s, [batch.id]: nextSub }));
                setBatchSubMaxReached((s) => ({ ...s, [batch.id]: Math.max(s[batch.id] ?? 0, nextSub) }));
              };
              const subStepNext = () => goToSubStep(Math.min(2, subStep + 1));
              const subStepPrev = () => setBatchSubSteps((s) => ({ ...s, [batch.id]: Math.max(0, (s[batch.id] ?? 0) - 1) }));
              const goToBatchStep = (i) => { if (i <= subMaxReached) setBatchSubSteps((s) => ({ ...s, [batch.id]: i })); };
              const batchUomOption = findBatchUomOption(batch);
              const batchUomValue = batch.uom || (batchUomOption ? getUomRuleValue(batchUomOption) : selectedUom?.value || '');
              const editUomOptions = batchUomOption && !ruleFilteredUomOptions.some((u) => getUomRuleValue(u) === batchUomValue)
                ? [batchUomOption, ...ruleFilteredUomOptions]
                : ruleFilteredUomOptions;
              const batchUomMeasurement = getUomMeasurement(batchUomOption);

              const updateBatchUnitCount = (newCount) => {
                const n = Math.max(0, Math.round(Number(newCount) || 0));
                const next = batches.map((b, currentIndex) => {
                  if (!isTargetBatch(b, batch.id, index, currentIndex)) return b;
                  const cloned = deepCloneBatch(b);
                  const batchUom = findBatchUomOption(cloned);
                  return {
                    ...cloned,
                    unitCount: n,
                    quantity: calculateBatchQuantity(n, batchUom),
                  };
                });
                setBatches(next);
                syncReceiptTotalsFromBatches(next);
              };
              const updateBatchUom = (uomEntry) => {
                const uomOption = ruleFilteredUomOptions.find((u) => getUomRuleValue(u) === uomEntry)
                  || uomDisplayOptions.find((u) => getUomRuleValue(u) === uomEntry)
                  || selectedUom;
                const next = batches.map((b, currentIndex) => {
                  if (!isTargetBatch(b, batch.id, index, currentIndex)) return b;
                  const cloned = deepCloneBatch(b);
                  const units = parseInt(cloned.unitCount, 10) || 0;
                  return {
                    ...cloned,
                    uom: uomEntry,
                    uomLabel: uomOption?.label || cloned.uomLabel || uomEntry,
                    quantity: calculateBatchQuantity(units, uomOption),
                  };
                });
                setBatches(next);
                syncReceiptTotalsFromBatches(next);
              };
              const updateBatchQuantity = (newQuantity) => {
                const qty = Math.max(0, Math.round((Number(newQuantity) || 0) * 1000) / 1000);
                const next = batches.map((b, currentIndex) => {
                  if (!isTargetBatch(b, batch.id, index, currentIndex)) return b;
                  return { ...deepCloneBatch(b), quantity: qty };
                });
                setBatches(next);
                syncReceiptTotalsFromBatches(next);
              };
              const renderOptionOrInput = (fieldKey, stateKey, value, label) => {
                const options = applyAllowedRules(
                  fieldKey,
                  getBatchFieldOptions(fieldKey, value),
                  orderAttributeRules,
                  userAttributeRules,
                  warehouseAttrRules,
                );
                if (options.length > 0) {
return (
                    <StandardDropdown
                      className="app-input"
                      value={value || ''}
                      onChange={(e) => handleBatchChange(batch.id, stateKey, e.target.value, index)}
                    >
                      <option value="">—</option>
                      {options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </StandardDropdown>
                  );
                }
                return (
                  <input
                    className="app-input"
                    type="text"
                    value={value || ''}
                    placeholder={label}
                    onChange={(e) => handleBatchChange(batch.id, stateKey, e.target.value, index)}
                  />
                );
              };
              const finishEditQtyStep = () => {
                setBatchEditQtySteps((prev) => {
                  const next = { ...prev };
                  delete next[batch.id];
                  return next;
                });
              };

              const attrIdx = batchAttrIdx[batch.id] ?? 0;
              const attrMaxReached = batchAttrMaxReached[batch.id] ?? 0;
              const attrDef = visibleAttrFields[attrIdx] ?? visibleAttrFields[0] ?? ATTR_FIELDS[0];
              const rawAttrOpts = attrDef.text ? [] :
                attrDef.key === 'uom' ? normalizedUomOptions :
                attrDef.key === 'company' ? companyOptions :
                attrDef.key === 'vendor'
                  ? getBatchFieldOptions('vendor', batch.vendor, vendorOptions.map((v) => ({ value: v.code, label: `${v.code} - ${v.name}` })))
                  : getBatchFieldOptions(attrDef.key, batch[attrDef.stateKey]);
              // UI-only intersection of order + user + warehouse rules — never touches state or payload
              const attrOpts = applyAllowedRules(attrDef.key, rawAttrOpts, orderAttributeRules, userAttributeRules, warehouseAttrRules);
              const attrHasCards = attrOpts.length > 0;
              const attrNext = () => {
                const nextIdx = attrIdx + 1;
                if (nextIdx < visibleAttrFields.length) {
                  setBatchAttrIdx((s) => ({ ...s, [batch.id]: nextIdx }));
                  setBatchAttrMaxReached((s) => ({ ...s, [batch.id]: Math.max(s[batch.id] ?? 0, nextIdx) }));
                } else {
                  setBatchAttrIdx((s) => ({ ...s, [batch.id]: 0 }));
                  setBatchSubSteps((s) => ({ ...s, [batch.id]: 2 }));
                  setBatchSubMaxReached((s) => ({ ...s, [batch.id]: Math.max(s[batch.id] ?? 0, 2) }));
                }
              };
              const attrPrev = () => {
                if (attrIdx > 0) {
                  setBatchAttrIdx((s) => ({ ...s, [batch.id]: attrIdx - 1 }));
                } else {
                  setBatchSubSteps((s) => ({ ...s, [batch.id]: 0 }));
                }
              };
              const goToAttrStep = (i) => {
                if (i <= attrMaxReached) {
                  setBatchAttrIdx((s) => ({ ...s, [batch.id]: i }));
                }
              };

              /* ── confirmed: compact summary ── */
              if (isConfirmed) {
                const canDuplicate = batches.length < MAX_TOTAL_BATCHES;

                return (
                  <article key={batch.id} className="batch-card batch-card--confirmed">
                    <div className="batch-card__header">
                      <div className="batch-card__title">
                        <span className="batch-card__index batch-card__index--success">✅ {t('wizard.batchLabel', index + 1)}</span>
                        <strong style={{ fontSize: '13px', color: batch.batchNumber ? 'inherit' : 'var(--text-muted)', fontStyle: batch.batchNumber ? 'normal' : 'italic' }}>
                          🏷️ {batch.batchNumber || t('wizard.autoGenerated')}
                        </strong>
                        {batch.originId && (
                          <span className="batch-card__copy-label">copy</span>
                        )}
                      </div>
                      <div className="batch-card__actions">
                        <button type="button" className="app-button app-button--secondary batch-card__action-btn"
                          onClick={() => handleEditBatch(batch.id)}>{t('wizard.editBtn')}</button>
                        <button type="button" className="app-button app-button--secondary batch-card__action-btn"
                          title={canDuplicate
                            ? t('wizard.duplicateBatch')
                            : `Maximum ${MAX_TOTAL_BATCHES} total batches reached`}
                          disabled={!canDuplicate}
                          onClick={() => handleDuplicateBatch(batch)}>
                          ⧉ Duplicate
                        </button>
                      </div>
                    </div>
                    <div className="details-grid details-grid--sm">
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">📊</span>
                          Units count
                        </span>
                        <input
                          className="app-input"
                          type="number"
                          value={batch.unitCount ?? 0}
                          step="1"
                          min="0"
                          onChange={(e) => updateBatchUnitCount(e.target.value)}
                        />
                      </div>
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">⚖️</span>
                          UOM
                        </span>
<StandardDropdown
                          className="app-input"
                          value={batchUomValue}
                          onChange={(e) => updateBatchUom(e.target.value)}
                        >
                          {editUomOptions.map((u) => (
                            <option key={getUomRuleValue(u)} value={getUomRuleValue(u)}>
                              {u.label}
                            </option>
                          ))}
                        </StandardDropdown>
                      </div>
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">⚖️</span>
                          Total quantity ({batchUomMeasurement.unitLabel})
                        </span>
                        <input
                          className="app-input"
                          type="number"
                          value={batch.quantity ?? 0}
                          step="any"
                          min="0"
                          onChange={(e) => updateBatchQuantity(e.target.value)}
                        />
                      </div>
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">📍</span>
                          Bin
                        </span>
                        <div className="detail-item__value detail-item__value--sm">
                          {batch.binLocationCode || '—'}
                        </div>
                      </div>
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">📅</span>
                          Mfr date
                        </span>
                        <div className="detail-item__value detail-item__value--sm">
                          {batch.mfrDate || '—'}
                        </div>
                      </div>
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">🏅</span>
                          Brand
                        </span>
                        {renderOptionOrInput('brand', 'brand', batch.brand, 'Brand')}
                      </div>
                      <div className="detail-item detail-item--sm">
                        <span className="detail-item__label detail-item__label--xs">
                          <span className="meta-label-icon" aria-hidden="true">📏</span>
                          Size
                        </span>
                        {renderOptionOrInput('size', 'size', batch.size, 'Size')}
                      </div>
                    </div>
                    {batches.length > 1 && (
                      <button type="button" className="app-button app-button--secondary batch-card__remove-btn"
                        onClick={() => handleRemoveBatch(batch.id)}>{t('wizard.removeBtn')}</button>
                    )}
                  </article>
                );
              }

              /* ── active: mini-wizard ── */
              return (
                <article
                  key={batch.id}
                  className="batch-card batch-card--active"
                  ref={(el) => { if (el) batchCardRefs.current[batch.id] = el; }}
                >
                  {palletError(batch) && <p role="alert" className="feedback-message feedback-message--error">{palletError(batch)}</p>}
                  <div className="batch-card__header">
                    <div className="batch-card__title">
                      <span className="batch-card__index">{t('wizard.batchLabel', index + 1)}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-subtle)', fontStyle: 'italic' }}>🏷️ {t('wizard.autoGenerated')}</span>
                    </div>
                    {batches.length > 1 && (
                      <button type="button" className="icon-button icon-button--danger"
                        onClick={() => handleRemoveBatch(batch.id)}>✕</button>
                    )}
                  </div>

                  {!isEditQtyStep && (
                    <MiniStepBar currentStep={subStep} maxReachedStep={subMaxReached} onStepClick={goToBatchStep} />
                  )}

                  {isEditQtyStep && (
                    <div className="wizard-bin-wrap">
                      <div className="form-field">
                        <label className="form-label">📊 Units for this batch ({getBatchUomLabel(batch)})</label>
                        <input
                          className="app-input"
                          type="number"
                          value={batch.unitCount ?? 0}
                          step="1"
                          min="0"
                          onChange={(e) => updateBatchUnitCount(e.target.value)}
                        />
                      </div>
                      <div className="form-field">
                        <label className="form-label">UOM</label>
<StandardDropdown
                          className="app-input"
                          value={batchUomValue}
                          onChange={(e) => updateBatchUom(e.target.value)}
                        >
                          {editUomOptions.map((u) => (
                            <option key={getUomRuleValue(u)} value={getUomRuleValue(u)}>
                              {u.label}
                            </option>
                          ))}
                        </StandardDropdown>
                        <span className="form-field__hint">
                          Quantity: {Number(batch.quantity || 0).toLocaleString()} {batchUomMeasurement.unitLabel}
                        </span>
                      </div>
                      <div className="form-field">
                        <label className="form-label">Total quantity ({batchUomMeasurement.unitLabel})</label>
                        <input
                          className="app-input"
                          type="number"
                          value={batch.quantity ?? 0}
                          step="any"
                          min="0"
                          onChange={(e) => updateBatchQuantity(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* 0 — Bin location */}
                  {!isEditQtyStep && subStep === 0 && (() => {
                    const binSearch = (binSearches[batch.id] || '').trim().toLowerCase();
                    const currentWh = warehouse?.code;
                    // Bins for current warehouse (physical allocatable bins)
                    const allocatableBins = (binLocations || []).filter((b) => {
                      if (b.inactive || b.is_system_bin) return false;
                      if (currentWh && b.warehouse && b.warehouse !== currentWh) return false;
                      return true;
                    });
                    const prefixedBins = currentWh
                      ? allocatableBins.filter((b) => (b.code || '').startsWith(`${currentWh}-`))
                      : allocatableBins;
                    const binsToDisplay = prefixedBins.length > 0 ? prefixedBins : allocatableBins;

                    const filteredBins = binSearch
                      ? binsToDisplay.filter((b) =>
                          (b.code || '').toLowerCase().includes(binSearch) ||
                          (b.name && b.name.toLowerCase().includes(binSearch)) ||
                          (b.description && b.description.toLowerCase().includes(binSearch))
                        )
                      : binsToDisplay;

                    return (
                      <div className="wizard-bin-wrap">
                        {batches.length > 1 && (
                          <div className="form-field" style={{ marginBottom: '14px' }}>
                            <label className="form-label">📊 Units for this batch ({getBatchUomLabel(batch)})</label>
                            <input
                              className="app-input"
                              type="number"
                              value={batch.unitCount ?? 0}
                              step="1"
                              min="0"
                              onChange={(e) => updateBatchUnitCount(e.target.value)}
                            />
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <label className="wizard-section-label" style={{ margin: 0 }}>📍 {t('wizard.binLocation')}</label>
                          {currentWh && (
                            <span style={{ fontSize: '12px', color: 'var(--text-subtle)', fontWeight: 500 }}>
                              🏭 {currentWh}
                            </span>
                          )}
                        </div>

                        {binLocationsLoading && (
                          <div className="attr-loading-banner" style={{ marginBottom: '12px' }}>
                            <span className="attr-loading-banner__icon">⏳</span>
                            {t('wizard.loadingBins')}
                          </div>
                        )}

                        {binLocationsError && !binLocationsLoading && binsToDisplay.length === 0 && (
                          <div className="attr-error-banner" style={{ marginBottom: '12px' }}>
                            <span className="attr-error-banner__icon">⚠</span>
                            <span className="attr-error-banner__text">
                              {t('wizard.binsUnavailable')}
                            </span>
                            <button
                              type="button"
                              className="attr-retry-btn"
                              onClick={() => loadBinLocationsForWarehouse(currentWh)}
                            >
                              {t('common.retry')}
                            </button>
                          </div>
                        )}

                        {!binLocationsLoading && !binLocationsError && binsToDisplay.length === 0 && (
                          <div className="feedback-message feedback-message--info" style={{ marginBottom: '12px' }}>
                            {t('wizard.noBins')}
                          </div>
                        )}

                        {binsToDisplay.length > 4 && (
                          <div className="form-field" style={{ marginBottom: '12px' }}>
                            <input
                              className="app-input"
                              type="search"
                              placeholder={t('wizard.searchBins')}
                              value={binSearches[batch.id] || ''}
                              onChange={(e) => setBinSearches((s) => ({ ...s, [batch.id]: e.target.value }))}
                            />
                          </div>
                        )}

                        {binsToDisplay.length > 0 && filteredBins.length === 0 && (
                          <span className="form-field__hint">
                            {typeof t('wizard.noBinsMatch') === 'function' ? t('wizard.noBinsMatch', binSearch) : `No bins match "${binSearch}".`}
                          </span>
                        )}

                        {filteredBins.length > 0 && (
                          <div className="bin-card-grid">
                            {filteredBins.map((bin) => {
                              const isSelected = batch.binLocationCode === bin.code;
                              return (
                                <button
                                  key={bin.code}
                                  type="button"
                                  className={`bin-card${isSelected ? ' bin-card--selected' : ''}`}
                                  onClick={() => {
                                    handleBinChange(batch.id, bin.code, index);
                                    if (!isSelected) subStepNext();
                                  }}
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
                        )}
                      </div>
                    );
                  })()}

                  {/* 1 — Attributes (mini wizard with clickable stepper) */}
                  {!isEditQtyStep && subStep === 1 && (
                    <div>
                      {/* Batch attributes loading/error banner */}
                      {batchAttributesLoading && (
                        <div className="attr-loading-banner">
                          <span className="attr-loading-banner__icon">⏳</span>
                          {t('wizard.loadingAttrOpts')}
                        </div>
                      )}
                      {batchAttributesError && !batchAttributesLoading && attrOpts.length === 0 && (
                        <div className="attr-error-banner">
                          <span className="attr-error-banner__icon">⚠</span>
                          <span className="attr-error-banner__text">
                            {t('wizard.attrUnavailable')}
                          </span>
                          <button type="button" className="attr-retry-btn"
                            onClick={() => loadBatchAttributesForItem(itemCode)}>
                            {t('common.retry')}
                          </button>
                        </div>
                      )}
                      {/* Attr mini stepper */}
                      <div className="attr-stepper-scroll"
                        ref={(el) => { if (el) attrStepperScrollRefs.current[batch.id] = el; }}>
                        <div className="attr-stepper-row">
                          {visibleAttrFields.map((field, i) => {
                            const isDone   = i < attrIdx;
                            const isActive = i === attrIdx;
                            const locked   = i > attrMaxReached;
                            return (
                              <React.Fragment key={field.key}>
                                <button
                                  type="button"
                                  onClick={() => goToAttrStep(i)}
                                  disabled={locked}
                                  title={locked ? t('wizard.prevStepHint') : field.label}
                                  className="attr-stepper-btn"
                                  data-attr-active={String(isActive)}
                                  style={{ cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.3 : 1 }}>
                                  <div className="attr-stepper-circle" style={{
                                    background: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--bg-muted)',
                                    color: (isDone || isActive) ? '#fff' : 'var(--text-subtle)',
                                    border: `1.5px solid ${isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--border)'}`,
                                  }}>
                                    {isDone ? '✓' : i + 1}
                                  </div>
                                  <span className="attr-stepper-label" style={{
                                    fontWeight: isActive ? 700 : 500,
                                    color: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--text-subtle)',
                                  }}>{field.label}</span>
                                </button>
                                {i < visibleAttrFields.length - 1 && (
                                  <div className="attr-connector"
                                    style={{ background: i < attrIdx ? 'var(--success)' : 'var(--border)' }} />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>

                      {/* Mobile: current attribute indicator (hidden on desktop via CSS) */}
                      <div className="attr-mobile-current">
                        <span className="attr-mobile-current__label">{t('wizard.currentAttr')}</span>
                        <strong className="attr-mobile-current__name">{attrDef.label}</strong>
                        <span className="attr-mobile-current__meta">
                          {t('wizard.attrStep', attrIdx + 1, visibleAttrFields.length)}
                        </span>
                        {batch[attrDef.stateKey] && (
                          <span className="attr-mobile-current__value">{t('wizard.selected', batch[attrDef.stateKey])}</span>
                        )}
                      </div>

                      {/* Selected-value badge */}
                      {batch[attrDef.stateKey] && (
                        <div className="attr-selected-wrap">
                          <span className="attr-selected-chip">✓ {batch[attrDef.stateKey]}</span>
                        </div>
                      )}

                      {/* Non-text fields: ⊘ Empty card always first, then option cards */}
                      {!attrDef.text && (() => {
                        const isBrand = attrDef.key === 'brand';
                        const isEmpty = batch[attrDef.stateKey] === '';
                        return (
                          <div className="attr-options-grid"
                            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${isBrand ? '120px' : '100px'}, 1fr))` }}>
                            {/* ⊘ Empty — always first; selects empty value and advances */}
                            <button type="button"
                              className={`attr-option-empty${isEmpty ? ' attr-option-empty--selected' : ''}`}
                              onClick={() => { handleBatchChange(batch.id, attrDef.stateKey, '', index); attrNext(); }}>
                              <span className="attr-option-empty__icon">⊘</span>
                              <span>{t('wizard.empty')}</span>
                            </button>

                            {/* Option cards */}
                            {attrOpts.map((opt) => {
                              const selected = batch[attrDef.stateKey] === opt.value;
                              const brandImg = isBrand ? getBrandImage(opt.value) : null;
                              return (
                                <button key={opt.value} type="button"
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
                                    textAlign: 'center', lineHeight: 1.3,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px',
                                    transition: 'border-color 0.12s, background 0.12s, box-shadow 0.12s',
                                  }}
                                  onClick={() => { handleBatchChange(batch.id, attrDef.stateKey, opt.value, index); attrNext(); }}>
                                  {isBrand && <BrandAvatar src={brandImg} label={opt.label} selected={selected} />}
                                  {isBrand && selected && (
                                    <span className="attr-option-brand-check">✓</span>
                                  )}
                                  <span>{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Text input — Number / Details (can be left empty; Next advances) */}
                      {attrDef.text && (
                        <div className="form-field">
                          <input className="app-input" type="text" autoFocus
                            value={batch[attrDef.stateKey]}
                            placeholder={attrDef.placeholder || t('wizard.optionalNotes')}
                            onChange={(e) => handleBatchChange(batch.id, attrDef.stateKey, e.target.value, index)}
                            onKeyDown={(e) => e.key === 'Enter' && attrNext()} />
                          {batch[attrDef.stateKey] !== '' && (
                            <button type="button" className="attr-clear-btn"
                              onClick={() => { handleBatchChange(batch.id, attrDef.stateKey, '', index); attrNext(); }}>
                              {t('wizard.clearSkip')}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Attr navigation */}
                      <div className="wizard-nav-row">
                        <button type="button" className="app-button app-button--secondary wizard-nav-btn--sm"
                          onClick={attrPrev}>{t('createUser.back')}</button>
                        <button type="button" className="app-button app-button--primary app-button--block wizard-nav-btn--sm"
                          onClick={attrNext}>
                          {attrIdx === visibleAttrFields.length - 1 ? t('wizard.reviewBatch') : t('wizard.nextBtn')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Navigation for Bin step only; Attributes has its own nav */}
                  {subStep < 1 && (
                    <div className="wizard-nav-row">
                      <button type="button" className="app-button app-button--primary app-button--block wizard-nav-btn--sm"
                        onClick={isEditQtyStep ? finishEditQtyStep : subStepNext}>{t('wizard.nextBtn')}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {batches.every((b) => (batchSubSteps[b.id] ?? 0) >= 2) && (
            <>
              <div className="table-actions">
                <button type="button" className="app-button app-button--secondary"
                  onClick={handleAddBatch} disabled={addingBatch}>
                  {addingBatch ? '…' : t('wizard.addBatch')}
                </button>
              </div>
              <div className="wizard-nav-row">
                <button type="button" className="app-button app-button--secondary wizard-nav-btn"
                  onClick={() => setStep(1)}>{t('createUser.back')}</button>
                <button type="button" className="app-button app-button--primary app-button--block wizard-nav-btn"
                  onClick={handleBatchNext}>{t('wizard.reviewArrow')}</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── STEP 3: REVIEW ── */}
      {step === 3 && (
        <section className="card-panel card-panel--lg">
          <div className="page-header__content" style={{ marginBottom: '24px' }}>
            <span className="section-kicker">{t('wizard.step4')}</span>
            <h1 className="page-title">📋 {t('wizard.pageTitle4')}</h1>
            <p className="page-copy">{t('wizard.reviewDesc')}</p>
          </div>

          <div className="details-grid" style={{ marginBottom: '20px' }}>
            <div className="detail-item">
              <span className="detail-item__label">📦 Order</span>
              <div className="detail-item__value">{orderNumber}</div>
            </div>
            <div className="detail-item">
              <span className="detail-item__label">🏷️ Item</span>
              <div className="detail-item__value">{itemCode}</div>
            </div>
            <div className="detail-item detail-item--full">
              <span className="detail-item__label">{getProductIcon(displayedItemName)} Description</span>
              <div className="detail-item__value detail-item__value--accent">{displayedItemName}</div>
            </div>
            <div className="detail-item">
              <span className="detail-item__label">🏭 Warehouse</span>
              <div className="detail-item__value">
                {warehouse ? `${warehouse.code} — ${warehouse.name}` : '—'}
              </div>
            </div>
            <div className="detail-item">
              <span className="detail-item__label">📊 Quantity</span>
              <div className="detail-item__value detail-item__value--success">
                {unitCount.toLocaleString()} {selectedUom?.label || 'units'}
              </div>
            </div>
            <div className="detail-item">
              <span className="detail-item__label">📋 Batches</span>
              <div className="detail-item__value">{batches.length}</div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            {batches.map((b, i) => (
              <div key={b.id} className="status-row status-row--info review-batch-row">
                <span>{t('wizard.batchLabel', i + 1)}: <strong style={{ fontStyle: b.batchNumber ? 'normal' : 'italic', color: b.batchNumber ? 'inherit' : 'var(--text-muted)' }}>{b.batchNumber || t('wizard.autoGenerated')}</strong></span>
                <span>{(b.unitCount ?? 0).toLocaleString()} {getBatchUomLabel(b)}</span>
                <span>{t('wizard.quantity')}: {Number(b.quantity || 0).toLocaleString()}</span>
                <span>{ar ? 'نوع البالتة' : 'Pallet type'}: {b.palletTypeId === 'none' ? (ar ? 'بدون بالتات' : 'No pallets') : palletTypes.find((row) => String(row.id) === String(b.palletTypeId))?.name || '—'}</span>
                <span>📍 {b.binLocationCode || '—'}</span>
                {b.brand && <span>{t('wizard.brandLabel')}: {b.brand}</span>}
                {b.size && <span>{t('wizard.sizeLabel')}: {b.size}</span>}
                {b.season && <span>{t('wizard.seasonLabel')}: {b.season}</span>}
                {b.details && <span>{t('wizard.detailsLabel')}: {b.details}</span>}
              </div>
            ))}
          </div>

          {submitError && (
            <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
              {submitError}
            </div>
          )}

          <div className="wizard-nav-row" style={{ marginTop: 0 }}>
            <button type="button" className="app-button app-button--secondary wizard-nav-btn--lg"
              onClick={() => setStep(2)} disabled={submitting}>{t('createUser.back')}</button>
            <button type="button" className="app-button app-button--success app-button--block wizard-nav-btn--lg"
              onClick={handleSubmit} disabled={submitting} aria-busy={submitting ? 'true' : 'false'}>
              {submitting ? (
                <>
                  <Loading size="small" />
                  <span style={{ marginInlineStart: '8px' }}>{t('wizard.submitting')}</span>
                </>
              ) : t('wizard.submitReview')}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 4: SUBMITTED FOR REVIEW ── */}
      {step === 4 && receiptResult && (
        <section className="card-panel card-panel--lg">
          <div className="result-hero" style={{ paddingBottom: '28px' }}>
            <div className="result-hero__badge">✓</div>
            <h2 className="result-title">{t('wizard.submittedTitle')}</h2>
            <p className="page-copy">
              {t('wizard.submittedDesc')}
            </p>
          </div>

          <div className="summary-grid" style={{ marginBottom: '24px' }}>
            <div className="summary-card">
              <span>
                <span className="meta-label-icon" aria-hidden="true">🔢</span>
                {t('wizard.reviewId')}
              </span>
              <strong>#{receiptResult.pending_receipt_id}</strong>
            </div>
            <div className="summary-card">
              <span>
                <span className="meta-label-icon" aria-hidden="true">📦</span>
                {t('wizard.stepOrder')}
              </span>
              <strong>{orderNumber}</strong>
            </div>
            <div className="summary-card">
              <span>
                <span className="meta-label-icon" aria-hidden="true">📊</span>
                {t('wizard.totalSubmitted')}
              </span>
              <strong>{unitCount.toLocaleString()} {selectedUom?.label || ''}</strong>
            </div>
          </div>

          <div className="batch-list" style={{ marginBottom: '24px' }}>
            {batches.map((b, i) => (
              <article key={b.id || i} className="batch-card">
                <div className="batch-card__header">
                  <div className="batch-card__title">
                    <span className="batch-card__index">{t('wizard.batchLabel', i + 1)}</span>
                    <strong>{b.batchNumber}</strong>
                  </div>
                </div>
                <div className="details-grid details-grid--sm">
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--sm">
                      <span className="meta-label-icon" aria-hidden="true">📊</span>
                      {t('wizard.quantity')}
                    </span>
                    <div className="detail-item__value detail-item__value--md detail-item__value--success">
                      {(b.unitCount ?? 0).toLocaleString()} {getBatchUomLabel(b)}
                    </div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--sm">
                      <span className="meta-label-icon" aria-hidden="true">⚖️</span>
                      Total quantity
                    </span>
                    <div className="detail-item__value detail-item__value--md">
                      {Number(b.quantity || 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="detail-item detail-item--sm">
                    <span className="detail-item__label detail-item__label--sm">
                      <span className="meta-label-icon" aria-hidden="true">📍</span>
                      {t('wizard.subBin')}
                    </span>
                    <div className="detail-item__value detail-item__value--md">{b.binLocationCode || '—'}</div>
                  </div>
                  {b.brand && (
                    <div className="detail-item detail-item--sm">
                      <span className="detail-item__label detail-item__label--sm">
                        <span className="meta-label-icon" aria-hidden="true">🏅</span>
                        {t('wizard.brandLabel')}
                      </span>
                      <div className="detail-item__value detail-item__value--md">{b.brand}</div>
                    </div>
                  )}
                  {b.size && (
                    <div className="detail-item detail-item--sm">
                      <span className="detail-item__label detail-item__label--sm">
                        <span className="meta-label-icon" aria-hidden="true">📏</span>
                        {t('wizard.sizeLabel')}
                      </span>
                      <div className="detail-item__value detail-item__value--md">{b.size}</div>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="receipt-action-grid">
            <PrintActionButton icon="🖨"
              onClick={handlePrint}/>
            <div className="receipt-action-row">
              <button type="button" className="app-button app-button--primary app-button--block"
                style={{ minHeight: '46px' }}
                onClick={handleNewReceipt}>{t('wizard.newReceipt')}</button>
              <button type="button" className="app-button app-button--secondary app-button--block"
                style={{ minHeight: '46px' }}
                onClick={() => navigate('/')}>{t('wizard.homeBtn')}</button>
            </div>
          </div>
        </section>
      )}

      {step > 0 && step < DONE_STEP && (
        <div className="wizard-back-wrap">
          <button type="button" className="app-button app-button--secondary wizard-back-btn"
            onClick={resetToOrderSelection}>
            {t('wizard.chooseAnother')}
          </button>
        </div>
      )}
    </div>
  );
}

export default ReceiptWizard;
