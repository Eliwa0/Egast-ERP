import '../styles/pages/sales-readiness.css';
import useWorkflowPagination from '../hooks/useWorkflowPagination';
import WorkflowPagination from '../components/ui/WorkflowPagination';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  RefreshCw,
  Search,
  SlidersHorizontal,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  Eye,
  CreditCard,
  Calendar,
  Layers,
  Building,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import DocumentTraceabilityChain from '../components/customization/DocumentTraceabilityChain';
import {
  fetchCustomizationDrafts,
  fetchWorkflowSalesOrders,
} from '../services/customizationDeliveryService';
import '../styles/pages/customization-delivery.css';

export default function SalesQuotationsReviewPage() {
  const [searchParams] = useSearchParams();
  const targetId = searchParams.get('id');
  const targetQuotation = searchParams.get('quotation') || searchParams.get('order');

  const { t, lang } = useI18n();
  const isAr = lang === 'ar';
  const toast = useToast();

  const [drafts, setDrafts] = useState([]);
  const [deliveryDrafts, setDeliveryDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const paging = useWorkflowPagination(search, JSON.stringify([statusFilter, targetId, targetQuotation]));
  const { params: pageParams, setInfo: setPageInfo, requestGuard } = paging;

  // Read-only quotation inspection modal state
  const [selectedQuotation, setSelectedQuotation] = useState(null);

  const loadData = useCallback(async () => {
    const identity = requestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const quotationData = await fetchCustomizationDrafts({ ...pageParams, status: statusFilter === 'ALL' ? undefined : statusFilter, ...(targetId ? { id: targetId, offset: 0 } : targetQuotation ? { quotation: targetQuotation, offset: 0 } : {}) });
      const ids = quotationData.filter(draft => draft.status === 'ORDER_POSTED').map(draft => draft.id);
      const deliveryData = ids.length ? await fetchWorkflowSalesOrders({ draft_ids: ids.join(','), page_size: 50, filter: 'all' }) : { orders: [] };
      if (!requestGuard.isCurrent(identity)) return;
      setDrafts(quotationData || []);
      setPageInfo(quotationData?.pagination);
      setDeliveryDrafts((deliveryData.orders || []).flatMap(order => (order.posted_deliveries || []).map(delivery => ({
        ...delivery, sales_order_doc_num: order.sales_order_doc_num,
      }))));
    } catch (err) {
      if (!requestGuard.isCurrent(identity)) return;
      console.error('Failed to load sales quotation drafts:', err);
      const msg = err.response?.data?.error || t('common.errorLoadingData');
      setError(msg);
      toast.error(msg);
    } finally {
      if (requestGuard.isCurrent(identity)) setLoading(false);
    }
  }, [t, toast, pageParams, setPageInfo, requestGuard, targetId, targetQuotation, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When navigated with ?id= or ?quotation=, automatically find and open that quotation in Review
  useEffect(() => {
    if (!loading && drafts.length > 0) {
      if (targetId) {
        const match = drafts.find((d) => String(d.id) === String(targetId));
        if (match) setSelectedQuotation(match);
      } else if (targetQuotation) {
        const match = drafts.find(
          (d) =>
            String(d.quotation_doc_num) === String(targetQuotation) ||
            String(d.quotation_doc_entry) === String(targetQuotation) ||
            String(d.id) === String(targetQuotation)
        );
        if (match) setSelectedQuotation(match);
      }
    }
  }, [drafts, loading, targetId, targetQuotation]);

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
  };

  const hasFilters = Boolean(search.trim() || statusFilter !== 'ALL');

  // Filter only local workflow quotations
  const quotationDrafts = useMemo(() => {
    return (drafts || []).filter((d) => d.is_local_creation !== false);
  }, [drafts]);

  // Map of related deliveries by sales order number
  const deliveriesByOrderNum = useMemo(() => {
    const map = new Map();
    (deliveryDrafts || []).forEach((del) => {
      if (del.sales_order_doc_num) {
        const key = String(del.sales_order_doc_num);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(del.sap_doc_num || del.id);
      }
    });
    return map;
  }, [deliveryDrafts]);

  const filteredQuotations = useMemo(() => {
    let result = quotationDrafts;

    if (statusFilter !== 'ALL') {
      if (statusFilter === 'REJECTED') {
        result = result.filter(
          (d) => d.status === 'INTERNAL_REJECTED' || d.status === 'CUSTOMER_REJECTED'
        );
      } else {
        result = result.filter((d) => d.status === statusFilter);
      }
    }

    return result;
  }, [quotationDrafts, statusFilter]);

  const getQuotationStatusBadge = (status) => {
    switch (status) {
      case 'DRAFT':
        return (
          <span className="badge badge--neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <FileText size={13} />
            <span>{isAr ? 'مسودة' : 'Draft'}</span>
          </span>
        );
      case 'PENDING_INTERNAL_REVIEW':
        return (
          <span className="badge badge--warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={13} />
            <span>{isAr ? 'قيد المراجعة الداخلية' : 'Pending Internal Review'}</span>
          </span>
        );
      case 'INTERNAL_APPROVED':
        return (
          <span className="badge badge--info" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} />
            <span>{isAr ? 'معتمد داخلياً' : 'Internally Approved'}</span>
          </span>
        );
      case 'INTERNAL_REJECTED':
        return (
          <span className="badge badge--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={13} />
            <span>{isAr ? 'مرفوض داخلياً' : 'Internally Rejected'}</span>
          </span>
        );
      case 'WAITING_CUSTOMER_APPROVAL':
        return (
          <span className="badge badge--warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={13} />
            <span>{isAr ? 'بانتظار اعتماد العميل' : 'Waiting Customer Approval'}</span>
          </span>
        );
      case 'CUSTOMER_APPROVED':
        return (
          <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} />
            <span>{isAr ? 'معتمد من العميل' : 'Customer Approved'}</span>
          </span>
        );
      case 'CUSTOMER_REJECTED':
        return (
          <span className="badge badge--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={13} />
            <span>{isAr ? 'مرفوض من العميل' : 'Customer Rejected'}</span>
          </span>
        );
      case 'READY_FOR_ORDER':
        return (
          <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} />
            <span>{isAr ? 'جاهز لأمر البيع' : 'Ready for Order'}</span>
          </span>
        );
      case 'ORDER_POSTED':
        return (
          <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} />
            <span>{isAr ? 'تم التحويل لأمر بيع' : 'Converted to Order'}</span>
          </span>
        );
      case 'ORDER_FAILED':
        return (
          <span className="badge badge--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={13} />
            <span>{isAr ? 'فشل التحويل' : 'Order Failed'}</span>
          </span>
        );
      default:
        return <span className="badge badge--neutral">{status || '—'}</span>;
    }
  };

  return (
    <div className="shipping-delivery-page page-shell cd-list-page sales-orders-review-page sales-readiness-workflow" style={{ paddingBottom: '32px' }}>
      <PageHeader
        eyebrow={t('customizationDelivery.salesQuotationsReviewEyebrow')}
        title={t('customizationDelivery.salesQuotationsReviewTitle')}
        description={t('customizationDelivery.salesQuotationsReviewSubtitle')}
        actions={
          <div className="sales-orders-review__header-actions">
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

      {/* Review Toolbar & Filters */}
      <section className="card-panel cd-filters sales-orders-review__filters" aria-label={isAr ? 'فلاتر المراجعة' : 'Review filters'}>
        <div className="sales-orders-review__filters-heading">
          <h2>
            <SlidersHorizontal size={17} aria-hidden="true" />
            {isAr ? 'فلاتر مراجعة عروض الأسعار' : 'Quotation Review Filters'}
          </h2>
          {hasFilters && (
            <button type="button" className="app-button app-button--secondary app-button--compact sales-orders-review__clear" onClick={resetFilters}>
              {isAr ? 'إلغاء الفلتر' : 'Clear Filters'}
            </button>
          )}
        </div>
        <div className="sales-orders-review__filters-grid">
          <label className="form-field sales-orders-review__filter-field sales-orders-review__filter-field--search">
            <span className="form-label">{isAr ? 'بحث' : 'Search'}</span>
            <div className="sales-orders-review__search-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                className="app-input"
                placeholder={isAr ? 'بحث برقم عرض السعر، العميل، الصنف...' : 'Search by quotation #, customer, item...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={loading && drafts.length === 0}
              />
            </div>
          </label>

          <label className="form-field sales-orders-review__filter-field">
            <span className="form-label">{isAr ? 'حالة عرض السعر' : 'Quotation Status'}</span>
            <select
              className="app-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              disabled={loading && drafts.length === 0}
            >
              <option value="ALL">{t('customizationDelivery.allQuotations') || (isAr ? 'كل عروض الأسعار' : 'All Quotations')}</option>
              <option value="PENDING_INTERNAL_REVIEW">{isAr ? 'قيد المراجعة الداخلية' : 'Pending Internal Review'}</option>
              <option value="INTERNAL_APPROVED">{isAr ? 'معتمد داخلياً' : 'Internally Approved'}</option>
              <option value="WAITING_CUSTOMER_APPROVAL">{isAr ? 'بانتظار اعتماد العميل' : 'Waiting Customer Approval'}</option>
              <option value="READY_FOR_ORDER">{isAr ? 'جاهز لأمر البيع' : 'Ready for Order'}</option>
              <option value="ORDER_POSTED">{isAr ? 'تم التحويل لأمر بيع' : 'Converted to Order'}</option>
              <option value="REJECTED">{isAr ? 'مرفوض' : 'Rejected'}</option>
              <option value="DRAFT">{isAr ? 'مسودة' : 'Draft'}</option>
            </select>
          </label>
        </div>
      </section>

      {/* Content Body */}
      {loading && drafts.length === 0 ? (
        <LoadingSkeleton />
      ) : error && drafts.length === 0 ? (
        <section className="card-panel">
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
          <button type="button" className="app-button app-button--primary" onClick={loadData}>
            {t('common.retry')}
          </button>
        </section>
      ) : filteredQuotations.length === 0 ? (
        <EmptyState
          title={t('customizationDelivery.noQuotationsFound') || (isAr ? 'لا توجد عروض أسعار بيع' : 'No Sales Quotations Found')}
          description={
            hasFilters
              ? (t('customizationDelivery.noQuotationsDesc') || (isAr ? 'لا توجد عروض أسعار تطابق الفلاتر المحددة.' : 'No quotation drafts match your selected filters.'))
              : (isAr ? 'لم يتم العثور على أي عروض أسعار مسجلة في دورة العمل.' : 'No sales quotations have been created yet.')
          }
        />
      ) : (
        <div className="card-panel sales-orders-review__results">
          {/* Desktop & Tablet Table View */}
          <div className="cd-table-view">
            <div className="cd-table-wrap sales-orders-review__table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')}>
              <table className="cd-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '100px' }}>{isAr ? 'عرض السعر' : 'Quotation #'}</th>
                    <th style={{ minWidth: '110px' }}>{isAr ? 'العميل' : 'Customer'}</th>
                    <th style={{ minWidth: '120px' }}>{isAr ? 'البنود' : 'Items'}</th>
                    <th style={{ minWidth: '60px', textAlign: 'end' }}>{isAr ? 'الكمية' : 'Qty'}</th>
                    <th style={{ minWidth: '85px', textAlign: 'end' }}>{isAr ? 'الإجمالي' : 'Total'}</th>
                    <th style={{ minWidth: '50px', textAlign: 'center' }}>{isAr ? 'ضريبة' : 'Tax'}</th>
                    <th style={{ minWidth: '75px' }}>{isAr ? 'التاريخ' : 'Date'}</th>
                    <th style={{ minWidth: '85px' }}>{isAr ? 'الحالة' : 'Status'}</th>
                    <th style={{ minWidth: '95px' }}>{isAr ? 'سلسلة التتبع' : 'Traceability'}</th>
                    <th style={{ minWidth: '70px', textAlign: 'center' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotations.map((draft) => {
                    const lines = draft.lines || [];
                    const totalQty = lines.reduce(
                      (sum, l) => sum + Number(l.customized_quantity || l.original_quantity || 0),
                      0
                    );
                    const totalAmount = lines.reduce(
                      (sum, l) =>
                        sum +
                        (Number(l.line_total) ||
                          Number(l.customized_quantity || l.original_quantity || 0) *
                            Number(l.customized_unit_price || l.original_unit_price || 0)),
                      0
                    );
                    const itemsPreview = lines
                      .map((l) => l.item_description || l.item_code)
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('، ');

                    const taxCodes = Array.from(new Set(lines.map((l) => l.tax_code).filter(Boolean))).join(', ');
                    const docDate = draft.quotation_doc_date || draft.created_at?.slice(0, 10) || '—';
                    const relatedDelivs = draft.sap_order_doc_num
                      ? deliveriesByOrderNum.get(String(draft.sap_order_doc_num)) || []
                      : [];

                    return (
                      <tr
                        key={draft.id}
                        className="cd-row"
                        onClick={() => setSelectedQuotation(draft)}
                        tabIndex={0}
                        role="link"
                        style={{ cursor: 'pointer' }}
                        aria-label={`Sales Quotation ${draft.quotation_doc_num || draft.id}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSelectedQuotation(draft);
                          }
                        }}
                      >
                        <td>
                          <div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary)', fontWeight: 700 }}>
                              <FileText size={15} />
                              <span>
                                {isAr
                                  ? `عرض سعر #${draft.quotation_doc_num || draft.id}`
                                  : `Quotation #${draft.quotation_doc_num || draft.id}`}
                              </span>
                            </div>
                            {draft.quotation_doc_entry ? (
                              <div className="cd-muted" style={{ fontSize: '0.78rem', marginTop: '3px' }}>
                                DocEntry: {draft.quotation_doc_entry}
                              </div>
                            ) : (
                              <div className="cd-muted" style={{ fontSize: '0.78rem', marginTop: '3px' }}>
                                Draft ID: #{draft.id}
                              </div>
                            )}
                          </div>
                        </td>

                        <td>
                          <div className="cd-customer">
                            {draft.customer_name || draft.customer_code}
                          </div>
                          {draft.customer_name && draft.customer_code && (
                            <div className="cd-muted">{draft.customer_code}</div>
                          )}
                        </td>

                        <td style={{ maxWidth: '200px', whiteSpace: 'normal' }}>
                          <div style={{ fontWeight: 500, fontSize: '0.88rem' }}>
                            {itemsPreview || '—'}
                            {lines.length > 2 && <span className="cd-muted"> (+{lines.length - 2})</span>}
                          </div>
                          <div className="cd-muted">
                            {lines.length} {isAr ? 'بند' : 'item(s)'}
                          </div>
                        </td>

                        <td className="cd-strong" style={{ textAlign: 'end' }}>
                          {Number(totalQty).toLocaleString()}
                        </td>

                        <td className="cd-strong" style={{ textAlign: 'end', color: 'var(--color-primary)' }}>
                          {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>{draft.currency || 'EGP'}</span>
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          {taxCodes ? (
                            <span className="badge badge--neutral" style={{ fontSize: '0.75rem' }}>{taxCodes}</span>
                          ) : (
                            <span className="cd-muted">—</span>
                          )}
                        </td>

                        <td>
                          <div>{docDate}</div>
                          {draft.quotation_valid_until && (
                            <div className="cd-muted" style={{ fontSize: '0.75rem' }}>
                              {isAr ? 'صلاحية: ' : 'Exp: '}{draft.quotation_valid_until}
                            </div>
                          )}
                        </td>

                        <td>
                          {getQuotationStatusBadge(draft.status)}
                        </td>

                        <td>
                          <DocumentTraceabilityChain
                            quotationNum={draft.quotation_doc_num || draft.id}
                            orderNum={draft.sap_order_doc_num}
                            deliveryNums={relatedDelivs}
                            currentDoc="quotation"
                            variant="inline"
                          />
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="app-button app-button--secondary app-button--compact"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedQuotation(draft);
                            }}
                            title={isAr ? 'معاينة تفاصيل عرض السعر' : 'View Quotation Details'}
                          >
                            <Eye size={14} style={{ marginInlineEnd: '4px' }} />
                            {isAr ? 'عرض' : 'View'}
                          </button>
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
            {filteredQuotations.map((draft) => {
              const lines = draft.lines || [];
              const totalQty = lines.reduce(
                (sum, l) => sum + Number(l.customized_quantity || l.original_quantity || 0),
                0
              );
              const totalAmount = lines.reduce(
                (sum, l) =>
                  sum +
                  (Number(l.line_total) ||
                    Number(l.customized_quantity || l.original_quantity || 0) *
                      Number(l.customized_unit_price || l.original_unit_price || 0)),
                0
              );
              const itemsPreview = lines
                .map((l) => l.item_description || l.item_code)
                .filter(Boolean)
                .slice(0, 2)
                .join('، ');

              const taxCodes = Array.from(new Set(lines.map((l) => l.tax_code).filter(Boolean))).join(', ');
              const docDate = draft.quotation_doc_date || draft.created_at?.slice(0, 10) || '—';
              const relatedDelivs = draft.sap_order_doc_num
                ? deliveriesByOrderNum.get(String(draft.sap_order_doc_num)) || []
                : [];

              return (
                <div
                  key={draft.id}
                  className="cd-doc-card"
                  onClick={() => setSelectedQuotation(draft)}
                  tabIndex={0}
                  role="link"
                  aria-label={`Sales Quotation ${draft.quotation_doc_num || draft.id}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setSelectedQuotation(draft);
                    }
                  }}
                >
                  <div className="cd-doc-card__header">
                    <div className="cd-doc-card__title-wrap">
                      <div className="cd-doc-card__title">
                        <FileText size={16} />
                        <span>
                          {isAr
                            ? `عرض سعر #${draft.quotation_doc_num || draft.id}`
                            : `Quotation #${draft.quotation_doc_num || draft.id}`}
                        </span>
                      </div>
                      {draft.quotation_doc_entry ? (
                        <span className="cd-muted">DocEntry: {draft.quotation_doc_entry}</span>
                      ) : (
                        <span className="cd-muted">Draft ID: #{draft.id}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      {getQuotationStatusBadge(draft.status)}
                      <span className="cd-muted" style={{ fontSize: '0.75rem' }}>{docDate}</span>
                    </div>
                  </div>

                  <div className="cd-doc-card__grid">
                    <div className="cd-doc-card__field">
                      <span className="cd-doc-card__label">{isAr ? 'العميل' : 'Customer'}</span>
                      <div className="cd-doc-card__value">
                        <span className="cd-customer">{draft.customer_name || draft.customer_code}</span>
                        {draft.customer_name && draft.customer_code && (
                          <span className="cd-muted" style={{ marginInlineStart: '6px' }}>({draft.customer_code})</span>
                        )}
                      </div>
                    </div>

                    <div className="cd-doc-card__field">
                      <span className="cd-doc-card__label">{isAr ? 'البنود' : 'Items'}</span>
                      <div className="cd-doc-card__value">
                        <span>{itemsPreview || '—'}</span>
                        {lines.length > 2 && <span className="cd-muted"> (+{lines.length - 2})</span>}
                        <span className="cd-muted" style={{ marginInlineStart: '6px' }}>
                          ({lines.length} {isAr ? 'بند' : 'items'})
                        </span>
                      </div>
                    </div>

                    <div className="cd-doc-card__field">
                      <span className="cd-doc-card__label">{isAr ? 'الكمية الإجمالية' : 'Total Quantity'}</span>
                      <div className="cd-doc-card__value cd-strong">
                        {Number(totalQty).toLocaleString()}
                      </div>
                    </div>

                    <div className="cd-doc-card__field">
                      <span className="cd-doc-card__label">{isAr ? 'الإجمالي والضريبة' : 'Total & Tax'}</span>
                      <div className="cd-doc-card__value cd-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--color-primary)' }}>
                          {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          {draft.currency || 'EGP'}
                        </span>
                        {taxCodes ? (
                          <span className="badge badge--neutral" style={{ fontSize: '0.75rem' }}>{taxCodes}</span>
                        ) : (
                          <span className="cd-muted" style={{ fontSize: '0.75rem' }}>—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="cd-doc-card__trace-row">
                    <DocumentTraceabilityChain
                      quotationNum={draft.quotation_doc_num || draft.id}
                      orderNum={draft.sap_order_doc_num}
                      deliveryNums={relatedDelivs}
                      currentDoc="quotation"
                      variant="inline"
                    />
                  </div>

                  <div className="cd-doc-card__footer">
                    <button
                      type="button"
                      className="app-button app-button--secondary app-button--compact"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedQuotation(draft);
                      }}
                      title={isAr ? 'معاينة تفاصيل عرض السعر' : 'View Quotation Details'}
                    >
                      <Eye size={14} style={{ marginInlineEnd: '4px' }} />
                      {isAr ? 'عرض التفاصيل' : 'View Details'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STRICTLY READ-ONLY QUOTATION INSPECTION MODAL */}
      {selectedQuotation && (
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
          onClick={() => setSelectedQuotation(null)}
        >
          <div
            className="card-panel customization-detail-modal"
            style={{
              width: 'min(960px, 100%)',
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
                  <FileText size={22} color="var(--primary)" />
                  <h3 style={{ margin: 0, color: 'var(--text-heading)', fontSize: '1.25rem' }}>
                    {isAr
                      ? `عرض سعر بيع #${selectedQuotation.quotation_doc_num || selectedQuotation.id}`
                      : `Sales Quotation #${selectedQuotation.quotation_doc_num || selectedQuotation.id}`}
                  </h3>
                  {getQuotationStatusBadge(selectedQuotation.status)}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>SAP DocEntry: {selectedQuotation.quotation_doc_entry || '—'}</span>
                  {selectedQuotation.id && <span> • Internal Draft ID: #{selectedQuotation.id}</span>}
                </div>
              </div>

              <button
                type="button"
                className="app-button app-button--ghost app-button--compact"
                onClick={() => setSelectedQuotation(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Section F: Document Traceability Flow */}
            <DocumentTraceabilityChain
              quotationNum={selectedQuotation.quotation_doc_num || selectedQuotation.id}
              orderNum={selectedQuotation.sap_order_doc_num}
              deliveryNums={
                selectedQuotation.sap_order_doc_num
                  ? deliveriesByOrderNum.get(String(selectedQuotation.sap_order_doc_num)) || []
                  : []
              }
              currentDoc="quotation"
              variant="full"
            />

            {/* Section B & A: Customer & Commercial Details */}
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
                    {selectedQuotation.customer_name || selectedQuotation.customer_code}
                  </div>
                </div>
                {selectedQuotation.customer_code && (
                  <span className="badge badge--neutral" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                    {isAr ? 'كود العميل: ' : 'Code: '}{selectedQuotation.customer_code}
                  </span>
                )}
              </div>

              {/* Commercial & Document Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  fontSize: '0.88rem',
                }}
              >
                <div>
                  <span className="cd-muted">{isAr ? 'تاريخ المستند: ' : 'Document Date: '}</span>
                  <strong>{selectedQuotation.quotation_doc_date || selectedQuotation.created_at?.slice(0, 10) || '—'}</strong>
                </div>
                <div>
                  <span className="cd-muted">{isAr ? 'تاريخ الصلاحية: ' : 'Valid Until: '}</span>
                  <strong>{selectedQuotation.quotation_valid_until || '—'}</strong>
                </div>
                {selectedQuotation.tax_date && (
                  <div>
                    <span className="cd-muted">{isAr ? 'تاريخ الضريبة: ' : 'Tax Date: '}</span>
                    <strong>{selectedQuotation.tax_date}</strong>
                  </div>
                )}
                <div>
                  <span className="cd-muted">{isAr ? 'العملة وسعر الصرف: ' : 'Currency & Rate: '}</span>
                  <strong>{selectedQuotation.currency || 'EGP'}</strong>
                  {selectedQuotation.doc_rate ? <span className="cd-muted"> ({isAr ? 'سعر الصرف: ' : 'Rate: '}{selectedQuotation.doc_rate})</span> : null}
                </div>
                {selectedQuotation.payment_group_code && (
                  <div>
                    <span className="cd-muted">{isAr ? 'شروط الدفع: ' : 'Payment Terms: '}</span>
                    <strong>#{selectedQuotation.payment_group_code}</strong>
                  </div>
                )}
                {selectedQuotation.header_fields?.PriceListNum && (
                  <div>
                    <span className="cd-muted">{isAr ? 'قائمة الأسعار: ' : 'Price List: '}</span>
                    <strong>#{selectedQuotation.header_fields.PriceListNum}</strong>
                  </div>
                )}
                {selectedQuotation.customer_reference_number && (
                  <div>
                    <span className="cd-muted">{isAr ? 'مرجع اعتماد العميل: ' : 'Customer PO / Ref: '}</span>
                    <strong>
                      {selectedQuotation.customer_approval_type_display || selectedQuotation.customer_approval_type}: {selectedQuotation.customer_reference_number}
                    </strong>
                  </div>
                )}
                {selectedQuotation.wrapping && (
                  <div>
                    <span className="cd-muted">{isAr ? 'التغليف / اللف: ' : 'Wrapping: '}</span>
                    <strong>{selectedQuotation.wrapping}</strong>
                  </div>
                )}
                {selectedQuotation.comments && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="cd-muted">{isAr ? 'ملاحظات: ' : 'Comments: '}</span>
                    <span>{selectedQuotation.comments}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Section C: Quotation Totals Tiles */}
            {(() => {
              const qLines = selectedQuotation.lines || [];
              const totalQty = qLines.reduce(
                (sum, l) => sum + Number(l.customized_quantity || l.original_quantity || 0),
                0
              );
              const totalAmount = qLines.reduce(
                (sum, l) =>
                  sum +
                  (Number(l.line_total) ||
                    Number(l.customized_quantity || l.original_quantity || 0) *
                      Number(l.customized_unit_price || l.original_unit_price || 0)),
                0
              );
              const taxCodes = Array.from(new Set(qLines.map((l) => l.tax_code).filter(Boolean))).join(', ');

              return (
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
                    <div className="cd-muted" style={{ fontSize: '0.8rem' }}>
                      {isAr ? 'إجمالي الكمية' : 'Total Quantity'}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-heading)' }}>
                      {totalQty.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="cd-muted" style={{ fontSize: '0.8rem' }}>
                      {isAr ? 'إجمالي القيمة' : 'Total Amount'}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                      {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      <span style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>{selectedQuotation.currency || 'EGP'}</span>
                    </div>
                  </div>
                  <div>
                    <div className="cd-muted" style={{ fontSize: '0.8rem' }}>
                      {isAr ? 'عدد البنود' : 'Line Items'}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                      {qLines.length} {isAr ? 'بند' : 'item(s)'}
                    </div>
                  </div>
                  <div>
                    <div className="cd-muted" style={{ fontSize: '0.8rem' }}>
                      {isAr ? 'أكواد الضريبة' : 'Tax Codes'}
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '4px' }}>
                      {taxCodes ? (
                        <span className="badge badge--neutral">{taxCodes}</span>
                      ) : (
                        <span className="cd-muted">—</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Section D: Lines Table (Read-Only) */}
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', color: 'var(--text-heading)' }}>
                {isAr ? 'بنود عرض السعر' : 'Quotation Line Items'} ({selectedQuotation.lines?.length || 0})
              </h4>
              <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ maxHeight: '280px', overflowY: 'auto' }}>
                <table className="cd-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th style={{ minWidth: '110px' }}>{isAr ? 'رمز الصنف' : 'Item Code'}</th>
                      <th style={{ minWidth: '160px' }}>{isAr ? 'الوصف' : 'Description'}</th>
                      <th style={{ minWidth: '80px' }}>{isAr ? 'العلامة / Brand' : 'Brand'}</th>
                      <th style={{ minWidth: '70px' }}>{isAr ? 'الحجم / الرتبة' : 'Size/Grade'}</th>
                      <th style={{ width: '60px', textAlign: 'end' }}>{isAr ? 'طبالي' : 'Pallets'}</th>
                      <th style={{ width: '70px' }}>{isAr ? 'الوحدة' : 'Sales UoM'}</th>
                      <th style={{ width: '70px', textAlign: 'end' }}>{isAr ? 'الكمية' : 'Qty'}</th>
                      <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'السعر' : 'Unit Price'}</th>
                      <th style={{ width: '65px', textAlign: 'end' }}>{isAr ? 'خصم %' : 'Disc %'}</th>
                      <th style={{ width: '75px', textAlign: 'center' }}>{isAr ? 'الضريبة' : 'Tax'}</th>
                      <th style={{ width: '100px', textAlign: 'end' }}>{isAr ? 'الإجمالي' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedQuotation.lines || []).map((line, idx) => {
                      const qty = Number(line.customized_quantity || line.original_quantity || 0);
                      const price = Number(line.customized_unit_price || line.original_unit_price || 0);
                      const lineTotal = Number(line.line_total) || qty * price;
                      return (
                        <tr key={line.id || idx}>
                          <td>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{line.item_code}</td>
                          <td>{line.item_description || '—'}</td>
                          <td>{line.u_brand || '—'}</td>
                          <td>{line.u_size || '—'}</td>
                          <td style={{ textAlign: 'end' }}>{line.u_pallets != null ? line.u_pallets : '—'}</td>
                          <td>{line.uom || '—'}</td>
                          <td style={{ textAlign: 'end', fontWeight: 600 }}>{qty.toLocaleString()}</td>
                          <td style={{ textAlign: 'end' }}>
                            {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ textAlign: 'end' }}>
                            {line.discount_percent ? `${line.discount_percent}%` : '0%'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {line.tax_code ? (
                              <span className="badge badge--neutral" style={{ fontSize: '0.75rem' }}>
                                {line.tax_code}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ textAlign: 'end', fontWeight: 700 }}>
                            {lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section E: Workflow / Approval Audit Trail */}
            {(selectedQuotation.created_by || selectedQuotation.internal_reviewed_by || selectedQuotation.customer_approval_recorded_by || selectedQuotation.internal_approval_notes || selectedQuotation.internal_rejection_reason) && (
              <div style={{ background: 'var(--bg-elevated)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-heading)' }}>
                  {isAr ? 'سجل المراجعة والاعتماد (Audit Trail)' : 'Review & Approval Audit Trail'}
                </div>
                {selectedQuotation.created_by && (
                  <div style={{ marginBottom: '4px' }}>
                    <span className="cd-muted">{isAr ? 'أنشئ بواسطة: ' : 'Created by: '}</span>
                    <strong>{selectedQuotation.created_by}</strong>
                    {selectedQuotation.created_at && (
                      <span className="cd-muted"> ({selectedQuotation.created_at.slice(0, 16).replace('T', ' ')})</span>
                    )}
                  </div>
                )}
                {selectedQuotation.internal_reviewed_by && (
                  <div style={{ marginBottom: '4px' }}>
                    <span className="cd-muted">{isAr ? 'تمت المراجعة الداخلية بواسطة: ' : 'Internally reviewed by: '}</span>
                    <strong>{selectedQuotation.internal_reviewed_by}</strong>
                    {selectedQuotation.internal_reviewed_at && (
                      <span className="cd-muted"> ({selectedQuotation.internal_reviewed_at.slice(0, 16).replace('T', ' ')})</span>
                    )}
                  </div>
                )}
                {selectedQuotation.internal_approval_notes && (
                  <div style={{ marginBottom: '4px' }}>
                    <span className="cd-muted">{isAr ? 'ملاحظات الاعتماد الداخلي: ' : 'Internal approval notes: '}</span>
                    <span>{selectedQuotation.internal_approval_notes}</span>
                  </div>
                )}
                {selectedQuotation.internal_rejection_reason && (
                  <div style={{ marginBottom: '4px', color: 'var(--color-danger, #ef4444)' }}>
                    <span className="cd-muted">{isAr ? 'سبب الرفض: ' : 'Rejection reason: '}</span>
                    <span>{selectedQuotation.internal_rejection_reason}</span>
                  </div>
                )}
                {selectedQuotation.customer_approval_recorded_by && (
                  <div>
                    <span className="cd-muted">{isAr ? 'تم تسجيل اعتماد العميل بواسطة: ' : 'Customer approval recorded by: '}</span>
                    <strong>{selectedQuotation.customer_approval_recorded_by}</strong>
                    {selectedQuotation.customer_contact_person && (
                      <span> • {isAr ? 'مسؤول الاتصال: ' : 'Contact: '}{selectedQuotation.customer_contact_person}</span>
                    )}
                    {selectedQuotation.customer_approval_notes && (
                      <div><span className="cd-muted">{isAr ? 'ملاحظات اعتماد العميل: ' : 'Notes: '}</span>{selectedQuotation.customer_approval_notes}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Read-Only Notice & Close Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '14px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                🔒 {isAr ? 'عرض السعر في وضع المراجعة (للقراءة فقط).' : 'Quotation is in read-only review mode.'}
              </div>

              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => setSelectedQuotation(null)}
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="cd-readonly-note" style={{ marginTop: '16px' }}>
        {isAr
          ? 'شاشة مراجعة عروض الأسعار مخصصة للمعاينة ومتابعة دورة الاعتماد فقط (للقراءة فقط).'
          : 'The Sales Quotations Review screen is strictly read-only for reviewing quotation drafts and approval progress.'}
      </p>
      <WorkflowPagination paging={paging} loading={loading} />
    </div>
  );
}
