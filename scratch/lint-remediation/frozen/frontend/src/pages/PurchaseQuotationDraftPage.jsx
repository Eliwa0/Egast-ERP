import { warehouseSearch, farmSearch, itemSearch as remoteItemSearch } from '../services/masterDataSearch';
import API from '../services/api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Step, StepButton, StepLabel, Stepper, CircularProgress } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canManagePurchaseQuotation } from '../utils/roles';
import { useToast } from '../components/ui/ToastProvider';
import SearchableSelect from '../components/ui/SearchableSelect';
import useCostCenterOptions from '../hooks/useCostCenterOptions';
import {
  approvePurchaseQuotationDraftForPosting,
  cancelPurchaseQuotationDraft,
  loadCurrencies,
  loadPurchaseQuotationDraft,
  loadQualityItemGroups,
  postPurchaseQuotationToSAP,
  previewPurchaseQuotationPosting,
  savePurchaseQuotationDraft,
} from '../services/purchaseQuotationService';
import '../styles/pages/receipt-review.css';
import '../styles/pages/quality-inspection.css';
import { getProductIcon } from '../utils/productIcon';

const EDITABLE_STATUSES = new Set(['DRAFT', 'POSTING_FAILED']);

const STEPS = [
  { id: 'vehicle', labelKey: 'purchaseQuotation.steps.vehicle', icon: '1' },
  { id: 'vendor', labelKey: 'purchaseQuotation.steps.vendor', icon: '2' },
  { id: 'header', labelKey: 'purchaseQuotation.steps.header', icon: '3' },
  { id: 'itemGroup', labelKey: 'purchaseQuotation.steps.itemGroup', icon: '4' },
  { id: 'item', labelKey: 'purchaseQuotation.steps.item', icon: '5' },
  { id: 'itemDetails', labelKey: 'purchaseQuotation.steps.itemDetails', icon: '6' },
  { id: 'logistics', labelKey: 'purchaseQuotation.steps.logistics', icon: '7' },
  { id: 'financial', labelKey: 'purchaseQuotation.steps.financial', icon: '8' },
  { id: 'review', labelKey: 'purchaseQuotation.steps.review', icon: '9' },
];

const getTodayDate = () => new Date().toISOString().split('T')[0];

const VENDOR_STORAGE_PREFIX = 'purchaseQuotationVendor:';

