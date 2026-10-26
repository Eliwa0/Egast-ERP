import useWorkflowPagination from '../hooks/useWorkflowPagination';
import WorkflowPagination from '../components/ui/WorkflowPagination';
import SearchableSelect from '../components/ui/SearchableSelect';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import { Printer, RefreshCw, Eye, X, Truck, Package, FileText, CheckCircle2 } from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { ViewActionButton, PrintActionButton } from '../components/ui/ActionIconButton';
import DeliveryReportPrintable from '../components/print/DeliveryReportPrintable';
import DocumentTraceabilityChain from '../components/customization/DocumentTraceabilityChain';
import {
  fetchDeliveryReviewReport,
  fetchDeliveryReportPrint,
  fetchCustomizationDrafts,
} from '../services/customizationDeliveryService';
import {
  openBlankPrintWindow,
  writeDeliveryReportDocument,
  writePrintDocument,
} from '../utils/printDocument';
import '../styles/pages/customization-delivery.css';

const EMPTY_FILTERS = { dateFrom: '', dateTo: '', customer: '', salesOrder: '', item: '' };
const customerKey = (draft) => draft.customer_code || draft.customer_name || '';
const customerLabel = (draft) => draft.customer_name || draft.customer_code || '—';

const EMPTY_REPORT = { summary: { deliveries: 0, quantity: 0, customers: 0, salesOrders: 0, items: 0 },
  details: [], byCustomer: [], byItem: [], bySalesOrder: [], byDate: [] };
const REPORT_SOURCES = Object.fromEntries(['customers', 'salesOrders', 'items'].map(field => [field, {
  endpoint: '/customization-delivery/delivery/report/', params: { field }, collection: 'options', browse: true,
  mapOption: row => ({ value: String(row.key), label: row.label }),
}]));

