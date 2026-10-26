import '../styles/pages/sales-readiness.css';
import { isDefinitiveQuotationRejection } from '../utils/quotationPostingRecovery';
import StandardDropdown from '../components/ui/StandardDropdown';
import { customerSearch, salesItemSearch, warehouseSearch } from '../services/masterDataSearch';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  User,
  Layers,
  Building2,
  Tag,
  ClipboardCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  FileText,
  AlertCircle,
  Package,
  RotateCcw,
  Truck,
  Printer,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import SearchableSelect from '../components/ui/SearchableSelect';
import EmptyState from '../components/ui/EmptyState';
import AppSpinner from '../components/ui/AppSpinner';
import SalesDocumentPrintable from '../components/print/SalesDocumentPrintable';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import {
  createSalesQuotation,
  fetchCustomizationDocument,
  fetchQuotationPosting,
  fetchSalesQuotationMetadata,
  fetchSalesQuotationContext,
} from '../services/customizationDeliveryService';
import { loadTaxCodes } from '../services/purchaseGrpoService';
import '../styles/pages/quality-inspection.css';
import { getProductIcon } from '../utils/productIcon';

const WIZARD_STEPS = [
  { id: 'customer', icon: User, labelKey: 'customizationDelivery.wizard.step1Customer' },
  { id: 'items', icon: Layers, labelKey: 'customizationDelivery.wizard.step2Items' },
  { id: 'commercial', icon: Building2, labelKey: 'customizationDelivery.wizard.step3Commercial' },
  { id: 'logistics', icon: Truck, labelKey: 'customizationDelivery.wizard.step4Logistics' },
  { id: 'specs', icon: Tag, labelKey: 'customizationDelivery.wizard.step5Specs' },
  { id: 'review', icon: ClipboardCheck, labelKey: 'customizationDelivery.wizard.step6Review' },
  { id: 'confirm', icon: CheckCircle2, labelKey: 'customizationDelivery.wizard.step7Confirm' },
];