function getStoredVendor(draftId) {
  if (!draftId) return null;
  try {
    const raw = sessionStorage.getItem(`${VENDOR_STORAGE_PREFIX}${draftId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.cardCode) {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to read vendor from sessionStorage:', err);
  }
  return null;
}

function saveVendorToStorage(draftId, cardCode, name, currency) {
  if (!draftId || !cardCode) return;
  try {
    sessionStorage.setItem(
      `${VENDOR_STORAGE_PREFIX}${draftId}`,
      JSON.stringify({
        cardCode: String(cardCode).trim(),
        name: String(name || cardCode).trim(),
        currency: currency ? String(currency).trim() : '',
      })
    );
  } catch (err) {
    console.warn('Failed to save vendor to sessionStorage:', err);
  }
}

function clearStoredVendor(draftId) {
  if (!draftId) return;
  try {
    sessionStorage.removeItem(`${VENDOR_STORAGE_PREFIX}${draftId}`);
  } catch (err) {
    console.warn('Failed to clear vendor from sessionStorage:', err);
  }
}

function GrpoStepIcon({ icon, active, completed }) {
  const className = [
    'quality-mui-step-icon',
    active ? 'quality-mui-step-icon--active' : '',
    completed ? 'quality-mui-step-icon--completed' : '',
  ].filter(Boolean).join(' ');

  return <span className={className}>{completed ? '✓' : icon}</span>;
}

function createDefaultLine() {
  const today = getTodayDate();
  return {
    item_code: '',
    item_description: '',
    item_group_code: '',
    quoted_date: today,
    required_date: today,
    quoted_qty: 1,
    required_qty: 1,
    uom_code: 'PCS',
    unit_price: 0,
    discount_percent: 0,
    tax_code: '',
    warehouse_code: '',
    location_code: '',
    costing_code: '',
    line_total: 0,
  };
}

function PurchaseQuotationDraftPage({ postedViewOnly = false }) {
  const { user } = useAuth();
  const canAdministerQuotation = canManagePurchaseQuotation(user);
  const { draftId } = useParams();
  const navigate = useNavigate();
  useLocation();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [verifyingPayload, setVerifyingPayload] = useState(false);
  const [, setErrors] = useState({});
  const [activeStep, setActiveStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);

  // Master data
  const warehouses = [];
  const {
    costCentersDim1,
    costCentersDim2,
    costCentersLoading,
    costCenterError1,
    costCenterError2,
    reloadCostCenter,
  } = useCostCenterOptions();
  const [, setCurrencies] = useState([]);
  const [farms, setFarms] = useState([]);
  const [itemGroups, setItemGroups] = useState([]);
  const [loadingItemGroups, setLoadingItemGroups] = useState(true);
  const [, setItemSearchMap] = useState({});
  const [postingPreview, setPostingPreview] = useState(null);

  // Default Allocation (can be bulk applied to all lines)
  const [defaultWarehouse, setDefaultWarehouse] = useState('');
  const [defaultLocation, setDefaultLocation] = useState('');
  const [defaultCostCenter, setDefaultCostCenter] = useState('');

  // Form State - Vehicle & Container
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [containerQuantity, setContainerQuantity] = useState('0');

  // Form State - Header
  const [vendorCardCode, setVendorCardCode] = useState('');
  const [vendorName, setVendorName] = useState('');
  const vendorCardCodeRef = useRef(vendorCardCode);
  const vendorNameRef = useRef(vendorName);

  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Synchronize refs with state immediately
  useEffect(() => {
    if (vendorCardCode) {
      vendorCardCodeRef.current = vendorCardCode;
    }
  }, [vendorCardCode]);

  useEffect(() => {
    if (vendorName) {
      vendorNameRef.current = vendorName;
    }
  }, [vendorName]);

  const [contactPersonCode, setContactPersonCode] = useState('');
  const [vendorRefNo, setVendorRefNo] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [groupNo, setGroupNo] = useState('');
  const [postingDate, setPostingDate] = useState(getTodayDate());
  const [validUntil, setValidUntil] = useState(getTodayDate());
  const [documentDate, setDocumentDate] = useState(getTodayDate());
  const [requiredDate, setRequiredDate] = useState(getTodayDate());
  const [buyerCode, setBuyerCode] = useState('');
  const [ownerCode, setOwnerCode] = useState('');

  // Form State - Logistics & Remarks
  const [journalRemark, setJournalRemark] = useState('Purchase Quotation');
  const [remarks, setRemarks] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');

  // Form State - Lines
  const [lines, setLines] = useState([createDefaultLine()]);

  const isPosted = draft?.status === 'POSTED';
  const canEdit = draft && EDITABLE_STATUSES.has(draft.status) && !postedViewOnly;

  const getEffectiveVendorCode = useCallback(() => {
    // 1. React state
    if (vendorCardCode && String(vendorCardCode).trim()) {
      return String(vendorCardCode).trim();
    }
    // 2. Synchronous ref
    if (vendorCardCodeRef.current && String(vendorCardCodeRef.current).trim()) {
      const code = String(vendorCardCodeRef.current).trim();
      setVendorCardCode(code);
      return code;
    }
    // 3. Current draft
    if (draft?.vendor_card_code && String(draft.vendor_card_code).trim()) {
      const code = String(draft.vendor_card_code).trim();
      setVendorCardCode(code);
      vendorCardCodeRef.current = code;
      return code;
    }
    // 4. Draft-scoped sessionStorage
    const stored = getStoredVendor(draftId);
    if (stored?.cardCode) {
      const code = String(stored.cardCode).trim();
      setVendorCardCode(code);
      vendorCardCodeRef.current = code;
      if (stored.name && !vendorNameRef.current) {
        setVendorName(stored.name);
        vendorNameRef.current = stored.name;
      }
      return code;
    }
    return '';
  }, [draft?.vendor_card_code, draftId, vendorCardCode]);

  const getEffectiveVendorName = useCallback(() => {
    if (vendorName && String(vendorName).trim()) {
      return String(vendorName).trim();
    }
    if (vendorNameRef.current && String(vendorNameRef.current).trim()) {
      const name = String(vendorNameRef.current).trim();
      setVendorName(name);
      return name;
    }
    if (draft?.vendor_name && String(draft.vendor_name).trim()) {
      const name = String(draft.vendor_name).trim();
      setVendorName(name);
      vendorNameRef.current = name;
      return name;
    }
    const stored = getStoredVendor(draftId);
    if (stored?.name) {
      const name = String(stored.name).trim();
      setVendorName(name);
      vendorNameRef.current = name;
      return name;
    }
    return '';
  }, [draft?.vendor_name, draftId, vendorName]);

  const handleSelectVendor = useCallback((farmOrCode, farmNameParam, farmCurrencyParam) => {
    if (!canEdit) return;

    let code = '';
    let name = '';
    let vCurr = '';

    if (farmOrCode && typeof farmOrCode === 'object') {
      code = farmOrCode.code || farmOrCode.farmCode || farmOrCode.CardCode || '';
      name = farmOrCode.name || farmOrCode.farmName || farmOrCode.CardName || code;
      vCurr = farmOrCode.currency ? String(farmOrCode.currency).trim() : '';
    } else {
      code = farmOrCode || '';
      name = farmNameParam || code;
      vCurr = farmCurrencyParam ? String(farmCurrencyParam).trim() : '';
    }

    if (!code) return;

    // 1. Update React state immediately
    setVendorCardCode(code);
    setVendorName(name);

    // 2. Update synchronous refs immediately
    vendorCardCodeRef.current = code;
    vendorNameRef.current = name;

    // 3. Save Vendor to draft-scoped sessionStorage
    saveVendorToStorage(draftId, code, name, vCurr);

    // 4. Update currency if fixed SAP currency
    let activeCurrency = currency;
    if (vCurr && vCurr !== '##') {
      activeCurrency = vCurr;
      setCurrency(vCurr);
    }

    // 5. Persist the Vendor to the backend when safe
    if (draftId) {
      savePurchaseQuotationDraft(draftId, {
        vendor_card_code: code,
        vendor_name: name,
        currency: activeCurrency,
      })
        .then((updated) => {
          if (updated) {
            setDraft((prev) => ({ ...prev, ...updated }));
          }
        })
        .catch((err) => {
          console.warn('Silent auto-save of vendor selection failed:', err);
        });
    }
  }, [canEdit, currency, draftId]);

  const goToStep = (stepIdx) => {
    const trimmedVehicle = String(vehicleNumber || '').trim();
    if (trimmedVehicle.length > 11) {
      toast.error(
        t('purchaseQuotation.invalidVehicleNumber') ||
        (lang === 'ar' ? 'رقم العربية لا يمكن أن يتجاوز 11 حرفاً.' : 'Vehicle number cannot exceed 11 characters.')
      );
      return;
    }
    const qtyNum = containerQuantity === '' ? 0 : Number(containerQuantity);
    if (isNaN(qtyNum) || !Number.isInteger(qtyNum) || qtyNum < 0) {
      toast.error(
        t('purchaseQuotation.invalidContainerQty') ||
        (lang === 'ar' ? 'كمية الكونتينر يجب أن تكون رقماً صحيحاً غير سالب.' : 'Container quantity must be a whole non-negative number.')
      );
      return;
    }
    const effectiveVendor = getEffectiveVendorCode();
    if (stepIdx > 1 && !effectiveVendor) {
      toast.error(t('purchaseQuotation.vendorRequired') || (lang === 'ar' ? 'يرجى اختيار مورد للمتابعة.' : 'Please select a vendor to proceed.'));
      return;
    }
    if (effectiveVendor && !vendorCardCode) {
      setVendorCardCode(effectiveVendor);
      vendorCardCodeRef.current = effectiveVendor;
      const effName = getEffectiveVendorName();
      if (effName) {
        setVendorName(effName);
        vendorNameRef.current = effName;
      }
    }
    if (stepIdx > 3) {
      const hasMissingGroup = lines.some((l) => !String(l.item_group_code || '').trim());
      if (hasMissingGroup) {
        toast.error(
          t('purchaseQuotation.itemGroupRequired') ||
          (lang === 'ar' ? 'يرجى اختيار مجموعة الأصناف لجميع السطور للمتابعة.' : 'Please select an Item Group for all lines to proceed.')
        );
        return;
      }
    }
    if (stepIdx > 4) {
      const hasMissingItem = lines.some((l) => !String(l.item_code || '').trim());
      if (hasMissingItem) {
        toast.error(
          t('purchaseQuotation.itemRequired') ||
          (lang === 'ar' ? 'يرجى اختيار رقم الصنف (Item No.) لجميع السطور للمتابعة.' : 'Please select an Item No. for all lines to proceed.')
        );
        return;
      }
    }
    if (stepIdx > 5) {
      const hasInvalidQty = lines.some((l) => Number(l.quoted_qty || 0) <= 0 || Number(l.required_qty || 0) <= 0);
      if (hasInvalidQty) {
        toast.error(
          t('purchaseQuotation.invalidQuantities') ||
          (lang === 'ar' ? 'يرجى إدخال كميات صحيحة لجميع السطور للمتابعة.' : 'Please enter valid quantities for all lines to proceed.')
        );
        return;
      }
    }
    setActiveStep(stepIdx);
    if (stepIdx > maxReachedStep) {
      setMaxReachedStep(stepIdx);
    }
  };

  const loadDraftData = useCallback(async () => {
    if (!draftId) return;
    setLoading(true);
    try {
      const data = await loadPurchaseQuotationDraft(draftId);
      setDraft(data);
      if (data) {
        // Non-destructive vendor resolution
        const incomingVendor = (data.vendor_card_code || '').trim();
        const incomingVendorName = (data.vendor_name || '').trim();
        const incomingCurrency = (data.currency || '').trim();

        if (incomingVendor) {
          // Backend has valid vendor -> sync state + refs + storage
          setVendorCardCode(incomingVendor);
          vendorCardCodeRef.current = incomingVendor;
          setVendorName(incomingVendorName);
          vendorNameRef.current = incomingVendorName;
          saveVendorToStorage(draftId, incomingVendor, incomingVendorName, incomingCurrency);
        } else {
          // Backend returned empty vendor. Check effective local vendor first!
          const localEffective = vendorCardCodeRef.current || vendorCardCode || getStoredVendor(draftId)?.cardCode || '';
          const localName = vendorNameRef.current || vendorName || getStoredVendor(draftId)?.name || '';
          if (localEffective) {
            // Keep local vendor! DO NOT destroy it with empty backend response!
            setVendorCardCode(localEffective);
            vendorCardCodeRef.current = localEffective;
            if (localName) {
              setVendorName(localName);
              vendorNameRef.current = localName;
            }
            saveVendorToStorage(draftId, localEffective, localName, incomingCurrency || currency);
          } else {
            // Genuinely no vendor anywhere
            setVendorCardCode('');
            vendorCardCodeRef.current = '';
            setVendorName('');
            vendorNameRef.current = '';
            clearStoredVendor(draftId);
          }
        }

        setVehicleNumber(data.vehicle_number || '');
        setContainerQuantity(data.container_quantity !== undefined && data.container_quantity !== null ? String(data.container_quantity) : '0');
        setContactPersonCode(data.contact_person_code || '');
        setVendorRefNo(data.vendor_ref_no || '');
        if (data.currency) setCurrency(data.currency);
        setGroupNo(data.group_no || '');
        setPostingDate(data.posting_date || getTodayDate());
        setValidUntil(data.valid_until || getTodayDate());
        setDocumentDate(data.document_date || getTodayDate());
        setRequiredDate(data.required_date || getTodayDate());
        setBuyerCode(data.buyer_code || '');
        setOwnerCode(data.owner_code || '');
        setJournalRemark(data.journal_remark || 'Purchase Quotation');
        setRemarks(data.remarks || '');
        setDiscountPercent(String(data.discount_percent ?? 0));

        const parsedLines = Array.isArray(data.lines) && data.lines.length > 0
          ? data.lines.map((l) => ({
              ...createDefaultLine(),
              ...l,
              item_code: l.item_code || '',
              item_description: l.item_description || l.item_name || '',
              item_group_code: l.item_group_code ? String(l.item_group_code) : '',
              quoted_qty: Number(l.quoted_qty ?? 1),
              required_qty: Number(l.required_qty ?? 1),
              quoted_date: l.quoted_date || data.posting_date || getTodayDate(),
              required_date: l.required_date || data.required_date || data.valid_until || getTodayDate(),
              unit_price: Number(l.unit_price ?? 0),
              discount_percent: Number(l.discount_percent ?? 0),
              warehouse_code: l.warehouse_code || '',
              location_code: l.location_code !== null && l.location_code !== undefined ? String(l.location_code) : (l.costing_code || ''),
              costing_code: l.costing_code || '',
              costing_code2: l.costing_code2 || '',
              uom_code: l.uom_code || 'PCS',
            }))
          : [createDefaultLine()];
        // Verify saved selections with one exact lookup per distinct item, never a group catalog.
        const loadedSelections = {};
        await Promise.all([...new Set(parsedLines.filter((line) => line.item_code && line.item_group_code)
          .map((line) => `${line.item_group_code}::${line.item_code}`))].map(async (selection) => {
          const [group, code] = selection.split('::');
          try {
            const response = await API.get('/quality/items/', { params: { lookup: 1, code, item_group_code: group, limit: 1 } });
            loadedSelections[selection] = response.data?.items || [];
          } catch { /* Preserve the saved draft on discovery failure; posting validation remains authoritative. */ }
        }));

        // Restore saved item only if consistent with group
        const verifiedLines = parsedLines.map((l) => {
          if (!l.item_group_code) {
            return {
              ...l,
              item_code: '',
              item_description: '',
            };
          }
          if (l.item_code) {
            const itemsInGroup = loadedSelections[`${l.item_group_code}::${l.item_code}`];
            if (Array.isArray(itemsInGroup)) {
              const itemMatches = itemsInGroup.some((it) => String(it.item_code) === String(l.item_code));
              if (!itemMatches) {
                return {
                  ...l,
                  item_code: '',
                  item_description: '',
                };
              }
            }
          }
          return l;
        });

        setLines(verifiedLines);

        if (parsedLines.length > 0) {
          if (parsedLines[0].warehouse_code) setDefaultWarehouse(parsedLines[0].warehouse_code);
          if (parsedLines[0].location_code) {
            setDefaultLocation(String(parsedLines[0].location_code));
          } else if (parsedLines[0].costing_code) {
            setDefaultLocation(String(parsedLines[0].costing_code));
          }
          if (parsedLines[0].costing_code2) {
            setDefaultCostCenter(String(parsedLines[0].costing_code2));
          } else if (parsedLines[0].costing_code && String(parsedLines[0].costing_code).startsWith('210')) {
            setDefaultCostCenter(String(parsedLines[0].costing_code));
          }
        }

        if (data.status === 'POSTED') {
          setActiveStep(8);
          setMaxReachedStep(8);
        } else if (data.vendor_card_code || vendorCardCodeRef.current || getStoredVendor(draftId)?.cardCode) {
          let reached = 2;
          const hasGroup = verifiedLines.length > 0 && verifiedLines.every((l) => String(l.item_group_code || '').trim());
          if (hasGroup) reached = 3;
          const hasItem = hasGroup && verifiedLines.every((l) => String(l.item_code || '').trim());
          if (hasItem) reached = 4;
          const hasQty = hasItem && verifiedLines.every((l) => Number(l.quoted_qty || 0) > 0 && Number(l.required_qty || 0) > 0);
          if (hasQty) reached = 5;
          setMaxReachedStep((prev) => Math.max(prev, reached));
        }
      }
    } catch (err) {
      console.error('Failed to load draft:', err);
      toastRef.current?.error(tRef.current?.('purchaseQuotation.loadFailed') || 'Failed to load draft');
    } finally {
      setLoading(false);
    }
  }, [currency, draftId]);

  useEffect(() => {
    loadDraftData();
  }, [loadDraftData]);

  // Load SAP master data on mount
  useEffect(() => {
    let isMounted = true;
    loadCurrencies()
      .then((res) => {
        if (isMounted) setCurrencies(Array.isArray(res) ? res : []);
      })
      .catch((err) => console.error('Failed to load currencies:', err));

    setLoadingItemGroups(true);
    loadQualityItemGroups()
      .then((res) => {
        if (isMounted) {
          const groups = Array.isArray(res) ? res : [];
          setItemGroups(groups);
        }
      })
      .catch((err) => console.error('Failed to load item groups:', err))
      .finally(() => {
        if (isMounted) setLoadingItemGroups(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedVendor = useMemo(() => {
    return farms.find((f) => String(f.code || f.farmCode) === String(vendorCardCode)) || null;
  }, [farms, vendorCardCode]);

  const vendorSapCurrency = useMemo(() => {
    const c = selectedVendor?.currency;
    return c ? String(c).trim() : '';
  }, [selectedVendor]);

  const isVendorCurrencyLocked = useMemo(() => {
    return Boolean(vendorSapCurrency && vendorSapCurrency !== '##');
  }, [vendorSapCurrency]);

  // Synchronize currency when a vendor with fixed currency is selected or loaded
  useEffect(() => {
    if (canEdit && isVendorCurrencyLocked && vendorSapCurrency) {
      if (currency !== vendorSapCurrency) {
        setCurrency(vendorSapCurrency);
      }
    }
  }, [canEdit, isVendorCurrencyLocked, vendorSapCurrency, currency]);

  // Live Totals Calculation
  const totals = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;

    const calculatedLines = lines.map((line) => {
      const qQty = Number(line.quoted_qty || 0);
      const price = Number(line.unit_price || 0);
      const disc = Number(line.discount_percent || 0);
      const gross = qQty * price;
      const net = gross * (1 - disc / 100);
      const taxRate = Number(line.tax_rate || 0);
      const tax = net * (taxRate / 100);

      subtotal += net;
      taxTotal += tax;
      return { ...line, line_total: net, tax_amount: tax };
    });

    const hdrDiscPct = Number(discountPercent || 0);
    const hdrDiscAmt = subtotal * (hdrDiscPct / 100);
    const totalDue = Math.max(0, subtotal - hdrDiscAmt + taxTotal);

    return {
      subtotal,
      hdrDiscAmt,
      taxTotal,
      totalDue,
      calculatedLines,
    };
  }, [lines, discountPercent]);

  const handleLineChange = (index, field, value) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        ...createDefaultLine(),
        item_group_code: '',
        quoted_date: postingDate,
        required_date: requiredDate || validUntil,
        warehouse_code: defaultWarehouse,
        location_code: defaultLocation,
        costing_code: defaultLocation,
        costing_code2: defaultCostCenter,
      },
    ]);
  };

  const handleRemoveLine = (index) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const applyLogisticsToAllLines = () => {
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        warehouse_code: defaultWarehouse || l.warehouse_code,
        location_code: defaultLocation || l.location_code,
        costing_code: defaultLocation || l.costing_code,
        costing_code2: defaultCostCenter || l.costing_code2,
      }))
    );
    toast.success(lang === 'ar' ? 'تم تطبيق إعدادات التوزيع على جميع السطور' : 'Applied logistics to all lines.');
  };

  const collectPayload = () => {
    const effectiveVendor = getEffectiveVendorCode();
    const effectiveVendorName = getEffectiveVendorName();
    return {
      vehicle_number: (vehicleNumber || '').trim(),
      container_quantity: Math.max(0, parseInt(containerQuantity || '0', 10) || 0),
      vendor_card_code: effectiveVendor,
      vendor_name: effectiveVendorName,
      contact_person_code: contactPersonCode ? Number(contactPersonCode) : null,
      vendor_ref_no: vendorRefNo,
      currency,
      group_no: groupNo,
      posting_date: postingDate,
      valid_until: validUntil,
      document_date: documentDate,
      required_date: requiredDate,
      buyer_code: buyerCode ? Number(buyerCode) : null,
      owner_code: ownerCode ? Number(ownerCode) : null,
      journal_remark: journalRemark,
      remarks,
      ship_to_address: '',
      pay_to_address: '',
      discount_percent: Number(discountPercent || 0),
      freight: 0,
      rounding: 0,
      lines: lines.map((l) => {
        const locCode = l.location_code || defaultLocation || '';
        const genCode = l.costing_code2 || (l.costing_code && l.costing_code !== locCode ? l.costing_code : '') || defaultCostCenter || '';
        return {
          item_code: l.item_code,
          item_description: l.item_description || l.item_name || '',
          item_group_code: l.item_group_code || '',
          quoted_date: l.quoted_date || postingDate,
          required_date: l.required_date || requiredDate || validUntil,
          quoted_qty: Number(l.quoted_qty || 1),
          required_qty: Number(l.required_qty || 1),
          uom_code: l.uom_code || 'PCS',
          unit_price: Number(l.unit_price || 0),
          discount_percent: Number(l.discount_percent || 0),
          tax_code: l.tax_code || '',
          warehouse_code: l.warehouse_code || defaultWarehouse || '',
          location_code: locCode,
          costing_code: locCode,
          cost_center_dimension: 1,
          costing_code2: genCode,
        };
      }),
    };
  };

  const handleSave = async (quiet = false) => {
    if (!draftId || !canEdit) return null;
    setSaving(true);
    setErrors({});
    try {
      const payload = collectPayload();
      const updated = await savePurchaseQuotationDraft(draftId, payload);
      setDraft(updated);
      if (updated?.vendor_card_code) {
        saveVendorToStorage(draftId, updated.vendor_card_code, updated.vendor_name, updated.currency);
      }
      if (!quiet) {
        toast.success(t('purchaseQuotation.draftSaved'));
      }
      return updated;
    } catch (err) {
      console.error('Save failed:', err);
      if (err.response?.data?.errors) {
        setErrors(err.response.data.errors);
      }
      if (!quiet) {
        toast.error(err.response?.data?.error || t('purchaseQuotation.saveFailed'));
      }
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!draftId || !canEdit) return;
    const hasMissingItem = lines.some((l) => !String(l.item_code || '').trim());
    if (hasMissingItem) {
      toast.error(
        t('purchaseQuotation.itemRequired') ||
        (lang === 'ar' ? 'يرجى اختيار رقم الصنف (Item No.) لجميع السطور للمتابعة.' : 'Please select an Item No. for all lines to proceed.')
      );
      return;
    }
    setApproving(true);
    setErrors({});
    try {
      const saved = await handleSave(true);
      if (!saved) return;
      const approved = await approvePurchaseQuotationDraftForPosting(draftId);
      setDraft(approved);
      const preview = await previewPurchaseQuotationPosting(draftId, true);
      setPostingPreview(preview);
      toast.success(t('purchaseQuotation.approvedForPosting'));
      goToStep(8);
    } catch (err) {
      console.error('Approval failed:', err);
      toast.error(err.response?.data?.error || t('purchaseQuotation.approvalFailed'));
    } finally {
      setApproving(false);
    }
  };

  const handlePreviewPayload = async () => {
    if (!draftId) return;
    setVerifyingPayload(true);
    try {
      await handleSave(true);
      const preview = await previewPurchaseQuotationPosting(draftId, true);
      setPostingPreview(preview);
      toast.info(lang === 'ar' ? 'تم تحديث معاينة بيانات المستند بنجاح' : 'Document data preview updated.');
    } catch (err) {
      console.error('Payload preview failed:', err);
      toast.error(err.response?.data?.error || t('purchaseQuotation.loadFailed'));
    } finally {
      setVerifyingPayload(false);
    }
  };

  const handlePostToSap = async () => {
    if (!draftId || draft?.status !== 'APPROVED_FOR_POSTING') return;
    setPosting(true);
    try {
      const result = await postPurchaseQuotationToSAP(draftId);
      if (result?.draft) {
        setDraft(result.draft);
        toast.success(t('purchaseQuotation.postSuccess'));
        navigate(`/shipping-delivery/documents/${draftId}`);
      }
    } catch (err) {
      console.error('SAP posting failed:', err);
      toast.error(err.response?.data?.error || t('purchaseQuotation.postFailed'));
      loadDraftData();
    } finally {
      setPosting(false);
    }
  };

  const handleCancel = async () => {
    if (!draftId || isPosted) return;
    if (!window.confirm(t('purchaseQuotation.confirmCancel'))) return;
    setCancelling(true);
    try {
      const cancelled = await cancelPurchaseQuotationDraft(draftId, 'Cancelled by user');
      setDraft(cancelled);
      toast.info(t('purchaseQuotation.cancelledSuccess'));
      navigate('/shipping-delivery');
    } catch (err) {
      console.error('Cancel failed:', err);
      toast.error(err.response?.data?.error || t('purchaseQuotation.cancelFailed'));
    } finally {
      setCancelling(false);
    }
  };

  // Render navigation buttons at the bottom of each step
  const renderWizardNav = (currentStepIdx) => (
    <div className="grpo-wizard-nav" style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
      <div>
        {currentStepIdx > 0 ? (
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => goToStep(currentStepIdx - 1)}
          >
            {lang === 'ar' ? '→ السابق' : '← Previous'}
          </button>
        ) : (
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => navigate('/shipping-delivery')}
          >
            {lang === 'ar' ? '→ القائمة' : '← Back to List'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        {canEdit && (
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => handleSave(false)}
            disabled={saving || approving || posting}
          >
            {saving ? t('common.loading') : `💾 ${t('purchaseQuotation.saveDraft')}`}
          </button>
        )}

        {currentStepIdx < 8 ? (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={async () => {
              if (currentStepIdx === 0) {
                const trimmedVehicle = String(vehicleNumber || '').trim();
                if (trimmedVehicle.length > 11) {
                  toast.error(
                    t('purchaseQuotation.invalidVehicleNumber') ||
                    (lang === 'ar' ? 'رقم العربية لا يمكن أن يتجاوز 11 حرفاً.' : 'Vehicle number cannot exceed 11 characters.')
                  );
                  return;
                }
                const qtyNum = containerQuantity === '' ? 0 : Number(containerQuantity);
                if (isNaN(qtyNum) || !Number.isInteger(qtyNum) || qtyNum < 0) {
                  toast.error(
                    t('purchaseQuotation.invalidContainerQty') ||
                    (lang === 'ar' ? 'كمية الكونتينر يجب أن تكون رقماً صحيحاً غير سالب.' : 'Container quantity must be a whole non-negative number.')
                  );
                  return;
                }
                handleSave(true);
              }
              if (currentStepIdx === 1) {
                const effectiveVendor = getEffectiveVendorCode();
                if (!effectiveVendor) {
                  toast.error(t('purchaseQuotation.vendorRequired') || (lang === 'ar' ? 'يرجى اختيار مورد للمتابعة.' : 'Please select a vendor to proceed.'));
                  return;
                }
                handleSave(true);
              }
              if (currentStepIdx === 2) {
                const effectiveVendor = getEffectiveVendorCode();
                if (!effectiveVendor) {
                  toast.error(t('purchaseQuotation.vendorRequired') || (lang === 'ar' ? 'يرجى اختيار مورد للمتابعة.' : 'Please select a vendor to proceed.'));
                  return;
                }
                if (!postingDate || !validUntil || !documentDate || !requiredDate) {
                  toast.error(lang === 'ar' ? 'يرجى إدخال جميع التواريخ المطلوبة للمتابعة.' : 'Please enter all required dates to proceed.');
                  return;
                }
                if (postingDate && validUntil && validUntil < postingDate) {
                  toast.error(lang === 'ar' ? 'تاريخ الصلاحية لا يمكن أن يكون قبل تاريخ الترحيل.' : 'Valid until date cannot be before posting date.');
                  return;
                }
                handleSave(true);
              }
              if (currentStepIdx === 3) {
                const hasMissingGroup = lines.some((l) => !String(l.item_group_code || '').trim());
                if (hasMissingGroup) {
                  toast.error(
                    t('purchaseQuotation.itemGroupRequired') ||
                    (lang === 'ar' ? 'يرجى اختيار مجموعة الأصناف لجميع السطور للمتابعة.' : 'Please select an Item Group for all lines to proceed.')
                  );
                  return;
                }
                handleSave(true);
              }
              if (currentStepIdx === 4) {
                const hasMissingItem = lines.some((l) => !String(l.item_code || '').trim());
                if (hasMissingItem) {
                  toast.error(
                    t('purchaseQuotation.itemRequired') ||
                    (lang === 'ar' ? 'يرجى اختيار رقم الصنف (Item No.) لجميع السطور للمتابعة.' : 'Please select an Item No. for all lines to proceed.')
                  );
                  return;
                }
                handleSave(true);
              }
              if (currentStepIdx === 5) {
                const hasInvalidQty = lines.some((l) => Number(l.quoted_qty || 0) <= 0 || Number(l.required_qty || 0) <= 0);
                if (hasInvalidQty) {
                  toast.error(
                    t('purchaseQuotation.invalidQuantities') ||
                    (lang === 'ar' ? 'يرجى إدخال كميات صحيحة لجميع السطور للمتابعة.' : 'Please enter valid quantities for all lines to proceed.')
                  );
                  return;
                }
                handleSave(true);
              }
              if (currentStepIdx === 6) {
                handleSave(true);
              }
              if (currentStepIdx === 7) {
                handleSave(true);
              }
              goToStep(currentStepIdx + 1);
            }}
          >
            {lang === 'ar' ? 'التالي ←' : 'Next →'}
          </button>
        ) : null}

        {currentStepIdx === 8 && canAdministerQuotation && canEdit && draft?.status !== 'APPROVED_FOR_POSTING' && (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={handleApprove}
            disabled={approving || saving}
          >
            {approving ? (
              <>
                <CircularProgress size={16} color="inherit" />
                <span>{t('common.pleaseWait')}</span>
              </>
            ) : (
              <>✓ {t('purchaseQuotation.approveAndPreview')}</>
            )}
          </button>
        )}

        {currentStepIdx === 8 && canAdministerQuotation && draft?.status === 'APPROVED_FOR_POSTING' && (
          <button
            type="button"
            className="app-button app-button--primary"
            style={{ background: '#10b981', borderColor: '#10b981' }}
            onClick={handlePostToSap}
            disabled={posting}
          >
            {posting ? (
              <>
                <CircularProgress size={16} color="inherit" />
                <span>{t('purchaseQuotation.postingToSap')}</span>
              </>
            ) : (
              <>🚀 {t('purchaseQuotation.confirmPostToSap')}</>
            )}
          </button>
        )}
      </div>
    </div>
  );

  // Step 1: Vehicle & Container
  const renderVehicleStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.vehicle')}</h1>
        <p className="quality-wizard-subtitle">
          {t('purchaseQuotation.vehicleAndContainerDesc')}
        </p>
      </div>

      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          background: 'var(--color-bg-secondary, var(--color-bg))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            🚛 {t('purchaseQuotation.vehicleAndContainer')}
          </h3>
        </div>

        <div className="quality-form-grid qrev-meta-grid">
          <label className="form-field">
            <span>{t('purchaseQuotation.vehicleNumber')}</span>
            <input
              className="app-input"
              type="text"
              maxLength={11}
              placeholder={t('purchaseQuotation.vehicleNumberPlaceholder')}
              value={vehicleNumber}
              disabled={!canEdit}
              onChange={(e) => setVehicleNumber(e.target.value)}
              onBlur={() => setVehicleNumber((prev) => prev.trim())}
            />
          </label>

          <label className="form-field">
            <span>{t('purchaseQuotation.containerQuantity')}</span>
            <input
              className="app-input"
              type="number"
              min="0"
              step="1"
              value={containerQuantity}
              disabled={!canEdit}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setContainerQuantity('');
                  return;
                }
                if (/^\d+$/.test(val)) {
                  setContainerQuantity(val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === '.' || e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                  e.preventDefault();
                }
              }}
              onBlur={() => {
                if (containerQuantity === '') {
                  setContainerQuantity('0');
                }
              }}
            />
          </label>
        </div>
      </div>

      {renderWizardNav(0)}
    </section>
  );

  // Step 2: Vendor Selection
  const renderVendorStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.vendor')}</h1>
        <p className="quality-wizard-subtitle">
          {t('purchaseQuotation.selectVendorPrompt')}
        </p>
      </div>

      <SearchableSelect options={[]} searchSource={farmSearch} disabled={!canEdit}
        value={getEffectiveVendorCode()} label={t('purchaseQuotation.vendor')}
        selectedOptions={[{ value: getEffectiveVendorCode(), label: `${getEffectiveVendorCode()} - ${getEffectiveVendorName()}` }]}
        onSearchResults={(rows) => setFarms(rows.map((row) => ({ ...row, code: row.farmCode, name: row.farmName })))}
        onSelectOption={(option) => {
          if (option?.raw) handleSelectVendor({ ...option.raw, code: option.raw.farmCode, name: option.raw.farmName });
          else { setVendorCardCode(''); vendorCardCodeRef.current = ''; setVendorName(''); vendorNameRef.current = ''; clearStoredVendor(draftId); }
        }} />

      {renderWizardNav(1)}
    </section>
  );

  // Step 3: Header & Dates
  const renderHeaderStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.header')}</h1>
        <p className="quality-wizard-subtitle">{t('purchaseQuotation.desc')}</p>
      </div>

      <div className="quality-form-grid qrev-meta-grid">
        {/* Posting Date */}
        <label className="form-field">
          <span>{t('purchaseQuotation.postingDate')} *</span>
          <input
            className="app-input"
            type="date"
            value={postingDate}
            disabled={!canEdit}
            onChange={(e) => setPostingDate(e.target.value)}
          />
        </label>

        {/* Valid Until */}
        <label className="form-field">
          <span>{t('purchaseQuotation.validUntil')} *</span>
          <input
            className="app-input"
            type="date"
            value={validUntil}
            disabled={!canEdit}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </label>

        {/* Document Date */}
        <label className="form-field">
          <span>{t('purchaseQuotation.documentDate')}</span>
          <input
            className="app-input"
            type="date"
            value={documentDate}
            disabled={!canEdit}
            onChange={(e) => setDocumentDate(e.target.value)}
          />
        </label>

        {/* Required Date */}
        <label className="form-field">
          <span>{t('purchaseQuotation.requiredDate')}</span>
          <input
            className="app-input"
            type="date"
            value={requiredDate}
            disabled={!canEdit}
            onChange={(e) => setRequiredDate(e.target.value)}
          />
        </label>

        {/* Vendor Ref No */}
        <label className="form-field">
          <span>{t('purchaseQuotation.vendorRefNo')}</span>
          <input
            className="app-input"
            type="text"
            value={vendorRefNo}
            disabled={!canEdit}
            onChange={(e) => setVendorRefNo(e.target.value)}
          />
        </label>

        {/* Group No */}
        <label className="form-field">
          <span>{t('purchaseQuotation.groupNo')}</span>
          <input
            className="app-input"
            type="text"
            value={groupNo}
            disabled={!canEdit}
            onChange={(e) => setGroupNo(e.target.value)}
          />
        </label>
      </div>

      {renderWizardNav(2)}
    </section>
  );

  // Step 4: Item Group
  const renderItemGroupStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title">{t('purchaseQuotation.steps.itemGroup')}</h1>
          <p className="quality-wizard-subtitle">
            {t('purchaseQuotation.itemGroupStepDesc') || (lang === 'ar'
              ? 'اختر مجموعة الأصناف لكل سطر لتحميل الأصناف المطابقة.'
              : 'Select an item group for each shipping line to load matching items.')}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="app-button app-button--secondary app-button--compact"
            onClick={handleAddLine}
          >
            ➕ {t('purchaseQuotation.addLine')}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
        {lines.map((line, idx) => {
          const grpObj = itemGroups.find((g) => String(g.code) === String(line.item_group_code));
          const grpLabel = grpObj ? `${grpObj.code} - ${grpObj.name}` : line.item_group_code;

          return (
            <div
              key={idx}
              className="card-panel"
              style={{
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '16px',
                background: 'var(--color-bg-secondary, var(--color-bg))',
              }}
            >
              {/* Line Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <strong style={{ fontSize: '1rem', color: 'var(--color-primary)' }}>
                  #{idx + 1} {grpLabel ? `- ${grpLabel}` : (lang === 'ar' ? '- سطر جديد' : '- New Line')}
                </strong>
                {canEdit && lines.length > 1 && (
                  <button
                    type="button"
                    className="app-button app-button--danger app-button--compact"
                    style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                    onClick={() => handleRemoveLine(idx)}
                  >
                    🗑️ {t('purchaseQuotation.removeLine')}
                  </button>
                )}
              </div>

              {/* Item Group Selector */}
              <div className="pq-item-stage">
                <div className="pq-item-stage__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="pq-item-stage__title">
                    {t('purchaseQuotation.sectionItemGroup')}
                  </h3>
                  {loadingItemGroups && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--color-primary)' }}>
                      <CircularProgress size={14} color="inherit" />
                      {lang === 'ar' ? 'جاري تحميل المجموعات...' : 'Loading groups...'}
                    </span>
                  )}
                </div>
                <label className="form-field" style={{ margin: 0 }}>
                  <SearchableSelect
                    className="app-select"
                    disabled={!canEdit || loadingItemGroups}
                    loading={loadingItemGroups}
                    value={line.item_group_code || ''}
                    placeholder={loadingItemGroups ? (lang === 'ar' ? 'جاري تحميل المجموعات...' : 'Loading groups...') : `-- ${t('purchaseQuotation.selectItemGroup')} --`}
                    onChange={(e) => {
                      const grp = e.target.value;
                      handleLineChange(idx, 'item_group_code', grp);
                      handleLineChange(idx, 'item_code', '');
                      handleLineChange(idx, 'item_description', '');
                      handleLineChange(idx, 'uom_code', 'PCS');
                      setItemSearchMap((prev) => ({ ...prev, [idx]: '' }));
                    }}
                  >
                    <option value="">-- {t('purchaseQuotation.selectItemGroup')} --</option>
                    {itemGroups.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} - {g.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {renderWizardNav(3)}
    </section>
  );

  // Step 5: Item
  const renderItemStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.item')}</h1>
        <p className="quality-wizard-subtitle">
          {t('purchaseQuotation.itemStepDesc') || (lang === 'ar'
            ? 'اختر الصنف المطلوب لكل سطر من سطور مستند الشحن.'
            : 'Select the required item for each shipping document line.')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
        {lines.map((line, idx) => {
          const currentGroupCode = line.item_group_code || '';

          const grpObj = itemGroups.find((g) => String(g.code) === String(currentGroupCode));
          const grpLabel = grpObj ? `${grpObj.code} - ${grpObj.name}` : currentGroupCode;

          return (
            <div
              key={idx}
              className="card-panel"
              style={{
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '16px',
                background: 'var(--color-bg-secondary, var(--color-bg))',
              }}
            >
              {/* Line Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <strong style={{ fontSize: '1rem', color: 'var(--color-primary)' }}>
                  #{idx + 1} - <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.item_description || line.item_code)}</span> {line.item_description || line.item_code || (lang === 'ar' ? 'اختيار الصنف' : 'Item Selection')}
                </strong>
                {grpLabel && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {t('purchaseQuotation.group')}: <strong>{grpLabel}</strong>
                  </span>
                )}
              </div>

              <SearchableSelect key={currentGroupCode} options={[]} disabled={!canEdit || !currentGroupCode}
                label={t('purchaseQuotation.sectionItem')} value={line.item_code}
                searchSource={{ ...remoteItemSearch, params: { item_group_code: currentGroupCode } }}
                selectedOptions={[{ value: line.item_code, label: `${line.item_code} - ${line.item_description || line.item_code}` }]}
                onSelectOption={(option) => {
                  const item = option?.raw;
                  handleLineChange(idx, 'item_code', item?.item_code || '');
                  handleLineChange(idx, 'item_description', item?.item_name || '');
                  if (item?.uom_code) handleLineChange(idx, 'uom_code', item.uom_code);
                }} />
            </div>
          );
        })}
      </div>

      {renderWizardNav(4)}
    </section>
  );

  // Step 6: Item Details
  const renderItemDetailsStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.itemDetails')}</h1>
        <p className="quality-wizard-subtitle">
          {t('purchaseQuotation.itemDetailsStepDesc') || (lang === 'ar'
            ? 'تحديد الكميات المعروضة والمطلوبة والتواريخ والأسعار لكل صنف محدد.'
            : 'Configure quoted and required quantities, dates, and pricing for each selected item.')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
        {lines.map((line, idx) => {
          const lineTotal = Number(line.quoted_qty || 0) * Number(line.unit_price || 0) * (1 - Number(line.discount_percent || 0) / 100);

          return (
            <div
              key={idx}
              className="card-panel"
              style={{
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '16px',
                background: 'var(--color-bg-secondary, var(--color-bg))',
              }}
            >
              {/* Line Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <strong style={{ fontSize: '1rem', color: 'var(--color-primary)' }}>
                  #{idx + 1} - <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.item_description || line.item_code)}</span> {line.item_description || line.item_code || (lang === 'ar' ? 'تفاصيل الصنف' : 'Item Details')}
                </strong>
                {line.item_code && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    [{line.item_code}]
                  </span>
                )}
              </div>

              {/* Item Details Fields */}
              <div className="pq-item-stage">
                <div className="pq-item-stage__header">
                  <h3 className="pq-item-stage__title">
                    {t('purchaseQuotation.sectionItemDetails')}
                  </h3>
                </div>

                {!line.item_code ? (
                  <div className="quality-vendor-state" style={{ padding: '16px' }}>
                    ℹ️ {t('purchaseQuotation.selectItemFirst')}
                  </div>
                ) : (
                  <div className="quality-form-grid qrev-meta-grid">
                    {/* Item Description */}
                    <label className="form-field quality-form-field--full">
                      <span>{t('purchaseQuotation.itemDesc')}</span>
                      <input
                        className="app-input"
                        type="text"
                        value={line.item_description}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'item_description', e.target.value)}
                      />
                    </label>

                    {/* CRITICAL: QUOTED QTY vs REQUIRED QTY */}
                    <label className="form-field" style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '8px', borderRadius: '6px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                        📊 {t('purchaseQuotation.quotedQty')} (Quantity) *
                      </span>
                      <input
                        className="app-input"
                        type="number"
                        min="0.001"
                        step="any"
                        value={line.quoted_qty}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'quoted_qty', e.target.value)}
                      />
                      <span className="form-field__hint">
                        {lang === 'ar' ? 'الكمية المعروضة من المورد' : 'Supplier offered quantity'}
                      </span>
                    </label>

                    <label className="form-field" style={{ background: 'rgba(16, 185, 129, 0.05)', padding: '8px', borderRadius: '6px' }}>
                      <span style={{ fontWeight: 700, color: '#10b981' }}>
                        📋 {t('purchaseQuotation.requiredQty')} (RequiredQuantity) *
                      </span>
                      <input
                        className="app-input"
                        type="number"
                        min="0.001"
                        step="any"
                        value={line.required_qty}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'required_qty', e.target.value)}
                      />
                      <span className="form-field__hint">
                        {lang === 'ar' ? 'الكمية المطلوبة داخلياً' : 'Internal required quantity'}
                      </span>
                    </label>

                    {/* CRITICAL: QUOTED DATE vs REQUIRED DATE */}
                    <label className="form-field">
                      <span>{t('purchaseQuotation.quotedDate')} (ShipDate)</span>
                      <input
                        className="app-input"
                        type="date"
                        value={line.quoted_date || postingDate}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'quoted_date', e.target.value)}
                      />
                    </label>

                    <label className="form-field">
                      <span>{t('purchaseQuotation.requiredDate')}</span>
                      <input
                        className="app-input"
                        type="date"
                        value={line.required_date || requiredDate || validUntil}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'required_date', e.target.value)}
                      />
                    </label>

                    {/* Unit Price & Discount */}
                    <label className="form-field">
                      <span>{t('purchaseQuotation.unitPrice')}</span>
                      <input
                        className="app-input"
                        type="number"
                        min="0"
                        step="any"
                        value={line.unit_price}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'unit_price', e.target.value)}
                      />
                    </label>

                    <label className="form-field">
                      <span>{t('purchaseQuotation.discPct')}</span>
                      <input
                        className="app-input"
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={line.discount_percent}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'discount_percent', e.target.value)}
                      />
                    </label>

                    <label className="form-field">
                      <span>{t('purchaseQuotation.uom')}</span>
                      <input
                        className="app-input"
                        type="text"
                        value={line.uom_code}
                        disabled={!canEdit}
                        onChange={(e) => handleLineChange(idx, 'uom_code', e.target.value)}
                      />
                    </label>

                    <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{t('purchaseQuotation.lineTotal')}:</span>
                      <strong style={{ fontSize: '1.1rem', color: 'var(--color-primary)' }}>
                        {lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary Footer */}
      <div
        style={{
          marginTop: '20px',
          padding: '14px',
          background: 'var(--color-bg)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
          {lines.length} {t('purchaseQuotation.items')}
        </span>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
          <span>{t('purchaseQuotation.totalBeforeDiscount')}:</span>
          <strong style={{ fontSize: '1.2rem', color: 'var(--color-primary)' }}>
            {totals.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
          </strong>
        </div>
      </div>

      {renderWizardNav(5)}
    </section>
  );

  // Step 7: Logistics & Cost Centers
  const renderLogisticsStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.logistics')}</h1>
        <p className="quality-wizard-subtitle">
          {lang === 'ar'
            ? 'تحديد المستودع والموقع ومركز التكلفة العام لكل سطر.'
            : 'Configure warehouse, location, and general cost-center allocations.'}
        </p>
      </div>

      {/* Section 1: SAP Independent Allocations */}
      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          background: 'var(--color-bg-secondary, var(--color-bg))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            🏢 {lang === 'ar' ? 'توجيه المخزون والتكلفة' : 'Inventory & Cost Allocations'}
          </h3>
          {canEdit && (
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={applyLogisticsToAllLines}
            >
              🔄 {lang === 'ar' ? 'تطبيق على جميع السطور' : 'Apply to all lines'}
            </button>
          )}
        </div>

        <div className="quality-form-grid qrev-meta-grid">
          {/* 1. Warehouse Selector -> WarehouseCode (OWHS) */}
          <label className="form-field">
            <span>{t('purchaseQuotation.warehouse')} (WarehouseCode)</span>
            <SearchableSelect
              className="app-select"
              searchSource={warehouseSearch}
              value={defaultWarehouse}
              disabled={!canEdit}
              placeholder={`-- ${t('purchaseQuotation.warehouse')} --`}
              onChange={(e) => setDefaultWarehouse(e.target.value)}
            >
              <option value="">-- {t('purchaseQuotation.warehouse')} --</option>
              {warehouses.map((w) => {
                const code = w.code || w.WarehouseCode;
                const name = w.name || w.WarehouseName || code;
                return (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                );
              })}
            </SearchableSelect>
            <span className="form-field__hint">
              {lang === 'ar' ? 'المستودع المحدد للمستند' : 'Warehouse assigned to this document'}
            </span>
          </label>

          {/* 2. Location Selector -> Cost Centers Dimension 1 (Location) */}
          <label className="form-field">
            <span>{t('purchaseQuotation.location')}</span>
            <SearchableSelect
              className="app-select"
              value={defaultLocation}
              disabled={!canEdit || costCentersLoading}
              placeholder={`-- ${t('purchaseQuotation.location')} --`}
              onChange={(e) => setDefaultLocation(e.target.value)}
            >
              <option value="">-- {t('purchaseQuotation.location')} --</option>
              {defaultLocation && !costCentersDim1.some((cc) => cc.code === defaultLocation) && (
                <option value={defaultLocation}>{defaultLocation}</option>
              )}
              {costCentersDim1.map((cc) => (
                <option key={cc.code} value={cc.code}>
                  {cc.code} - {cc.name}
                </option>
              ))}
            </SearchableSelect>
            <span className="form-field__hint">
              {costCentersLoading
                ? t('quality.loadingCostCenters')
                : (lang === 'ar' ? 'مركز تكلفة الموقع (البُعد 1)' : 'Location Cost Center (Dimension 1)')}
            </span>
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

          {/* 3. General Cost Center Selector -> Cost Centers Dimension 2 (General) */}
          <label className="form-field">
            <span>{t('purchaseQuotation.costCenter')}</span>
            <SearchableSelect
              className="app-select"
              value={defaultCostCenter}
              disabled={!canEdit || costCentersLoading}
              placeholder={`-- ${t('purchaseQuotation.costCenter')} --`}
              onChange={(e) => setDefaultCostCenter(e.target.value)}
            >
              <option value="">-- {t('purchaseQuotation.costCenter')} --</option>
              {defaultCostCenter && !costCentersDim2.some((cc) => cc.code === defaultCostCenter) && (
                <option value={defaultCostCenter}>{defaultCostCenter}</option>
              )}
              {costCentersDim2.map((cc) => (
                <option key={cc.code} value={cc.code}>
                  {cc.code} - {cc.name}
                </option>
              ))}
            </SearchableSelect>
            <span className="form-field__hint">
              {costCentersLoading
                ? t('quality.loadingCostCenters')
                : (lang === 'ar' ? 'مركز التكلفة العام (البُعد 2)' : 'General Cost Center (Dimension 2)')}
            </span>
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
      </div>

      {renderWizardNav(6)}
    </section>
  );

  // Step 8: Financial & Remarks
  const renderFinancialStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.financial')}</h1>
        <p className="quality-wizard-subtitle">
          {lang === 'ar'
            ? 'تحديد نسبة الخصم الإجمالية وملاحظات المستند قبل الترحيل النهائي.'
            : 'Configure document header discount and remarks before final posting.'}
        </p>
      </div>

      {/* Financial & Remarks */}
      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          background: 'var(--color-bg-secondary, var(--color-bg))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            📝 {lang === 'ar' ? 'البيانات المالية والملاحظات' : 'Financial & Remarks'}
          </h3>
        </div>

        <div className="quality-form-grid qrev-meta-grid">
          <label className="form-field">
            <span>{t('purchaseQuotation.discountPct')}</span>
            <input
              className="app-input"
              type="number"
              min="0"
              max="100"
              step="any"
              value={discountPercent}
              disabled={!canEdit}
              onChange={(e) => setDiscountPercent(e.target.value)}
            />
          </label>

          <label className="form-field">
            <span>{t('purchaseQuotation.journalRemark')}</span>
            <input
              className="app-input"
              type="text"
              value={journalRemark === 'Purchase Quotation' ? '' : journalRemark}
              disabled={!canEdit}
              onChange={(e) => setJournalRemark(e.target.value)}
            />
          </label>

          <label className="form-field quality-form-field--full">
            <span>{t('purchaseQuotation.remarks')}</span>
            <textarea
              className="app-input"
              rows={3}
              value={remarks}
              disabled={!canEdit}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
        </div>
      </div>

      {renderWizardNav(7)}
    </section>
  );

  // Step 9: Review & SAP Post
  const renderReviewStep = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div className="quality-wizard-heading">
        <h1 className="page-title">{t('purchaseQuotation.steps.review')}</h1>
        <p className="quality-wizard-subtitle">{t('purchaseQuotation.reviewTitle')}</p>
      </div>

      {/* 1. 📋 Document Overview */}
      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>
          📋 {t('purchaseQuotation.documentOverview')}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '10px', fontSize: '0.9rem' }}>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">🏢</span>{t('purchaseQuotation.vendor')}:</span> <strong>{getEffectiveVendorName() || getEffectiveVendorCode() || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">🚚</span>{t('purchaseQuotation.vehicleNumber')}:</span> <strong>{vehicleNumber || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">📊</span>{t('purchaseQuotation.containerQuantity')}:</span> <strong>{containerQuantity !== undefined && containerQuantity !== null && containerQuantity !== '' ? containerQuantity : '0'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">📅</span>{t('purchaseQuotation.postingDate')}:</span> <strong>{postingDate || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">📅</span>{t('purchaseQuotation.requiredDate')}:</span> <strong>{requiredDate || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">📅</span>{t('purchaseQuotation.documentDate')}:</span> <strong>{documentDate || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">🏭</span>{t('purchaseQuotation.warehouse')}:</span> <strong>{defaultWarehouse || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">📍</span>{t('purchaseQuotation.location')}:</span> <strong>{defaultLocation || '-'}</strong></div>
          <div><span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}><span className="meta-label-icon" aria-hidden="true">📋</span>{t('purchaseQuotation.costCenter')}:</span> <strong>{defaultCostCenter || '-'}</strong></div>
        </div>
      </div>

      {/* 2. 💰 Financial Summary */}
      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>
          💰 {t('purchaseQuotation.financialSummary')}
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            gap: '12px',
          }}
        >
          <div className="card-panel" style={{ padding: '14px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('purchaseQuotation.totalBeforeDiscount')}</span>
            <h3 style={{ margin: '6px 0 0', fontSize: '1.15rem' }}>
              {totals.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
            </h3>
          </div>

          <div className="card-panel" style={{ padding: '14px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('purchaseQuotation.discountAmount')}</span>
            <h3 style={{ margin: '6px 0 0', fontSize: '1.15rem', color: '#ef4444' }}>
              -{totals.hdrDiscAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
            </h3>
          </div>

          <div className="card-panel" style={{ padding: '14px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('purchaseQuotation.taxTotal')}</span>
            <h3 style={{ margin: '6px 0 0', fontSize: '1.15rem' }}>
              +{totals.taxTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
            </h3>
          </div>

          <div
            className="card-panel"
            style={{
              padding: '14px',
              border: '2px solid var(--color-primary)',
              background: 'rgba(37, 99, 235, 0.06)',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)' }}>{t('purchaseQuotation.totalPaymentDue')}</span>
            <h3 style={{ margin: '6px 0 0', fontSize: '1.3rem', color: 'var(--color-primary)' }}>
              {totals.totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
            </h3>
          </div>
        </div>
      </div>

      {/* 3. 📦 Document Lines */}
      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700 }}>
          📦 {t('purchaseQuotation.documentLines')}
        </h3>
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
          <table className="app-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)', textAlign: lang === 'ar' ? 'right' : 'left' }}>
                <th style={{ padding: '10px' }}>#</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.itemNo')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.itemDesc')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.quotedQty')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.requiredQty')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.unitPrice')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.discPct')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.warehouse')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.location')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.costCenter')}</th>
                <th style={{ padding: '10px' }}>{t('purchaseQuotation.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan="11" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {t('common.noData')}
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => {
                  const lt = Number(l.quoted_qty || 0) * Number(l.unit_price || 0) * (1 - Number(l.discount_percent || 0) / 100);
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px' }}>{i + 1}</td>
                      <td style={{ padding: '10px', fontWeight: 600 }}>{l.item_code}</td>
                      <td style={{ padding: '10px' }}>
                        <span className="meta-label-icon" aria-hidden="true">{getProductIcon(l.item_description || l.item_code)}</span>{' '}
                        {l.item_description || '-'}
                      </td>
                      <td style={{ padding: '10px', fontWeight: 700, color: 'var(--color-primary)' }}>
                        {l.quoted_qty} {l.uom_code}
                      </td>
                      <td style={{ padding: '10px', fontWeight: 700, color: '#10b981' }}>
                        {l.required_qty} {l.uom_code}
                      </td>
                      <td style={{ padding: '10px' }}>{l.unit_price}</td>
                      <td style={{ padding: '10px' }}>{l.discount_percent}%</td>
                      <td style={{ padding: '10px' }}>{l.warehouse_code || defaultWarehouse || '-'}</td>
                      <td style={{ padding: '10px' }}>{l.location_code || defaultLocation || '-'}</td>
                      <td style={{ padding: '10px' }}>{l.costing_code2 || l.costing_code || defaultCostCenter || '-'}</td>
                      <td style={{ padding: '10px', fontWeight: 600 }}>
                        {lt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. 🔍 SAP Verification & 5. 🛠️ Developer Details */}
      <div
        className="card-panel"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          background: 'var(--color-bg-secondary, var(--color-bg))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🔍</span> {t('purchaseQuotation.sapVerification')}
          </h3>
          <button
            type="button"
            className="app-button app-button--secondary app-button--compact"
            onClick={handlePreviewPayload}
            disabled={verifyingPayload}
          >
            {verifyingPayload ? t('common.loading') : `⚡ ${t('purchaseQuotation.verifyWithSap')}`}
          </button>
        </div>

        {postingPreview ? (
          postingPreview.ready && (!postingPreview.sap_verification || postingPreview.sap_verification.verified !== false) ? (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: '8px',
                background: postingPreview.sap_verification?.verified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(37, 99, 235, 0.08)',
                border: postingPreview.sap_verification?.verified ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(37, 99, 235, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{postingPreview.sap_verification?.verified ? '✅' : 'ℹ️'}</span>
              <div>
                <div style={{ fontWeight: 700, color: postingPreview.sap_verification?.verified ? '#10b981' : 'var(--color-primary)', fontSize: '0.95rem' }}>
                  {postingPreview.sap_verification?.verified
                    ? t('purchaseQuotation.sapVerificationSuccess')
                    : t('purchaseQuotation.readyToPost')}
                </div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {t('purchaseQuotation.readyToPostDesc')}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, color: '#ef4444', fontSize: '0.95rem' }}>
                  {lang === 'ar' ? 'تنبيه التحقق من المستند' : 'Document Verification Issue'}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#ef4444', marginTop: '3px' }}>
                  {postingPreview.sap_verification?.error?.message?.value ||
                    postingPreview.sap_verification?.error?.message ||
                    postingPreview.validation?.message ||
                    (lang === 'ar' ? 'واجه التحقق مشكلة، يرجى مراجعة البيانات.' : 'Validation issues detected.')}
                </div>
              </div>
            </div>
          )
        ) : (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: '8px',
              background: 'rgba(37, 99, 235, 0.08)',
              border: '1px solid rgba(37, 99, 235, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>ℹ️</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.95rem' }}>
                {t('purchaseQuotation.readyToPost')}
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                {t('purchaseQuotation.clickVerifyPrompt')}
              </div>
            </div>
          </div>
        )}

        {/* 5. 🛠️ Developer / Technical Details (Collapsed by default) */}
        <details
          style={{
            marginTop: '16px',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '10px 14px',
            background: 'var(--color-bg)',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              userSelect: 'none',
            }}
          >
            🛠️ {t('purchaseQuotation.developerDetails')}
          </summary>
          <div style={{ marginTop: '12px' }}>
            {postingPreview ? (
              <pre
                style={{
                  direction: 'ltr',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'var(--color-bg-secondary, rgba(0,0,0,0.03))',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  overflowX: 'auto',
                  maxHeight: '260px',
                  margin: 0,
                }}
              >
                {JSON.stringify(postingPreview.payload, null, 2)}
              </pre>
            ) : (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                {lang === 'ar'
                  ? 'اضغط على "معاينة التحقق" أعلاه لتوليد ومعاينة بيانات المستند بصيغة JSON.'
                  : 'Click "Preview Verification" above to preview the document data in JSON format.'}
              </p>
            )}
          </div>
        </details>
      </div>

      {/* Cancel Option */}
      {canAdministerQuotation && canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '12px' }}>
          <button
            type="button"
            className="app-button app-button--secondary app-button--compact"
            style={{ color: '#ef4444', borderColor: '#ef4444' }}
            onClick={handleCancel}
            disabled={cancelling}
          >
            ✕ {t('purchaseQuotation.cancelQuotation')}
          </button>
        </div>
      )}

      {renderWizardNav(8)}
    </section>
  );

  // Posted Summary View
  const renderPostedSummary = () => (
    <section className="card-panel quality-wizard-card--wide grpo-draft-card">
      <div
        style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '2rem' }}>✅</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#10b981' }}>
              {t('purchaseQuotation.postSuccess')}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              {t('purchaseQuotation.reviewLogDesc')}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="app-button app-button--secondary"
          onClick={() => navigate('/shipping-delivery')}
        >
          {lang === 'ar' ? '← العودة إلى الشحن والتسليم' : '← Back to Shipping & Delivery'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '14px',
          marginBottom: '24px',
        }}
      >
        <div className="card-panel" style={{ padding: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span className="meta-label-icon" aria-hidden="true">🔢</span>
            {t('purchaseQuotation.sapDocNum')}
          </span>
          <h2 style={{ margin: '6px 0 0', color: 'var(--color-primary)' }}>{draft?.sap_doc_num || '-'}</h2>
        </div>

        <div className="card-panel" style={{ padding: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span className="meta-label-icon" aria-hidden="true">🔢</span>
            {lang === 'ar' ? 'رقم المرجع' : 'Reference Number'}
          </span>
          <h2 style={{ margin: '6px 0 0' }}>{draft?.sap_doc_entry || '-'}</h2>
        </div>

        <div className="card-panel" style={{ padding: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span className="meta-label-icon" aria-hidden="true">👤</span>
            {t('purchaseQuotation.postedBy')}
          </span>
          <h2 style={{ margin: '6px 0 0', fontSize: '1.1rem' }}>{draft?.posted_by || '-'}</h2>
        </div>

        <div className="card-panel" style={{ padding: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span className="meta-label-icon" aria-hidden="true">💰</span>
            {t('purchaseQuotation.totalPaymentDue')}
          </span>
          <h2 style={{ margin: '6px 0 0', color: '#10b981' }}>
            {Number(draft?.total_payment_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {draft?.currency || 'EGP'}
          </h2>
        </div>
      </div>

      {/* Review details */}
      {renderReviewStep()}
    </section>
  );

  const renderCurrentStep = () => {
    if (isPosted || postedViewOnly) return renderPostedSummary();
    switch (activeStep) {
      case 0:
        return renderVehicleStep();
      case 1:
        return renderVendorStep();
      case 2:
        return renderHeaderStep();
      case 3:
        return renderItemGroupStep();
      case 4:
        return renderItemStep();
      case 5:
        return renderItemDetailsStep();
      case 6:
        return renderLogisticsStep();
      case 7:
        return renderFinancialStep();
      case 8:
      default:
        return renderReviewStep();
    }
  };

  if (loading) {
    return (
      <div className="page-shell page-shell--center">
        <CircularProgress size={30} />
      </div>
    );
  }

  return (
    <div className="page-shell quality-wizard grpo-page grpo-draft-page">
      <header className="page-header grpo-wizard-page-header">
        <div>
          <span className="section-kicker">
            {t('shippingDelivery.title')} · {t('purchaseQuotation.docTitle')}
          </span>
          <h1 className="page-title">
            {postedViewOnly || isPosted
              ? `${t('purchaseQuotation.docTitle')} (${lang === 'ar' ? 'المرجع' : 'Reference'}: ${draft?.sap_doc_num || draft?.sap_doc_entry || draftId})`
              : `${t('purchaseQuotation.docTitle')} #${draftId}`}
          </h1>
        </div>
        <div className="grpo-header-actions">
          <span className={`rr-status-badge rr-status-badge--${draft?.status}`}>
            {t(`purchaseQuotation.status_${draft?.status}`)}
          </span>
          {!postedViewOnly && !isPosted && (
            <button
              type="button"
              className="app-button app-button--secondary qrev-header-button"
              onClick={loadDraftData}
              disabled={saving || approving || posting || loading}
            >
              {t('common.refresh')}
            </button>
          )}
          <button
            type="button"
            className="app-button app-button--secondary qrev-header-button"
            onClick={() => navigate('/shipping-delivery')}
          >
            {t('common.back')}
          </button>
        </div>
      </header>

      {/* Stepper */}
      <div className="quality-stepper grpo-stepper">
        <Stepper activeStep={activeStep} alternativeLabel nonLinear className="quality-mui-stepper">
          {STEPS.map(({ id, labelKey, icon }, index) => {
            const canClick = index <= maxReachedStep || isPosted;
            return (
              <Step key={id} completed={index < activeStep || isPosted}>
                <StepButton disabled={!canClick} onClick={() => goToStep(index)}>
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
    </div>
  );
}

export default PurchaseQuotationDraftPage;