export default function DeliveryReviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetDelivery = searchParams.get('delivery') || searchParams.get('id');

  const { t, lang } = useI18n();
  const isAr = lang === 'ar';
  const toast = useToast();

  const [drafts, setDrafts] = useState([]);
  const [quotationDrafts, setQuotationDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [report, setReport] = useState(EMPTY_REPORT);
  const paging = useWorkflowPagination('', JSON.stringify([filters, targetDelivery]));
  const { params: pageParams, setInfo: setPageInfo, requestGuard } = paging;
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const loadData = useCallback(async () => {
    const identity = requestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeliveryReviewReport({ ...pageParams, ...filters, ...(targetDelivery ? { document: targetDelivery, offset: 0 } : {}) });
      const deliveries = data.details.map(detail => detail.draft);
      const entries = [...new Set(deliveries.map(draft => draft.sales_order_doc_entry))];
      const quotations = entries.length ? await fetchCustomizationDrafts({ order_entries: entries.join(','), page_size: 50 }) : [];
      if (!requestGuard.isCurrent(identity)) return;
      setReport(data);
      setDrafts(deliveries);
      setPageInfo(data.pagination);
      setQuotationDrafts(quotations || []);
    } catch (err) {
      if (!requestGuard.isCurrent(identity)) return;
      const message = err.response?.data?.error || t('common.errorLoadingData');
      setError(message);
      toast.error(message);
    } finally {
      if (requestGuard.isCurrent(identity)) setLoading(false);
    }
  }, [t, toast, pageParams, setPageInfo, targetDelivery, filters, requestGuard]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Mapping from Sales Order Number to Base Quotation Number
  const orderToQuotationMap = useMemo(() => {
    const map = new Map();
    (quotationDrafts || []).forEach((q) => {
      if (q.sap_order_doc_num) {
        map.set(String(q.sap_order_doc_num), q.quotation_doc_num || q.id);
      }
    });
    return map;
  }, [quotationDrafts]);

  // Auto-open selected delivery if provided in URL params
  useEffect(() => {
    if (!loading && drafts.length > 0 && targetDelivery) {
      const match = drafts.find(
        (d) =>
          String(d.sap_doc_num) === String(targetDelivery) ||
          String(d.sap_doc_entry) === String(targetDelivery) ||
          String(d.id) === String(targetDelivery)
      );
      if (match) setSelectedDelivery(match);
    }
  }, [drafts, loading, targetDelivery]);

  const filterOptions = useMemo(
    () => ({
      customers: Array.from(new Map(drafts.map((d) => [customerKey(d), customerLabel(d)])).entries()).filter(
        ([key]) => key
      ),
      salesOrders: Array.from(new Set(drafts.map((d) => d.sales_order_doc_num).filter(Boolean))),
      items: Array.from(
        new Map(
          drafts.flatMap((d) =>
            (d.lines || []).map((line) => [line.item_code, line.item_description || line.item_code])
          )
        ).entries()
      ).filter(([key]) => key),
    }),
    [drafts]
  );

  const updateFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  const resetFilters = () => setFilters(EMPTY_FILTERS);
  const hasFilters = Object.values(filters).some(Boolean);

  const printReport = async (deliveryId = null) => {
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked'));
      return;
    }
    try {
      const params = { ...filters, ...(targetDelivery ? { document: targetDelivery } : {}) };
      const [freshReport, rowsHtml] = deliveryId ? [report, null] : await Promise.all([
        fetchDeliveryReviewReport(params), fetchDeliveryReportPrint(params),
      ]);
      setPrintRequest({ deliveryId, printWindow, report: freshReport, rowsHtml, generatedAt: new Date().toLocaleString() });
    } catch (err) {
      printWindow.close();
      toast.error(err.response?.data?.error || t('common.errorLoadingData'));
    }
  };

  const summaryCards = [
    ['deliveries', report.summary.deliveries],
    ['quantity', report.summary.quantity.toLocaleString()],
    ['customers', report.summary.customers],
    ['salesOrders', report.summary.salesOrders],
    ['items', report.summary.items],
  ];

  const filterLabels = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    customer: filterOptions.customers.find(([value]) => value === filters.customer)?.[1] || filters.customer,
    salesOrder: filters.salesOrder ? `#${filters.salesOrder}` : '',
    item: filterOptions.items.find(([value]) => value === filters.item)?.[1] || filters.item,
  };

  useEffect(() => {
    if (!printRequest) return undefined;
    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []).map(sheet => sheet.cloneNode(true));
      if (printRequest.rowsHtml && sheets[0]) {
        const parsed = new DOMParser().parseFromString(printRequest.rowsHtml, 'text/html');
        const bodies = sheets[0].querySelectorAll('.delivery-print-table tbody');
        ['details', 'items'].forEach((part, index) => {
          const body = parsed.querySelector(`[data-report-part="${part}"] tbody`);
          if (body && bodies[index]) bodies[index].replaceWith(body.cloneNode(true));
        });
      }
      const opened = printRequest.deliveryId
        ? writePrintDocument({
            printWindow: printRequest.printWindow,
            title: t('customizationDelivery.deliveryDocument'),
            elements: sheets,
            orientation: 'landscape',
          })
        : writeDeliveryReportDocument({
            printWindow: printRequest.printWindow,
            title: t('customizationDelivery.deliveryReport'),
            element: sheets[0],
          });
      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(t('quality.printWindowBlocked'));
      }
      setPrintRequest(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [printRequest, t, toast]);

  return (
    <div className="page-shell sales-orders-review-page cd-list-page delivery-analytics-report sales-readiness-workflow" style={{ paddingBottom: '32px', minWidth: 0, maxWidth: '100%' }}>
      <PageHeader
        eyebrow={t('customizationDelivery.eyebrow')}
        title={t('customizationDelivery.deliveryReviewTitle')}
        description={t('customizationDelivery.deliveryReviewAnalyticsSubtitle')}
        actions={
          <div className="sales-orders-review__header-actions">
            {!hasFilters && !loading && report.details.length > 0 && (
              <button
                type="button"
                className="app-button app-button--secondary app-button--compact"
                onClick={() => printReport()}
                title={t('customizationDelivery.printReport')}
              >
                <Printer size={16} />
                <span>{t('customizationDelivery.printReport')}</span>
              </button>
            )}
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={loadData}
              disabled={loading}
              title={t('common.refresh')}
            >
              {loading ? <CircularProgress size={16} color="inherit" /> : <RefreshCw size={16} />}
              <span>{t('common.refresh')}</span>
            </button>
          </div>
        }
      />

      {/* Delivery Report Filters */}
      <section className="card-panel delivery-report-filters" style={{ padding: '18px', marginBottom: '18px', minWidth: 0, maxWidth: '100%' }}>
        <h2 style={{ margin: '0 0 14px', fontSize: '1rem', color: 'var(--text)' }}>
          {t('customizationDelivery.reportFilters')}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', minWidth: 0, width: '100%' }}>
          <label className="form-field" style={{ minWidth: 0 }}>
            <span className="form-label">{t('customizationDelivery.dateFrom')}</span>
            <input
              className="app-input"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter('dateFrom', e.target.value)}
            />
          </label>
          <label className="form-field">
            <span className="form-label">{t('customizationDelivery.dateTo')}</span>
            <input
              className="app-input"
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter('dateTo', e.target.value)}
            />
          </label>
          <label className="form-field">
            <span className="form-label">{t('customizationDelivery.customer')}</span>
            <SearchableSelect
              className="app-select"
              value={filters.customer}
              searchSource={REPORT_SOURCES.customers}
              onChange={(e) => updateFilter('customer', e.target.value)}
            >
              <option value="">{t('customizationDelivery.allCustomers')}</option>
              {filterOptions.customers.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SearchableSelect>
          </label>
          <label className="form-field">
            <span className="form-label">{t('customizationDelivery.sourceSalesOrder')}</span>
            <SearchableSelect
              className="app-select"
              value={filters.salesOrder}
              searchSource={REPORT_SOURCES.salesOrders}
              onChange={(e) => updateFilter('salesOrder', e.target.value)}
            >
              <option value="">{t('customizationDelivery.allSalesOrders')}</option>
              {filterOptions.salesOrders.map((value) => (
                <option key={value} value={value}>
                  #{value}
                </option>
              ))}
            </SearchableSelect>
          </label>
          <label className="form-field">
            <span className="form-label">{t('customizationDelivery.item')}</span>
            <SearchableSelect
              className="app-select"
              value={filters.item}
              searchSource={REPORT_SOURCES.items}
              onChange={(e) => updateFilter('item', e.target.value)}
            >
              <option value="">{t('customizationDelivery.allItems')}</option>
              {filterOptions.items.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SearchableSelect>
          </label>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button type="button" className="app-button app-button--secondary" onClick={resetFilters}>
            {t('customizationDelivery.resetFilters')}
          </button>
        </div>
      </section>

      {hasFilters && (
        <div className="delivery-report-applied-filters" aria-hidden="true" style={{ marginBottom: '14px' }}>
          {t('customizationDelivery.appliedFilters')}:{' '}
          {Object.entries(filters)
            .filter(([, value]) => value)
            .map(([key, value]) => `${t(`customizationDelivery.filter_${key}`)}: ${value}`)
            .join(' · ')}
        </div>
      )}

      {error && (
        <div className="cd-error" role="alert" style={{ marginBottom: '16px' }}>
          <span>{error}</span>
          <button type="button" className="app-button app-button--ghost" onClick={loadData}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {loading && drafts.length === 0 ? (
        <LoadingSkeleton rows={5} />
      ) : report.details.length === 0 ? (
        <EmptyState
          icon="📊"
          title={t('customizationDelivery.deliveryReviewEmpty')}
          message={t('customizationDelivery.noMatchingDeliveries')}
        />
      ) : (
        <>
          <div className="card-panel sales-orders-review__results" style={{ padding: '16px', marginBottom: '20px', minWidth: 0, maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--text)' }}>
                {hasFilters ? t('customizationDelivery.filteredDeliveryDetails') : t('customizationDelivery.allPostedDeliveries')}
              </h2>
              <button
                type="button"
                className="app-button app-button--secondary app-button--compact"
                onClick={() => printReport()}
                title={t('customizationDelivery.printReport')}
              >
                <Printer size={15} />
                <span>{t('customizationDelivery.printReport')}</span>
              </button>
            </div>

            {/* Desktop & Tablet Table View */}
            <div className="cd-table-view">
              <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')}>
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: '85px' }}>{t('customizationDelivery.deliveryNumber')}</th>
                      <th style={{ minWidth: '80px' }}>{isAr ? 'أمر البيع الأساسي' : 'Source Sales Order'}</th>
                      <th style={{ minWidth: '75px' }}>{isAr ? 'عرض السعر' : 'Base Quotation'}</th>
                      <th style={{ minWidth: '100px' }}>{t('customizationDelivery.customer')}</th>
                      <th style={{ minWidth: '110px' }}>{t('customizationDelivery.item')}</th>
                      <th style={{ minWidth: '55px', textAlign: 'end' }}>{t('customizationDelivery.deliveredQuantity')}</th>
                      <th style={{ minWidth: '75px' }}>{t('customizationDelivery.deliveryDate')}</th>
                      <th style={{ minWidth: '80px' }}>{isAr ? 'الحالة' : 'Status'}</th>
                      <th style={{ minWidth: '95px' }}>{isAr ? 'سلسلة التتبع' : 'Traceability'}</th>
                      <th className="cd-actions-col">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.details.map(({ id, draft, date, items, quantity }) => {
                      const baseQuotationNum = orderToQuotationMap.get(String(draft.sales_order_doc_num));

                      return (
                        <tr
                          key={id}
                          className="cd-row"
                          onClick={() => setSelectedDelivery(draft)}
                          tabIndex={0}
                          role="link"
                          style={{ cursor: 'pointer' }}
                          aria-label={`Delivery ${draft.sap_doc_num}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setSelectedDelivery(draft);
                            }
                          }}
                        >
                          <td>
                            <div>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary)', fontWeight: 700 }}>
                                <Truck size={15} />
                                <span>#{draft.sap_doc_num}</span>
                              </div>
                              {draft.sap_doc_entry && (
                                <div className="cd-muted" style={{ fontSize: '0.78rem', marginTop: '2px' }}>
                                  DocEntry: {draft.sap_doc_entry}
                                </div>
                              )}
                            </div>
                          </td>

                          <td>
                            <span
                              className="doc-trace-chip doc-trace-chip--clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (draft.sales_order_doc_num) {
                                  navigate(`/customization-delivery/review?order=${draft.sales_order_doc_num}`);
                                }
                              }}
                              title={isAr ? 'فتح أمر البيع في شاشة المراجعة' : 'Open Sales Order in Review'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                color: 'var(--color-primary)',
                                fontWeight: 600,
                                textDecoration: 'underline',
                              }}
                            >
                              <Package size={13} />
                              <span>#{draft.sales_order_doc_num}</span>
                            </span>
                          </td>

                          <td>
                            {baseQuotationNum ? (
                              <span
                                className="doc-trace-chip doc-trace-chip--clickable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/customization-delivery/quotations/review?quotation=${baseQuotationNum}`);
                                }}
                                title={isAr ? 'فتح عرض السعر في شاشة المراجعة' : 'Open Quotation in Review'}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: 'var(--text)',
                                  textDecoration: 'underline',
                                  fontSize: '0.84rem',
                                }}
                              >
                                <FileText size={12} color="var(--text-muted)" />
                                <span>#{baseQuotationNum}</span>
                              </span>
                            ) : (
                              <span className="cd-muted">—</span>
                            )}
                          </td>

                          <td>
                            <div className="cd-customer">{customerLabel(draft)}</div>
                            {draft.customer_code && <div className="cd-muted">{draft.customer_code}</div>}
                          </td>

                          <td style={{ maxWidth: '200px', whiteSpace: 'normal' }}>
                            <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{items}</div>
                            <div className="cd-muted">{draft.lines?.length || 0} {isAr ? 'بند' : 'item(s)'}</div>
                          </td>

                          <td className="cd-strong" style={{ textAlign: 'end', color: 'var(--accent-success, #22c55e)' }}>
                            {Number(quantity).toLocaleString()}
                          </td>

                          <td>{date || '—'}</td>

                          <td>
                            <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={13} />
                              <span>{t('customizationDelivery.deliveryCreated') || (isAr ? 'مرحل في SAP' : 'Posted to SAP')}</span>
                            </span>
                          </td>

                          <td>
                            <DocumentTraceabilityChain
                              quotationNum={baseQuotationNum}
                              orderNum={draft.sales_order_doc_num}
                              deliveryNums={[draft.sap_doc_num]}
                              currentDoc="delivery"
                              variant="inline"
                            />
                          </td>

                          <td className="cd-actions-cell" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <div className="app-action-icon-group">
                              <ViewActionButton
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDelivery(draft);
                                }}
                                title={isAr ? 'عرض تفاصيل التسليم' : 'View Delivery Details'}
                                ariaLabel={isAr ? 'عرض تفاصيل التسليم' : 'View Delivery Details'}
                              />
                              <PrintActionButton
                                onClick={(e) => {
                                  e.stopPropagation();
                                  printReport(id);
                                }}
                                title={t('customizationDelivery.printDelivery')}
                                ariaLabel={t('customizationDelivery.printDelivery')}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile & Narrow Screen Cards View */}
            <div className="cd-cards-view">
              {report.details.map(({ id, draft, date, items, quantity }) => {
                const baseQuotationNum = orderToQuotationMap.get(String(draft.sales_order_doc_num));

                return (
                  <div
                    key={id}
                    className="cd-doc-card"
                    onClick={() => setSelectedDelivery(draft)}
                    tabIndex={0}
                    role="link"
                    aria-label={`Delivery ${draft.sap_doc_num}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setSelectedDelivery(draft);
                      }
                    }}
                  >
                    <div className="cd-doc-card__header">
                      <div className="cd-doc-card__title-wrap">
                        <div className="cd-doc-card__title">
                          <Truck size={16} />
                          <span>#{draft.sap_doc_num}</span>
                        </div>
                        {draft.sap_doc_entry && (
                          <span className="cd-muted">DocEntry: {draft.sap_doc_entry}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={13} />
                          <span>{t('customizationDelivery.deliveryCreated') || (isAr ? 'مرحل في SAP' : 'Posted to SAP')}</span>
                        </span>
                        <span className="cd-muted" style={{ fontSize: '0.75rem' }}>{date || '—'}</span>
                      </div>
                    </div>

                    <div className="cd-doc-card__grid">
                      <div className="cd-doc-card__field">
                        <span className="cd-doc-card__label">{isAr ? 'أمر البيع الأساسي' : 'Source Sales Order'}</span>
                        <div className="cd-doc-card__value">
                          <span
                            className="doc-trace-chip doc-trace-chip--clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (draft.sales_order_doc_num) {
                                navigate(`/customization-delivery/review?order=${draft.sales_order_doc_num}`);
                              }
                            }}
                            title={isAr ? 'فتح أمر البيع في شاشة المراجعة' : 'Open Sales Order in Review'}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: 'var(--color-primary)',
                              fontWeight: 600,
                              textDecoration: 'underline',
                            }}
                          >
                            <Package size={13} />
                            <span>#{draft.sales_order_doc_num}</span>
                          </span>
                        </div>
                      </div>

                      <div className="cd-doc-card__field">
                        <span className="cd-doc-card__label">{isAr ? 'عرض السعر الأساسي' : 'Base Quotation'}</span>
                        <div className="cd-doc-card__value">
                          {baseQuotationNum ? (
                            <span
                              className="doc-trace-chip doc-trace-chip--clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/customization-delivery/quotations/review?quotation=${baseQuotationNum}`);
                              }}
                              title={isAr ? 'فتح عرض السعر في شاشة المراجعة' : 'Open Quotation in Review'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                color: 'var(--text)',
                                textDecoration: 'underline',
                                fontSize: '0.84rem',
                              }}
                            >
                              <FileText size={12} color="var(--text-muted)" />
                              <span>#{baseQuotationNum}</span>
                            </span>
                          ) : (
                            <span className="cd-muted">—</span>
                          )}
                        </div>
                      </div>

                      <div className="cd-doc-card__field">
                        <span className="cd-doc-card__label">{isAr ? 'العميل' : 'Customer'}</span>
                        <div className="cd-doc-card__value">
                          <span className="cd-customer">{customerLabel(draft)}</span>
                          {draft.customer_code && (
                            <span className="cd-muted" style={{ marginInlineStart: '6px' }}>({draft.customer_code})</span>
                          )}
                        </div>
                      </div>

                      <div className="cd-doc-card__field">
                        <span className="cd-doc-card__label">{isAr ? 'البنود' : 'Items'}</span>
                        <div className="cd-doc-card__value">
                          <span>{items}</span>
                          <span className="cd-muted" style={{ marginInlineStart: '6px' }}>
                            ({draft.lines?.length || 0} {isAr ? 'بند' : 'items'})
                          </span>
                        </div>
                      </div>

                      <div className="cd-doc-card__field">
                        <span className="cd-doc-card__label">{isAr ? 'الكمية المسلّمة' : 'Delivered Qty'}</span>
                        <div className="cd-doc-card__value cd-strong" style={{ color: 'var(--accent-success, #22c55e)' }}>
                          {Number(quantity).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="cd-doc-card__trace-row">
                      <DocumentTraceabilityChain
                        quotationNum={baseQuotationNum}
                        orderNum={draft.sales_order_doc_num}
                        deliveryNums={[draft.sap_doc_num]}
                        currentDoc="delivery"
                        variant="inline"
                      />
                    </div>

                    <div className="cd-doc-card__footer">
                      <div className="app-action-icon-group">
                        <ViewActionButton
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDelivery(draft);
                          }}
                          title={isAr ? 'عرض تفاصيل التسليم' : 'View Delivery Details'}
                          ariaLabel={isAr ? 'عرض تفاصيل التسليم' : 'View Delivery Details'}
                        />
                        <PrintActionButton
                          onClick={(e) => {
                            e.stopPropagation();
                            printReport(id);
                          }}
                          title={t('customizationDelivery.printDelivery')}
                          ariaLabel={t('customizationDelivery.printDelivery')}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Analytics Summary Sections */}
          <div className="delivery-report-analytics-sections">
            <section className="card-panel" style={{ padding: '18px', marginBottom: '18px' }}>
              <h2 style={{ margin: '0 0 14px', fontSize: '1rem', color: 'var(--text)' }}>
                {t('customizationDelivery.deliverySummary')}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '12px' }}>
                {summaryCards.map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      padding: '16px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-soft)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {t(`customizationDelivery.summary_${key}`)}
                    </div>
                    <div style={{ color: 'var(--text)', fontSize: '1.5rem', fontWeight: 800, marginTop: '5px' }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {/* STRICTLY READ-ONLY DELIVERY INSPECTION MODAL */}
      {selectedDelivery && (() => {
        const baseQuotationNum = orderToQuotationMap.get(String(selectedDelivery.sales_order_doc_num));
        const lines = selectedDelivery.lines || [];
        const totalDeliveredQty = lines.reduce(
          (sum, l) => sum + (Number(l.delivery_quantity) || 0),
          0
        );
        const totalOrderedQty = lines.reduce(
          (sum, l) => sum + (Number(l.order_quantity) || 0),
          0
        );
        const totalRemainingQty = lines.reduce(
          (sum, l) =>
            sum +
            Math.max(
              0,
              (Number(l.order_quantity) || Number(l.open_quantity_at_draft) || 0) -
                Number(l.delivery_quantity || 0)
            ),
          0
        );

        return (
          <div
            className="modal-backdrop"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: '16px',
            }}
            onClick={() => setSelectedDelivery(null)}
          >
            <div
              className="card-panel customization-detail-modal"
              style={{
                width: 'min(980px, 100%)',
                maxHeight: '92vh',
                overflowY: 'auto',
                padding: '24px',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <Truck size={22} color="var(--primary)" />
                    <h3 style={{ margin: 0, color: 'var(--text-heading)', fontSize: '1.25rem' }}>
                      {isAr
                        ? `مستند تسليم في SAP #${selectedDelivery.sap_doc_num}`
                        : `SAP Delivery Document #${selectedDelivery.sap_doc_num}`}
                    </h3>
                    <span className="badge badge--success">
                      <CheckCircle2 size={13} style={{ marginInlineEnd: '4px' }} />
                      {isAr ? 'مرحل في SAP' : 'Posted to SAP'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>SAP DocEntry: {selectedDelivery.sap_doc_entry || '—'}</span>
                    <span> • {isAr ? 'أمر البيع: ' : 'Sales Order: '}#{selectedDelivery.sales_order_doc_num}</span>
                    {baseQuotationNum && (
                      <span> • {isAr ? 'عرض السعر الأساسي: ' : 'Base Quotation: '}#{baseQuotationNum}</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="app-button app-button--secondary app-button--compact"
                    onClick={() => printReport(selectedDelivery.id)}
                    title={t('customizationDelivery.printDelivery')}
                  >
                    <Printer size={15} />
                    <span style={{ marginInlineStart: '5px' }}>{t('customizationDelivery.printDelivery')}</span>
                  </button>

                  <button
                    type="button"
                    className="app-button app-button--ghost app-button--compact"
                    onClick={() => setSelectedDelivery(null)}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Section B: Source Documents & Traceability Flow */}
              <DocumentTraceabilityChain
                quotationNum={baseQuotationNum}
                orderNum={selectedDelivery.sales_order_doc_num}
                deliveryNums={[selectedDelivery.sap_doc_num]}
                currentDoc="delivery"
                variant="full"
              />

              {/* Section C & A: Customer, Document & Source Details */}
              <div
                style={{
                  background: 'var(--bg-muted, rgba(255,255,255,0.03))',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {/* Customer Prominent Highlight */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '12px',
                    marginBottom: '12px',
                    borderBottom: '1px solid var(--border)',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <div className="cd-muted" style={{ fontSize: '0.8rem' }}>
                      {isAr ? 'العميل' : 'Customer'}
                    </div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-heading)' }}>
                      {selectedDelivery.customer_name || selectedDelivery.customer_code}
                    </div>
                  </div>
                  {selectedDelivery.customer_code && (
                    <span className="badge badge--neutral" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                      {isAr ? 'كود العميل: ' : 'Code: '}{selectedDelivery.customer_code}
                    </span>
                  )}
                </div>

                {/* Document Dates & Sources Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                    fontSize: '0.88rem',
                  }}
                >
                  <div>
                    <span className="cd-muted">{isAr ? 'أمر البيع المرتبط: ' : 'Source Sales Order: '}</span>
                    <strong
                      style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => {
                        if (selectedDelivery.sales_order_doc_num) {
                          navigate(`/customization-delivery/review?order=${selectedDelivery.sales_order_doc_num}`);
                        }
                      }}
                      title={isAr ? 'فتح أمر البيع في شاشة المراجعة' : 'Open Sales Order in Review'}
                    >
                      #{selectedDelivery.sales_order_doc_num}
                    </strong>
                  </div>
                  {baseQuotationNum && (
                    <div>
                      <span className="cd-muted">{isAr ? 'عرض السعر الأساسي: ' : 'Base Quotation: '}</span>
                      <strong
                        style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => {
                          navigate(`/customization-delivery/quotations/review?quotation=${baseQuotationNum}`);
                        }}
                        title={isAr ? 'فتح عرض السعر في شاشة المراجعة' : 'Open Quotation in Review'}
                      >
                        #{baseQuotationNum}
                      </strong>
                    </div>
                  )}
                  <div>
                    <span className="cd-muted">{isAr ? 'تاريخ التسليم: ' : 'Delivery Date: '}</span>
                    <strong>{selectedDelivery.doc_date || selectedDelivery.posted_at?.slice(0, 10) || '—'}</strong>
                  </div>
                  <div>
                    <span className="cd-muted">{isAr ? 'تاريخ الترحيل: ' : 'Posted Date & Time: '}</span>
                    <strong>{selectedDelivery.posted_at?.slice(0, 16).replace('T', ' ') || '—'}</strong>
                  </div>
                  {selectedDelivery.posted_by && (
                    <div>
                      <span className="cd-muted">{isAr ? 'تم الترحيل بواسطة: ' : 'Posted by: '}</span>
                      <strong>{selectedDelivery.posted_by}</strong>
                    </div>
                  )}
                  {selectedDelivery.comments && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span className="cd-muted">{isAr ? 'ملاحظات: ' : 'Comments: '}</span>
                      <span>{selectedDelivery.comments}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section D: Delivery Totals Overview */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                }}
              >
                <div>
                  <div className="cd-muted" style={{ fontSize: '0.8rem' }}>{isAr ? 'عدد بنود المستند' : 'Items Count'}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{lines.length} {isAr ? 'بند' : 'item(s)'}</div>
                </div>
                <div>
                  <div className="cd-muted" style={{ fontSize: '0.8rem' }}>{isAr ? 'الكمية المطلوبة في أمر البيع' : 'Total Ordered Qty'}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{totalOrderedQty.toLocaleString()}</div>
                </div>
                <div>
                  <div className="cd-muted" style={{ fontSize: '0.8rem' }}>{isAr ? 'الكمية المسلّمة في هذا المستند' : 'Delivered in Document'}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-success, #22c55e)' }}>
                    {totalDeliveredQty.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="cd-muted" style={{ fontSize: '0.8rem' }}>{isAr ? 'الكمية المتبقية بعد هذا التسليم' : 'Remaining Open Qty'}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: totalRemainingQty > 0 ? 'var(--color-primary)' : 'var(--text-muted)' }}>
                    {totalRemainingQty.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Lines Table (Read-Only) */}
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', color: 'var(--text-heading)' }}>
                  {isAr ? 'بنود مستند التسليم ومواقع التخزين والتشغيلات' : 'Delivered Items, Warehouses & Batches'}
                </h4>
                <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <table className="cd-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th style={{ minWidth: '120px' }}>{isAr ? 'رمز الصنف' : 'Item Code'}</th>
                        <th style={{ minWidth: '160px' }}>{isAr ? 'الوصف' : 'Description'}</th>
                        <th style={{ width: '70px' }}>{isAr ? 'الوحدة' : 'UOM'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'المطلوب' : 'ORDERED'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'المسلّم' : 'DELIVERED'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'المتبقي' : 'REMAINING'}</th>
                        <th style={{ width: '85px' }}>{isAr ? 'المستودع' : 'Warehouse'}</th>
                        <th style={{ minWidth: '190px' }}>{isAr ? 'تخصيص المخزون (التشغيلات والمواقع)' : 'Stock Allocation (Batches & Bins)'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => {
                        const orderQty = Number(line.order_quantity || 0);
                        const delivQty = Number(line.delivery_quantity || 0);
                        const openQty = Math.max(0, (orderQty || Number(line.open_quantity_at_draft) || 0) - delivQty);
                        const batches = line.batches || [];

                        return (
                          <tr key={line.id || idx}>
                            <td>{idx + 1}</td>
                            <td style={{ fontWeight: 600 }}>{line.item_code}</td>
                            <td>{line.item_description || '—'}</td>
                            <td>{line.uom || '—'}</td>
                            <td style={{ textAlign: 'end', fontWeight: 700 }}>{orderQty.toLocaleString()}</td>
                            <td style={{ textAlign: 'end', fontWeight: 700, color: 'var(--accent-success, #22c55e)' }}>
                              {delivQty.toLocaleString()}
                            </td>
                            <td style={{ textAlign: 'end', fontWeight: 700, color: openQty > 0 ? 'var(--color-primary)' : 'var(--text-muted)' }}>
                              {openQty.toLocaleString()}
                            </td>
                            <td>
                              {line.warehouse_code ? (
                                <span className="badge badge--neutral" style={{ fontSize: '0.75rem' }}>
                                  {line.warehouse_code}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>
                              {batches.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  {batches.map((b) => (
                                    <div
                                      key={b.id || b.batch_number}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        fontSize: '0.78rem',
                                        background: 'var(--bg-soft)',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                      }}
                                    >
                                      <strong>{b.batch_number}</strong>
                                      <span>({b.quantity})</span>
                                      {b.bin_code && (
                                        <span className="cd-muted" style={{ fontSize: '0.72rem' }}>
                                          [{isAr ? 'موقع: ' : 'Bin: '}{b.bin_code}]
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="cd-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '14px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  🔒 {isAr ? 'مستند التسليم في وضع المراجعة (للقراءة فقط).' : 'Delivery document is in read-only review mode.'}
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="app-button app-button--secondary"
                    onClick={() => setSelectedDelivery(null)}
                  >
                    {isAr ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <p className="cd-readonly-note" style={{ marginTop: '16px' }}>
        🔒 {t('customizationDelivery.deliveryReviewReadOnly')}
      </p>

      {printRequest && (
        <div ref={printContainerRef} aria-hidden="true" style={{ display: 'none' }}>
          <DeliveryReportPrintable
            report={{ ...printRequest.report, byItem: printRequest.report.summary.items ? [{ label: '', quantity: 0 }] : [] }}
            filters={filters}
            filterLabels={filterLabels}
            delivery={printRequest.deliveryId ? report.details.find((detail) => detail.id === printRequest.deliveryId) : null}
            generatedAt={printRequest.generatedAt}
            t={t}
          />
        </div>
      )}
      <WorkflowPagination paging={paging} loading={loading} />
    </div>
  );
}