export default function SalesQuotationCreatePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestKey = searchParams.get('posting');
  const { t, lang } = useI18n();
  const toast = useToast();
  const isRtl = lang === 'ar';

  const [step, setStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);

  // Master data
  const [customers, setCustomers] = useState([]);
  const loadingCustomers = false;
  const customerLoadError = ''; 
  const [, setCustomerReloadKey] = useState(0);
  const [itemsList, setItemsList] = useState([]);
  const loadingItems = false;
  const [taxCodes, setTaxCodes] = useState([]);
  const [loadingTaxCodes, setLoadingTaxCodes] = useState(false);
  const [quotationMetadata, setQuotationMetadata] = useState(null);

  // Form State
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const defaultDueDate = useMemo(
    () => new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    []
  );

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [quotationCurrency, setQuotationCurrency] = useState('USD');
  const [docDate, setDocDate] = useState(todayStr);
  const [docDueDate, setDocDueDate] = useState(defaultDueDate);
  const [taxDate, setTaxDate] = useState(todayStr);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [loadingExchangeRate, setLoadingExchangeRate] = useState(false);
  const [comments, setComments] = useState('');
  const [headerFields, setHeaderFields] = useState({
    po_number: '', contract_no: '', lc_number: '', container_count: '', header_uom: '', week_no: '',
    pay_to_code: '', ship_to_code: '', transportation_code: '', shipping_line: '',
    etd: '', eta: '', incoterms: '', pol: '', pod: '', notify: '', dhl: '',
  });

  // Item selector in Step 2
  const [pendingItemCode, setPendingItemCode] = useState('');

  // Line items
  const [lines, setLines] = useState([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [createdResult, setCreatedResult] = useState(null);
  const postingRef = useRef(false);
  const [postingUncertain, setPostingUncertain] = useState(false);
  const checkPosting = useCallback(async () => {
    if (!requestKey || postingRef.current) return;
    setSubmitting(true);
    try {
      const result = await fetchQuotationPosting(requestKey);
      if (result.state === 'CONFIRMED') { setCreatedResult(result); setPostingUncertain(false); setStep(6); }
      else if (result.state === 'VERIFYING') { setPostingUncertain(true); setSubmitError(t('customizationDelivery.checkingPosting')); setStep(6); }
      else if (isDefinitiveQuotationRejection(result)) { setPostingUncertain(false); setSubmitError(result.error); setStep(6); setSearchParams({}, { replace: true }); }
    } catch (error) {
      const rejected = isDefinitiveQuotationRejection(error.response?.data);
      setPostingUncertain(!rejected);
      setSubmitError(error.response?.data?.error || t('customizationDelivery.checkingPosting'));
      setStep(6);
      if (rejected) setSearchParams({}, { replace: true });
    }
    finally { setSubmitting(false); }
  }, [requestKey, t, setSearchParams]);
  useEffect(() => { checkPosting(); }, [checkPosting]);

  // Direct print state for created quotation
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const handlePrintQuotation = async () => {
    if (!createdResult) return;
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Please allow popups for printing.');
      return;
    }
    try {
      const document = await fetchCustomizationDocument(createdResult.quotation_doc_entry);
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
        title: t('customizationDelivery.quotationDocument') || 'Sales Quotation',
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

  // Independent Items and Tax Codes Loader
  useEffect(() => {
    let isMounted = true;
    setLoadingTaxCodes(true);

    loadTaxCodes('sales')
      .then((taxes) => {
        if (isMounted) setTaxCodes(taxes || []);
      })
      .catch((err) => {
        console.error('Error loading tax codes:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingTaxCodes(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const currency = quotationCurrency;
    if (!currency || !docDate) {
      setExchangeRate(null);
      return;
    }
    let active = true;
    setLoadingExchangeRate(true);
    fetchSalesQuotationContext({ currency, date: docDate })
      .then((context) => {
        if (active) setExchangeRate(context?.exchange_rate ?? null);
      })
      .catch(() => {
        if (active) setExchangeRate(null);
      })
      .finally(() => {
        if (active) setLoadingExchangeRate(false);
      });
    return () => { active = false; };
  }, [quotationCurrency, docDate]);

  useEffect(() => {
    let active = true;
    fetchSalesQuotationMetadata()
      .then((metadata) => {
        if (active) setQuotationMetadata(metadata || null);
      })
      .catch((err) => console.error('Error loading SAP quotation metadata:', err));
    return () => {
      active = false;
    };
  }, []);

  // Options for SearchableSelect
  const customerOptions = useMemo(() => {
    return customers.map((c) => ({
      value: c.card_code,
      label: `${c.card_code} - ${c.card_name || c.card_code}${c.currency ? ` (${c.currency})` : ''}`,
      raw: c,
    }));
  }, [customers]);

  const itemOptions = useMemo(() => {
    return itemsList.map((it) => ({
      value: it.item_code,
      label: `${it.item_code} - ${it.item_name || it.item_code}${it.sales_unit ? ` [${it.sales_unit}]` : ''}${it.default_price ? ` - ${it.default_price} ${it.price_currency || selectedCustomer?.currency || ''}` : ''}`,
      raw: it,
    }));
  }, [itemsList, selectedCustomer?.currency]);

  const brandOptions = useMemo(
    () => quotationMetadata?.line_fields?.brand?.options || [],
    [quotationMetadata]
  );

  const metadataOptions = useCallback(
    (group, name) => quotationMetadata?.[group]?.[name]?.options || [],
    [quotationMetadata]
  );

  const customerAddressOptions = useMemo(() => {
    const addresses = selectedCustomer?.addresses || [];
    return {
      billTo: addresses.filter((address) => address.type === 'bo_BillTo').map((address) => ({
        value: address.name,
        label: `${address.name}${address.full_address ? ` — ${address.full_address}` : ''}`,
      })),
      shipTo: addresses.filter((address) => address.type === 'bo_ShipTo').map((address) => ({
        value: address.name,
        label: `${address.name}${address.full_address ? ` — ${address.full_address}` : ''}`,
      })),
    };
  }, [selectedCustomer]);

  const updateHeaderField = (name, value) => {
    setHeaderFields((previous) => ({ ...previous, [name]: value }));
  };

  // Handle Customer Selection & Reload Prices
  const handleCustomerChange = (value) => {
    const val = String(value ?? '');
    const match = customers.find((c) => String(c.card_code) === val);
    setSelectedCustomer(match || null);
    if (match) {
      const sapDueDate = new Date(`${docDate}T12:00:00`);
      sapDueDate.setMonth(sapDueDate.getMonth() + Number(match.payment_terms_additional_months || 0));
      sapDueDate.setDate(sapDueDate.getDate() + Number(match.payment_terms_additional_days || 0));
      setDocDueDate(sapDueDate.toISOString().split('T')[0]);
      setHeaderFields((previous) => ({
        ...previous,
        pay_to_code: match.bill_to_default || '',
        ship_to_code: match.ship_to_default || '',
      }));
      setItemsList([]);
      setPendingItemCode('');
    }
  };

  // Line item handlers
  const handleAddItem = (code) => {
    const itCode = code || pendingItemCode;
    if (!itCode) return;
    const matched = itemsList.find((it) => it.item_code === itCode);
    const newLine = {
      id: Date.now() + Math.random(),
      item_code: itCode,
      item_description: matched?.item_name || itCode,
      uom: matched?.sales_unit || matched?.uom || 'كيلو',
      quantity: 1,
      unit_price: matched?.default_price || 0,
      discount_percent: 0,
      uom_entry: matched?.uom_entry ?? null,
      tax_code: matched?.sales_vat_group || '',
      warehouse_code: matched?.default_warehouse || '',
      u_brand: '',
      u_size: '',
      u_pallets: '',
    };
    setLines((prev) => [...prev, newLine]);
    setPendingItemCode('');
  };

  const handleRemoveLine = (id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleLineChange = (id, field, value) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const updated = { ...line, [field]: value };
        if (field === 'item_code') {
          const matched = itemsList.find((it) => it.item_code === value);
          if (matched) {
            updated.item_description = matched.item_name || value;
            updated.uom = matched.sales_unit || matched.uom || updated.uom;
            updated.uom_entry = matched.uom_entry ?? null;
            updated.tax_code = matched.sales_vat_group || '';
            if (matched.default_price && !updated.unit_price) {
              updated.unit_price = matched.default_price;
            }
          }
        }
        return updated;
      })
    );
  };

  // Grand totals
  const totalQuantity = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
    [lines]
  );

  const totalAmount = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_percent) || 0) / 100)),
        0
      ),
    [lines]
  );

  // Step navigation validations
  const validateStep = (currentStepIdx) => {
    if (currentStepIdx === 0) {
      if (!selectedCustomer) {
        toast.error(
          lang === 'ar'
            ? 'يرجى اختيار العميل للمتابعة'
            : 'Please select a customer to continue'
        );
        return false;
      }
      return true;
    }
    if (currentStepIdx === 1) {
      if (lines.length === 0) {
        toast.error(
          lang === 'ar'
            ? 'يرجى إضافة صنف واحد على الأقل للمتابعة'
            : 'Please add at least one line item to continue'
        );
        return false;
      }
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l.quantity || Number(l.quantity) <= 0) {
          toast.error(
            lang === 'ar'
              ? `الكمية في السطر #${i + 1} يجب أن تكون أكبر من صفر`
              : `Quantity in line #${i + 1} must be positive`
          );
          return false;
        }
      }
      return true;
    }
    return true;
  };

  const goToStep = (targetIdx) => {
    if (targetIdx > step) {
      if (!validateStep(step)) return;
    }
    setStep(targetIdx);
    setMaxReachedStep((prev) => Math.max(prev, targetIdx));
  };

  const nextStep = () => {
    if (!validateStep(step)) return;
    const nextIdx = step + 1;
    setStep(nextIdx);
    setMaxReachedStep((prev) => Math.max(prev, nextIdx));
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  // Final POST to SAP
  const handleCreateQuotation = async () => {
    if (postingRef.current || createdResult || postingUncertain) return;
    if (!validateStep(0) || !validateStep(1)) {
      setStep(0);
      return;
    }

    postingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    goToStep(6);

    try {
      const payload = {
        request_key: requestKey || crypto.randomUUID(),
        customer_code: selectedCustomer.card_code,
        customer_name: selectedCustomer.card_name,
        doc_date: docDate,
        doc_due_date: docDueDate,
        tax_date: taxDate,
        exchange_rate: exchangeRate,
        currency: quotationCurrency,
        payment_group_code: selectedCustomer.payment_group_code,
        sales_person_code: selectedCustomer.sales_person_code,
        comments,
        header_fields: headerFields,
        lines: lines.map((l) => ({
          item_code: l.item_code,
          item_description: l.item_description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price) || 0,
          discount_percent: Number(l.discount_percent) || 0,
          uom_entry: l.uom_entry,
          tax_code: l.tax_code || '',
          warehouse_code: l.warehouse_code || '',
          u_brand: l.u_brand || '',
          u_size: l.u_size || '',
          u_pallets: l.u_pallets || '',
        })),
      };

      if (!requestKey) setSearchParams({ posting: payload.request_key }, { replace: true });
      const result = await createSalesQuotation(payload);
      setCreatedResult(result);
      const qDocNum = result.quotation_doc_num || result.draft?.quotation_doc_num || '';
      toast.success(
        lang === 'ar'
          ? `تم إنشاء عرض السعر #${qDocNum} في SAP Business One بنجاح!`
          : `Sales Quotation #${qDocNum} created in SAP Business One successfully!`
      );
    } catch (err) {
      console.error('Failed to create sales quotation in SAP:', err);
      const uncertain = err.response?.data?.is_ambiguous === true || !err.response;
      setPostingUncertain(uncertain);
      if (!uncertain) setSearchParams({}, { replace: true });
      const msg =
        err.response?.data?.error ||
        err.message ||
        (lang === 'ar' ? 'فشل إنشاء عرض السعر في SAP' : 'Failed to create sales quotation in SAP');
      setSubmitError(uncertain ? `${msg} ${lang === 'ar' ? 'قد يكون SAP أنشأ المستند. تحقق مع المسؤول قبل إعادة المحاولة.' : 'SAP may have created the document. Check with your administrator before retrying.'}` : msg);
      toast.error(msg);
    } finally {
      postingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setSearchParams({}, { replace: true });
    setPostingUncertain(false);
    setSelectedCustomer(null);
    setQuotationCurrency('USD');
    setDocDate(todayStr);
    setDocDueDate(defaultDueDate);
    setTaxDate(todayStr);
    setExchangeRate(null);
    setComments('');
    setHeaderFields({
      po_number: '', contract_no: '', lc_number: '', container_count: '', header_uom: '', week_no: '',
      pay_to_code: '', ship_to_code: '', transportation_code: '', shipping_line: '',
      etd: '', eta: '', incoterms: '', pol: '', pod: '', notify: '', dhl: '',
    });
    setLines([]);
    setCreatedResult(null);
    setSubmitError(null);
    setStep(0);
    setMaxReachedStep(0);
  };

  const ArrowNext = isRtl ? ArrowLeft : ArrowRight;
  const ArrowPrev = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="shipping-delivery-page page-shell sales-readiness-workflow">
      <PageHeader
        eyebrow={lang === 'ar' ? 'المرحلة ١: عروض الأسعار' : 'Layer 1: Sales Quotation'}
        title={lang === 'ar' ? 'إنشاء عرض سعر جديد' : 'Create Sales Quotation'}
        description={
          lang === 'ar'
            ? 'معالج متكامل لإنشاء عروض الأسعار في SAP Business One وبدء دورة التخصيص'
            : 'End-to-end multi-step wizard to create a native Sales Quotation in SAP and initiate the customization workflow'
        }
        actions={
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => navigate('/customization-delivery/quotations')}
          >
            <ArrowPrev size={16} />
            <span style={{ marginInlineStart: '6px' }}>
              {lang === 'ar' ? 'العودة لعروض الأسعار' : 'Back to Quotations'}
            </span>
          </button>
        }
      />

      {/* STEP BAR */}
      <div className="wizard-stepbar-wrap" ref={stepbarRef} style={{ marginBottom: '24px' }}>
        {WIZARD_STEPS.map((s, idx) => {
          const isDone = idx < step || (step === 6 && !!createdResult);
          const isActive = idx === step;
          const canClick = idx <= maxReachedStep && !submitting && !createdResult;
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

      {/* STEP 1: CUSTOMER & DATES */}
      {step === 0 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <User size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ١: العميل والتواريخ' : 'Step 1: Customer & Dates'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'اختر عميل المبيعات وحدد تواريخ المستند وملاحظات العرض.'
              : 'Select the sales customer and specify quotation document dates and header remarks.'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
              gap: '20px',
            }}
          >
            <div>
              <label
                className="form-label"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}
              >
                {lang === 'ar' ? 'العميل *' : 'Customer *'}
              </label>
              {selectedCustomer ? (
                <div
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid var(--primary)',
                    background: 'var(--bg-primary-soft, rgba(59, 130, 246, 0.08))',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-heading)' }}>
                      {selectedCustomer.card_name || selectedCustomer.card_code}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="badge badge--neutral" style={{ fontWeight: 600 }}>{selectedCustomer.card_code}</span>
                      <span>•</span>
                      <span className="badge badge--info">{selectedCustomer.currency || '—'}</span>
                      <span>•</span>
                      <span>{selectedCustomer.price_list_num ? `قائمة أسعار #${selectedCustomer.price_list_num}` : 'قائمة الأسعار ١'}</span>
                      {selectedCustomer.payment_terms_name && (
                        <>
                          <span>•</span>
                          <span title={selectedCustomer.payment_terms_name}>شروط الدفع: {selectedCustomer.payment_terms_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="app-button app-button--secondary app-button--compact"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    {lang === 'ar' ? 'تغيير العميل' : 'Change'}
                  </button>
                </div>
              ) : (
                <SearchableSelect
                  searchSource={customerSearch}
                  onSearchResults={setCustomers}
                  options={customerOptions}
                  loading={loadingCustomers}
                  placeholder={
                    lang === 'ar' ? 'ابحث باسم أو كود العميل...' : 'Search by customer name or code...'
                  }
                  value=""
                  onChange={handleCustomerChange}
                  noOptionsText={customerLoadError
                    ? (lang === 'ar' ? 'تعذر تحميل العملاء من SAP. أعد المحاولة.' : 'Unable to load customers from SAP. Retry.')
                    : (lang === 'ar' ? 'لا يوجد عملاء مطابقون للبحث.' : 'No customers match your search.')}
                  error={Boolean(customerLoadError)}
                  helperText={customerLoadError || undefined}
                />
              )}
              {!selectedCustomer && customerLoadError && (
                <button
                  type="button"
                  className="app-button app-button--secondary app-button--compact"
                  style={{ marginTop: '8px' }}
                  onClick={() => setCustomerReloadKey((value) => value + 1)}
                >
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                </button>
              )}
            </div>

            <div>
              <label
                className="form-label"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}
              >
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
                {lang === 'ar' ? 'تاريخ المستند' : 'Document Date'}
              </label>
              <input type="date" className="app-input" value={taxDate} onChange={(e) => setTaxDate(e.target.value)} />
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                {lang === 'ar' ? 'سعر الصرف من SAP' : 'SAP Exchange Rate'}
              </label>
              <input className="app-input" value={loadingExchangeRate ? (lang === 'ar' ? 'جارٍ التحميل...' : 'Loading...') : (exchangeRate ?? '—')} readOnly />
            </div>

            <div>
              <label
                className="form-label"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}
              >
                {lang === 'ar' ? 'صالح حتى' : 'Valid Until'}
              </label>
              <input
                type="date"
                className="app-input"
                value={docDueDate}
                onChange={(e) => setDocDueDate(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label
                className="form-label"
                style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}
              >
                {lang === 'ar' ? 'ملاحظات العرض / الشروط' : 'Quotation Comments / Terms'}
              </label>
              <textarea
                className="app-input"
                rows={3}
                placeholder={
                  lang === 'ar'
                    ? 'أدخل أي شروط خاصة أو ملاحظات تظهر في عرض السعر...'
                    : 'Enter quotation notes, remarks, or specific terms...'
                }
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </div>
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
              disabled={!selectedCustomer}
              onClick={nextStep}
            >
              <span>{lang === 'ar' ? 'المتابعة للأصناف' : 'Continue to Items'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: ITEMS */}
      {step === 1 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Layers size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٢: الأصناف والكميات والأسعار' : 'Step 2: Items, Quantities & Prices'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'اختر الأصناف وحدد الكميات وسعر الوحدة المشتق من SAP ونسبة الخصم.'
              : 'Select products, set quantities, verified SAP unit price, and discount percentage.'}
          </p>

          {/* Quick Add Bar */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginBottom: '24px',
              padding: '16px',
              borderRadius: '8px',
              background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ flex: '1 1 320px' }}>
              <label
                className="form-label"
                style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
              >
                {lang === 'ar' ? 'البحث عن صنف لإضافته' : 'Search Product to Add'}
              </label>
              <SearchableSelect
                searchSource={{ ...salesItemSearch, params: { price_list: selectedCustomer?.price_list_num || 1 } }}
                onSearchResults={(rows) => setItemsList((previous) => [...new Map([
                  ...previous.filter((row) => row.item_code === pendingItemCode || lines.some((line) => line.item_code === row.item_code)),
                  ...rows].map((row) => [row.item_code, row])).values()])}
                options={itemOptions}
                loading={loadingItems}
                placeholder={
                  lang === 'ar' ? 'اختر صنفاً أو اكتب كوده...' : 'Select item or enter code...'
                }
                value={pendingItemCode}
                onChange={(value) => setPendingItemCode(value)}

              />
            </div>
            <button
              type="button"
              className="app-button app-button--primary"
              disabled={!pendingItemCode}
              onClick={() => handleAddItem()}
            >
              <Plus size={16} />
              <span style={{ marginInlineStart: '6px' }}>
                {lang === 'ar' ? 'إضافة الصنف' : 'Add Item'}
              </span>
            </button>
          </div>

          {/* Items Table / Cards */}
          {lines.length === 0 ? (
            <EmptyState
              title={lang === 'ar' ? 'لم يتم إضافة أصناف بعد' : 'No Items Added Yet'}
              description={
                lang === 'ar'
                  ? 'اختر صنفاً من القائمة أعلاه واضغط على زر إضافة الصنف للبدء'
                  : 'Select an item from the dropdown above and click Add Item to begin'
              }
              actionLabel={lang === 'ar' ? 'إضافة أول صنف' : 'Add First Item'}
              onAction={() => {
                if (itemsList.length > 0) {
                  handleAddItem(itemsList[0].item_code);
                }
              }}
            />
          ) : (
            <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ marginBottom: '20px' }}>
              <table className="cd-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>{lang === 'ar' ? 'الصنف' : 'Item'}</th>
                    <th style={{ width: '130px' }}>{lang === 'ar' ? 'الكمية *' : 'Quantity *'}</th>
                    <th style={{ width: '90px' }}>{lang === 'ar' ? 'الوحدة' : 'Sales UoM'}</th>
                    <th style={{ width: '130px' }}>{lang === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</th>
                    <th style={{ width: '100px' }}>{lang === 'ar' ? 'الخصم %' : 'Discount %'}</th>
                    <th style={{ width: '190px' }}>{lang === 'ar' ? 'كود الضريبة' : 'Tax Code'}</th>
                    <th style={{ width: '130px' }}>{lang === 'ar' ? 'الإجمالي' : 'Line Total'}</th>
                    <th style={{ width: '60px', textAlign: 'center' }}>
                      {lang === 'ar' ? 'حذف' : 'Del'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={line.id}>
                      <td style={{ fontWeight: 700 }}>{idx + 1}</td>
                      <td>
                        <strong style={{ color: 'var(--text-heading)' }}>
                          <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.item_description || line.item_code)}</span>{' '}
                          {line.item_description}
                        </strong>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--primary)' }}>
                          {line.item_code}
                        </div>
                        <SearchableSelect searchSource={warehouseSearch} value={line.warehouse_code}
                          aria-label={t('customizationDelivery.columns.warehouse')}
                          selectedLabel={line.warehouse_code}
                          onChange={(event) => handleLineChange(line.id, 'warehouse_code', event.target.value)} />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          className="app-input"
                          style={{ padding: '6px 8px' }}
                          value={line.quantity}
                          onChange={(e) => handleLineChange(line.id, 'quantity', e.target.value)}
                        />
                      </td>
                      <td>
                        <span className="badge badge--neutral">{line.uom}</span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="app-input"
                          style={{ padding: '6px 8px' }}
                          value={line.unit_price}
                          onChange={(e) => handleLineChange(line.id, 'unit_price', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="app-input"
                          style={{ padding: '6px 8px' }}
                          value={line.discount_percent}
                          onChange={(e) => handleLineChange(line.id, 'discount_percent', e.target.value)}
                        />
                      </td>
                      <td>
                        <SearchableSelect
                          options={taxCodes}
                          loading={loadingTaxCodes}
                          dense
                          value={line.tax_code || ''}
                          placeholder={lang === 'ar' ? 'اختر كود الضريبة...' : 'Select SAP tax code...'}
                          onChange={(value) => handleLineChange(line.id, 'tax_code', value)}
                        />
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {((Number(line.quantity || 0) * Number(line.unit_price || 0)) * (1 - (Number(line.discount_percent) || 0) / 100)).toFixed(2)}{' '}
                        {quotationCurrency}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="app-button app-button--danger app-button--compact"
                          onClick={() => handleRemoveLine(line.id)}
                          title={lang === 'ar' ? 'حذف البند' : 'Remove line'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Running Grand Total Bar */}
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
              marginTop: '16px',
            }}
          >
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {lang === 'ar' ? 'عدد البنود: ' : 'Total Items: '}
                </span>
                <strong>{lines.length}</strong>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', height: '20px' }} />
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {lang === 'ar' ? 'إجمالي الكميات: ' : 'Total Units: '}
                </span>
                <strong style={{ color: 'var(--text-heading)' }}>{totalQuantity}</strong>
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {lang === 'ar' ? 'إجمالي القيمة: ' : 'Grand Total: '}
              </span>
              <strong style={{ fontSize: '1.2rem', color: 'var(--success)' }}>
                {quotationCurrency} {totalAmount.toFixed(2)}
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
              disabled={lines.length === 0}
              onClick={nextStep}
            >
              <span>{lang === 'ar' ? 'المتابعة للبيانات التجارية' : 'Continue to Commercial Header'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 3: COMMERCIAL / HEADER */}
      {step === 2 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Building2 size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar'
                ? 'الخطوة ٣: بيانات رأس المستند التجارية'
                : 'Step 3: Commercial Header Details'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
            {lang === 'ar'
              ? 'أدخل بيانات العقود وأوامر الشراء والحاويات الخاصة برأس عرض السعر.'
              : 'Enter contract, PO number, LC, and container header fields.'}
          </p>

          {/* Commercial Context Bar */}
          <div
            style={{
              padding: '14px 18px',
              borderRadius: '8px',
              background: 'var(--bg-primary-soft, rgba(59, 130, 246, 0.08))',
              border: '1px solid var(--primary)',
              marginBottom: '20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '12px',
              fontSize: '0.88rem',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{lang === 'ar' ? 'العميل: ' : 'Customer: '}</span>
              <strong style={{ color: 'var(--text-heading)' }}>{selectedCustomer?.card_name}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedCustomer?.card_code}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{lang === 'ar' ? 'عملة العرض: ' : 'Quotation Currency: '}</span>
              <strong className="badge badge--info">{quotationCurrency}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{lang === 'ar' ? 'قائمة الأسعار: ' : 'Price List: '}</span>
              <strong>{selectedCustomer?.price_list_num != null ? `Price List #${selectedCustomer.price_list_num}` : '—'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>{lang === 'ar' ? 'شروط الدفع: ' : 'Payment Terms: '}</span>
              <strong title={selectedCustomer?.payment_terms_name || ''}>{selectedCustomer?.payment_terms_name || 'SAP Default'}</strong>
            </div>
          </div>

          <div style={{ padding: '20px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px' }}>
              <div>
                <label className="form-label">{lang === 'ar' ? 'رقم العقد' : 'Contract No.'}</label>
                <input className="app-input" maxLength={quotationMetadata?.header_fields?.contract_no?.max_length || 50} value={headerFields.contract_no} onChange={(e) => updateHeaderField('contract_no', e.target.value)} />
              </div>
              <div>
                <label className="form-label">{lang === 'ar' ? 'رقم أمر الشراء' : 'PO Number'}</label>
                <input className="app-input" value={headerFields.po_number} onChange={(e) => updateHeaderField('po_number', e.target.value)} />
              </div>
              <div>
                <label className="form-label">{lang === 'ar' ? 'رقم الاعتماد' : 'LC Number'}</label>
                <input className="app-input" maxLength={quotationMetadata?.header_fields?.lc_number?.max_length || 20} value={headerFields.lc_number} onChange={(e) => updateHeaderField('lc_number', e.target.value)} />
              </div>
              <div>
                <label className="form-label">{lang === 'ar' ? 'إجمالي عدد الحاويات' : 'Container Count'}</label>
                <input className="app-input" maxLength={quotationMetadata?.header_fields?.container_count?.max_length || 50} value={headerFields.container_count} onChange={(e) => updateHeaderField('container_count', e.target.value)} />
              </div>
              <div>
                <label className="form-label">{lang === 'ar' ? 'وحدة القياس الرئيسية' : 'Header UOM'}</label>
                <StandardDropdown options={metadataOptions('header_fields', 'header_uom')} value={headerFields.header_uom} onChange={(value) => updateHeaderField('header_uom', value)} placeholder={lang === 'ar' ? 'اختياري من SAP' : 'Optional from SAP'} />
              </div>
              <div>
                <label className="form-label">{lang === 'ar' ? 'رقم الأسبوع' : 'Week No.'}</label>
                <input type="number" min="1" max="53" className="app-input" value={headerFields.week_no} onChange={(e) => updateHeaderField('week_no', e.target.value)} />
              </div>
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
              <span>{lang === 'ar' ? 'المتابعة للخدمات اللوجستية' : 'Continue to Logistics'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 4: LOGISTICS */}
      {step === 3 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Truck size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٤: الخدمات اللوجستية' : 'Step 4: Logistics'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar' ? 'بيانات العميل وعناوين SAP وخيارات الشحن المعرفة في SAP.' : 'SAP customer addresses and SAP-configured shipping details.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px' }}>
            <div>
              <label className="form-label">{lang === 'ar' ? 'المشتري' : 'Buyer'}</label>
              <input className="app-input" value={selectedCustomer?.card_name || ''} readOnly />
            </div>
            <div>
              <label className="form-label">{lang === 'ar' ? 'عنوان المشتري' : 'Buyer Address'}</label>
              <SearchableSelect options={customerAddressOptions.billTo} value={headerFields.pay_to_code} onChange={(value) => updateHeaderField('pay_to_code', value)} placeholder={lang === 'ar' ? 'اختر عنوان الفاتورة من SAP' : 'Select SAP bill-to address'} />
            </div>
            <div>
              <label className="form-label">{lang === 'ar' ? 'المرسل إليه' : 'Consignee'}</label>
              <input className="app-input" value={selectedCustomer?.card_name || ''} readOnly />
            </div>
            <div>
              <label className="form-label">{lang === 'ar' ? 'عنوان المرسل إليه' : 'Consignee Address'}</label>
              <SearchableSelect options={customerAddressOptions.shipTo} value={headerFields.ship_to_code} onChange={(value) => updateHeaderField('ship_to_code', value)} placeholder={lang === 'ar' ? 'اختر عنوان الشحن من SAP' : 'Select SAP ship-to address'} />
            </div>
            <div>
              <label className="form-label">{lang === 'ar' ? 'نوع الشحن' : 'Shipping Type'}</label>
              <StandardDropdown options={quotationMetadata?.system_fields?.shipping_types || []} value={headerFields.transportation_code} onChange={(value) => updateHeaderField('transportation_code', value)} placeholder={lang === 'ar' ? 'اختياري من SAP' : 'Optional from SAP'} />
            </div>
            <div>
              <label className="form-label">{lang === 'ar' ? 'خط الشحن' : 'Shipping Line'}</label>
              <SearchableSelect options={metadataOptions('header_fields', 'shipping_line')} value={headerFields.shipping_line} onChange={(value) => updateHeaderField('shipping_line', value)} placeholder={lang === 'ar' ? 'اختياري من SAP' : 'Optional from SAP'} />
            </div>
            <div><label className="form-label">ETD</label><input type="date" className="app-input" value={headerFields.etd} onChange={(e) => updateHeaderField('etd', e.target.value)} /></div>
            <div><label className="form-label">ETA</label><input type="date" className="app-input" value={headerFields.eta} onChange={(e) => updateHeaderField('eta', e.target.value)} /></div>
            <div>
              <label className="form-label">{lang === 'ar' ? 'شروط التسليم (Incoterms)' : 'Incoterms'}</label>
              <StandardDropdown options={metadataOptions('header_fields', 'incoterms')} value={headerFields.incoterms} onChange={(value) => updateHeaderField('incoterms', value)} placeholder={lang === 'ar' ? 'اختياري من SAP' : 'Optional from SAP'} />
            </div>
            <div>
              <label className="form-label">POL</label>
              <SearchableSelect options={metadataOptions('header_fields', 'pol')} value={headerFields.pol} onChange={(value) => updateHeaderField('pol', value)} placeholder={lang === 'ar' ? 'ميناء الشحن من SAP' : 'SAP port of loading'} />
            </div>
            <div>
              <label className="form-label">POD</label>
              <SearchableSelect options={metadataOptions('header_fields', 'pod')} value={headerFields.pod} onChange={(value) => updateHeaderField('pod', value)} placeholder={lang === 'ar' ? 'ميناء التفريغ من SAP' : 'SAP port of discharge'} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Notify</label>
              <textarea className="app-input" rows={2} maxLength={quotationMetadata?.header_fields?.notify?.max_length || 254} value={headerFields.notify} onChange={(e) => updateHeaderField('notify', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">DHL</label>
              <textarea className="app-input" rows={2} maxLength={quotationMetadata?.header_fields?.dhl?.max_length || 254} value={headerFields.dhl} onChange={(e) => updateHeaderField('dhl', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '28px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
            <button type="button" className="app-button app-button--secondary" onClick={prevStep}><ArrowPrev size={16} /><span style={{ marginInlineStart: '6px' }}>{lang === 'ar' ? 'السابق' : 'Back'}</span></button>
            <button type="button" className="app-button app-button--primary" onClick={nextStep}><span>{lang === 'ar' ? 'المتابعة للتخصيص' : 'Continue to Customization'}</span><ArrowNext size={16} style={{ marginInlineStart: '6px' }} /></button>
          </div>
        </section>
      )}

      {/* STEP 5: CUSTOMIZATION */}
      {step === 4 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Tag size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar'
                ? 'الخطوة ٥: التخصيص والمواصفات'
                : 'Step 5: Customization & Specifications'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'حدد العلامة التجارية والمقاس وعدد البالتات لكل صنف في عرض السعر.'
              : 'Specify Brand, Size/Grade, and Pallets for each quotation line item.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {lines.map((line, idx) => (
              <div
                key={line.id}
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '12px' }}>
                  #{idx + 1} <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.item_description || line.item_code)}</span> {line.item_description} ({line.item_code})
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                    gap: '14px',
                  }}
                >
                  <div>
                    <label
                      style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}
                    >
                      {lang === 'ar' ? 'العلامة التجارية (Brand)' : 'Brand'}
                    </label>
                    <SearchableSelect
                      options={brandOptions}
                      placeholder={lang === 'ar' ? '-- اختياري من SAP --' : '-- Optional from SAP --'}
                      value={line.u_brand}
                      onChange={(value) => handleLineChange(line.id, 'u_brand', value)}
                    />
                  </div>

                  <div>
                    <label
                      style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}
                    >
                      {lang === 'ar' ? 'المقاس / الفرز (Size / Grade)' : 'Size / Grade'}
                    </label>
                    <input
                      type="text"
                      className="app-input"
                      maxLength={quotationMetadata?.line_fields?.size?.max_length || 50}
                      placeholder="e.g. 48 / 56 / Grade A"
                      value={line.u_size}
                      onChange={(e) => handleLineChange(line.id, 'u_size', e.target.value)}
                    />
                  </div>

                  <div>
                    <label
                      style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}
                    >
                      {lang === 'ar' ? 'عدد البالتات (Pallets)' : 'Pallets'}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={quotationMetadata?.line_fields?.pallets?.max_length || 5}
                      className="app-input"
                      placeholder="e.g. 10 / 20"
                      value={line.u_pallets}
                      onChange={(e) => handleLineChange(line.id, 'u_pallets', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
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
              <span>{lang === 'ar' ? 'المتابعة للمراجعة والتحقق' : 'Continue to Review'}</span>
              <ArrowNext size={16} style={{ marginInlineStart: '6px' }} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 6: REVIEW & VALIDATION */}
      {step === 5 && (
        <section className="card-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <ClipboardCheck size={22} color="var(--primary)" />
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'الخطوة ٦: مراجعة عرض السعر والتحقق' : 'Step 6: Review & Validate'}
            </h2>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
            {lang === 'ar'
              ? 'راجع جميع بيانات عرض السعر قبل إرساله والإنشاء الأصلي في SAP Business One.'
              : 'Review all quotation details before posting to SAP Business One Service Layer.'}
          </p>

          {/* Customer Summary Card */}
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-heading)' }}>
                {lang === 'ar' ? 'بيانات العميل والسياق التجاري (SAP)' : 'Customer & SAP Commercial Context'}
              </h3>
              <button
                type="button"
                className="app-button app-button--secondary app-button--compact"
                onClick={() => goToStep(0)}
              >
                {lang === 'ar' ? 'تعديل' : 'Edit'}
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '12px',
                fontSize: '0.9rem',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">🏢</span>
                  {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                </span>
                <strong>{selectedCustomer?.card_name}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginInlineStart: '6px' }}>
                  ({selectedCustomer?.card_code})
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">💰</span>
                  {lang === 'ar' ? 'العملة: ' : 'Currency: '}
                </span>
                <strong className="badge badge--info">{quotationCurrency}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">🏷️</span>
                  {lang === 'ar' ? 'قائمة الأسعار: ' : 'Price List: '}
                </span>
                <strong>{selectedCustomer?.price_list_num != null ? `Price List #${selectedCustomer.price_list_num}` : '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">💰</span>
                  {lang === 'ar' ? 'شروط الدفع: ' : 'Payment Terms: '}
                </span>
                <strong title={selectedCustomer?.payment_terms_name || ''}>{selectedCustomer?.payment_terms_name || 'SAP Default'}</strong>
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
                  <span className="meta-label-icon" aria-hidden="true">📅</span>
                  {lang === 'ar' ? 'صالح حتى: ' : 'Valid Until: '}
                </span>
                <strong>{docDueDate}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">📅</span>
                  {lang === 'ar' ? 'تاريخ المستند: ' : 'Document Date: '}
                </span>
                <strong>{taxDate}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                  <span className="meta-label-icon" aria-hidden="true">💰</span>
                  {lang === 'ar' ? 'سعر الصرف: ' : 'Exchange Rate: '}
                </span>
                <strong>{exchangeRate ?? '—'}</strong>
              </div>
              {comments && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                    <span className="meta-label-icon" aria-hidden="true">📝</span>
                    {lang === 'ar' ? 'ملاحظات: ' : 'Remarks: '}
                  </span>
                  <span>{comments}</span>
                </div>
              )}
            </div>
          </div>

          {/* Commercial & Logistics Summary */}
          <div style={{ padding: '18px 20px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-muted, rgba(255, 255, 255, 0.02))', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>{lang === 'ar' ? 'التجاري واللوجستي' : 'Commercial & Logistics'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '10px', fontSize: '0.88rem' }}>
              {[
                ['Contract No.', headerFields.contract_no], ['PO Number', headerFields.po_number], ['LC Number', headerFields.lc_number], ['Week No.', headerFields.week_no],
                ['Containers', headerFields.container_count], ['Header UOM', headerFields.header_uom], ['Buyer Address', headerFields.pay_to_code],
                ['Consignee Address', headerFields.ship_to_code], ['Shipping Type', headerFields.transportation_code], ['Shipping Line', headerFields.shipping_line],
                ['ETD', headerFields.etd], ['ETA', headerFields.eta], ['Incoterms', headerFields.incoterms], ['POL', headerFields.pol], ['POD', headerFields.pod],
                ['Notify', headerFields.notify], ['DHL', headerFields.dhl],
              ].map(([label, value]) => <div key={label}><span style={{ color: 'var(--text-muted)' }}>{label}: </span><strong>{value || '—'}</strong></div>)}
            </div>
          </div>

          {/* Items & Customization Table */}
          <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ marginBottom: '20px' }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>{lang === 'ar' ? 'الصنف' : 'Item'}</th>
                  <th>{lang === 'ar' ? 'الكمية والوحدة' : 'Quantity & UoM'}</th>
                  <th>{lang === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</th>
                  <th>{lang === 'ar' ? 'الخصم' : 'Discount'}</th>
                  <th>{lang === 'ar' ? 'كود الضريبة' : 'Tax Code'}</th>
                  <th>{lang === 'ar' ? 'العلامة التجارية' : 'Brand'}</th>
                  <th>{lang === 'ar' ? 'المقاس / الفرز' : 'Size / Grade'}</th>
                  <th>{lang === 'ar' ? 'البالتات' : 'Pallets'}</th>
                  <th>{lang === 'ar' ? 'الإجمالي' : 'Line Total'}</th>
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
                      {l.quantity} {l.uom}
                    </td>
                    <td>
                      {(Number(l.unit_price) || 0).toFixed(2)} {quotationCurrency}
                    </td>
                    <td>
                      {Number(l.discount_percent) > 0 ? `${l.discount_percent}%` : '—'}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{l.tax_code || '—'}</span>
                    </td>
                    <td>{l.u_brand || '—'}</td>
                    <td>{l.u_size || '—'}</td>
                    <td>{l.u_pallets || '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {((Number(l.quantity || 0) * Number(l.unit_price || 0)) * (1 - (Number(l.discount_percent) || 0) / 100)).toFixed(2)}{' '}
                      {quotationCurrency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Grand Totals */}
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
              marginBottom: '20px',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>
                {lang === 'ar' ? 'إجمالي البنود: ' : 'Lines: '}
              </span>
              <strong>{lines.length}</strong>
              <span style={{ marginInline: '12px' }}>|</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {lang === 'ar' ? 'إجمالي الوحدات: ' : 'Total Units: '}
              </span>
              <strong>{totalQuantity}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>
                {lang === 'ar' ? 'إجمالي القيمة التقديرية: ' : 'Total Estimated Value: '}
              </span>
              <strong style={{ fontSize: '1.25rem', color: 'var(--success)' }}>
                {quotationCurrency} {totalAmount.toFixed(2)}
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
              onClick={handleCreateQuotation}
              disabled={postingUncertain || submitting}
              aria-busy={submitting ? 'true' : 'false'}
              style={{ minWidth: '240px', padding: '12px 20px', fontSize: '1rem' }}
            >
              {submitting ? (
                <>
                  <AppSpinner size="sm" />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar' ? 'جاري إنشاء عرض السعر في SAP...' : 'Creating Sales Quotation in SAP...'}
                  </span>
                </>
              ) : (
                <>
                  <FileText size={18} />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar' ? 'إنشاء عرض السعر' : 'Create Sales Quotation'}
                  </span>
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* STEP 7: CONFIRMATION & DIRECT SAP CREATION */}
      {step === 6 && (
        <section className="card-panel" style={{ padding: '32px 24px', textAlign: 'center' }}>
          {submitting && (
            <div style={{ padding: '40px 16px' }}>
              <AppSpinner size="lg" />
              <h3 style={{ marginTop: '20px', color: 'var(--text-heading)' }}>
                {lang === 'ar'
                  ? 'جاري إنشاء عرض السعر في SAP Business One...'
                  : 'Creating Sales Quotation in SAP Business One...'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {lang === 'ar'
                  ? 'يتم إرسال البيانات مباشرة إلى SAP والحصول على رقم المستند الرسمي.'
                  : 'Posting document directly to SAP Business One and obtaining official DocEntry.'}
              </p>
            </div>
          )}

          {submitError && (
            <div style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--accent-danger, #ef4444)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <AlertCircle size={32} />
              </div>
              <h2 style={{ color: 'var(--text-heading)', marginBottom: '8px' }}>
                {postingUncertain ? t('customizationDelivery.checkingPosting') : (lang === 'ar' ? 'فشل إنشاء عرض السعر في SAP' : 'Failed to Create Sales Quotation in SAP')}
              </h2>
              <div
                className="feedback-message feedback-message--error"
                style={{ marginBottom: '20px', textAlign: 'start' }}
              >
                {submitError}
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                {postingUncertain && <button type="button" className="app-button app-button--primary" onClick={checkPosting} disabled={submitting}>{t('customizationDelivery.checkPosting')}</button>}
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() => { if (!postingUncertain) setSearchParams({}, { replace: true }); setStep(5); }}
                >
                  <ArrowPrev size={16} />
                  <span style={{ marginInlineStart: '6px' }}>
                    {lang === 'ar' ? 'العودة للمراجعة' : 'Back to Review'}
                  </span>
                </button>
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={handleCreateQuotation}
                  disabled={postingUncertain || submitting}
                >
                    <RotateCcw size={16} />
                  <span style={{ marginInlineStart: '6px' }}>
                    {lang === 'ar' ? 'إعادة المحاولة' : 'Try Again'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {createdResult && (
            <div style={{ maxWidth: '640px', margin: '0 auto' }}>
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
                  ? 'تم إنشاء عرض السعر في SAP Business One بنجاح!'
                  : 'Sales Quotation Created in SAP Business One Successfully!'}
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
                      <span className="meta-label-icon" aria-hidden="true">📋</span>
                      {lang === 'ar' ? 'رقم عرض SAP: ' : 'SAP Quotation #: '}
                    </span>
                    <strong style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>
                      #{createdResult.quotation_doc_num || createdResult.draft?.quotation_doc_num || createdResult.quotation_doc_entry}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🔢</span>
                      {lang === 'ar' ? 'DocEntry: ' : 'DocEntry: '}
                    </span>
                    <strong style={{ color: 'var(--text-heading)' }}>
                      {createdResult.quotation_doc_entry || createdResult.draft?.quotation_doc_entry}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">✅</span>
                      {lang === 'ar' ? 'الحالة: ' : 'Status: '}
                    </span>
                    <strong style={{ color: 'var(--accent-success, #22c55e)' }}>
                      {lang === 'ar' ? 'منشأ في SAP • جاهز للطلب' : 'SAP Created • Ready for Order'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🏢</span>
                      {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                    </span>
                    <strong>{createdResult.draft?.customer_name || createdResult.draft?.customer_code || selectedCustomer?.card_name}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">📅</span>
                      {lang === 'ar' ? 'تاريخ العرض: ' : 'Date: '}
                    </span>
                    <strong>{createdResult.draft?.quotation_doc_date || docDate}</strong>
                  </div>
                </div>
                {(createdResult.draft?.lines || []).map((line, idx) => (
                  <div key={line.id || idx} style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                    <strong>
                      <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.item_description || line.item_code)}</span>{' '}
                      {line.item_code} — {line.item_description}
                    </strong>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: '4px' }}>
                      {line.customized_quantity || line.quantity} {line.uom || ''} · {line.customized_unit_price || line.unit_price} {createdResult.draft?.currency || quotationCurrency} · {line.warehouse_code ? `WH: ${line.warehouse_code}` : ''}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: '8px',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  color: 'var(--text)',
                  fontSize: '0.92rem',
                  marginBottom: '24px',
                  textAlign: 'start',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--accent-success, #22c55e)' }}>
                  ✅ {lang === 'ar' ? 'الخطوة التالية المتاحة:' : 'Next Step Available:'}
                </div>
                <div>
                  {lang === 'ar'
                    ? 'تم إنشاء وتوثيق عرض السعر مباشرة في SAP Business One بدون أي معوقات أو انتظار. يمكنك الآن تحويله إلى أمر بيع (Sales Order) فور موافقة العميل مباشرة.'
                    : 'Sales Quotation has been created directly in SAP Business One. It is immediately ready to be converted into an official Sales Order upon customer confirmation.'}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <button type="button" className="app-button app-button--secondary"
                  onClick={() => navigate(`/customization-delivery/quotations/documents/${createdResult.quotation_doc_entry || createdResult.draft?.quotation_doc_entry}`)}>
                  <FileText size={18} />
                  {t('customizationDelivery.workflow.createOrder')}
                </button>
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={handlePrintQuotation}
                  style={{
                    padding: '12px 24px',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Printer size={18} />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar' ? 'طباعة عرض السعر' : 'Print Quotation'}
                  </span>
                </button>
                <button
                  type="button"
                  className="app-button app-button--secondary app-button--large"
                  onClick={() => navigate('/customization-delivery/quotations')}
                  style={{ padding: '12px 24px', fontSize: '0.95rem' }}
                >
                  <FileText size={18} />
                  <span style={{ marginInlineStart: '8px' }}>
                    {lang === 'ar'
                      ? 'متابعة عروض الأسعار ←'
                      : 'Go to Sales Quotations →'}
                  </span>
                </button>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={handleResetForm}
                >
                  <Plus size={16} />
                  <span style={{ marginInlineStart: '6px' }}>
                    {lang === 'ar' ? 'إنشاء عرض سعر آخر' : 'Create Another Quotation'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {printRequest && createdResult && (
        <div ref={printContainerRef} aria-hidden="true" style={{ display: 'none' }}>
          <SalesDocumentPrintable
            document={{
              documentType: 'QUOTATION',
              docNum: printRequest.document.document_number,
              docEntry: printRequest.document.document_entry,
              customerName: printRequest.document.customer_name,
              customerCode: printRequest.document.customer_code,
              docDate: printRequest.document.document_date,
              dueDate: printRequest.document.due_date,
              currency: printRequest.document.currency,
              remarks: printRequest.document.remarks,
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
