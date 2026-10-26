import '../styles/pages/sales-readiness.css';
import useWorkflowPagination from '../hooks/useWorkflowPagination';
import WorkflowPagination from '../components/ui/WorkflowPagination';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  RefreshCw,
  Search,
  SlidersHorizontal,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  X,
  Eye,
  FileText,
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

const isSalesOrderReviewEligible = (draft) =>
  draft?.status === 'ORDER_POSTED' && Boolean(draft?.sap_order_doc_num);

export default function SalesOrdersReviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetId = searchParams.get('id');
  const targetOrder = searchParams.get('order');

  const { t, lang } = useI18n();
  const isAr = lang === 'ar';
  const toast = useToast();

  const [drafts, setDrafts] = useState([]);
  const [deliveryDrafts, setDeliveryDrafts] = useState([]);
  const [orderSummaries, setOrderSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('ALL'); // ALL, NOT_DELIVERED, PARTIAL, FULLY_DELIVERED
  const paging = useWorkflowPagination(search, JSON.stringify([statusFilter, deliveryStatusFilter, targetId, targetOrder]));
  const { params: pageParams, setInfo: setPageInfo, requestGuard } = paging;

  // Read-only inspection modal state
  const [selectedDraft, setSelectedDraft] = useState(null);

  const loadData = useCallback(async () => {
    const identity = requestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const deliveryData = await fetchWorkflowSalesOrders({ ...pageParams, filter: 'all', local_only: true,
        delivery_status: deliveryStatusFilter, ...(targetId ? { id: targetId, offset: 0 } : targetOrder ? { order_number: targetOrder, offset: 0 } : {}) });
      const ids = (deliveryData.orders || []).map(order => order.customization_draft_id);
      const orderData = ids.length ? await fetchCustomizationDrafts({ draft_ids: ids.join(','), page_size: 50 }) : [];
      if (!requestGuard.isCurrent(identity)) return;
      setDrafts(orderData || []);
      setPageInfo(deliveryData?.pagination);
      setOrderSummaries(deliveryData.orders || []);
      setDeliveryDrafts((deliveryData.orders || []).flatMap(order => (order.posted_deliveries || []).map(delivery => ({
        ...delivery, sales_order_doc_num: order.sales_order_doc_num,
      }))));
    } catch (err) {
      if (!requestGuard.isCurrent(identity)) return;
      console.error('Failed to load sales order drafts:', err);
      const msg = err.response?.data?.error || t('common.errorLoadingData');
      setError(msg);
      toast.error(msg);
    } finally {
      if (requestGuard.isCurrent(identity)) setLoading(false);
    }
  }, [t, toast, pageParams, setPageInfo, requestGuard, targetId, targetOrder, deliveryStatusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When navigated with ?id= or ?order=, automatically find and open that document in Review
  useEffect(() => {
    if (!loading && drafts.length > 0) {
      if (targetId) {
        const match = drafts.find(
          (d) => isSalesOrderReviewEligible(d) && String(d.id) === String(targetId)
        );
        if (match) setSelectedDraft(match);
      } else if (targetOrder) {
        const match = drafts.find(
          (d) => isSalesOrderReviewEligible(d) && String(d.sap_order_doc_num) === String(targetOrder)
        );
        if (match) setSelectedDraft(match);
      }
    }
  }, [drafts, loading, targetId, targetOrder, deliveryStatusFilter]);

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setDeliveryStatusFilter('ALL');
  };

  const hasFilters = Boolean(search.trim() || statusFilter !== 'ALL' || deliveryStatusFilter !== 'ALL');

  // Map deliveries by sales order number
  const deliveriesByOrderNum = useMemo(() => {
    const map = new Map();
    (deliveryDrafts || []).forEach((del) => {
      if (del.sales_order_doc_num) {
        const key = String(del.sales_order_doc_num);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(del);
      }
    });
    return map;
  }, [deliveryDrafts]);

  // Helper to compute delivery progress for a sales order draft
  const getOrderDeliveryProgress = useCallback((draft) => {
    const orderNum = String(draft.sap_order_doc_num);
    const relatedDeliveries = deliveriesByOrderNum.get(orderNum) || [];
    const relatedDeliveryNums = relatedDeliveries.map((d) => d.sap_doc_num || d.id).filter(Boolean);

    const lines = draft.lines || [];
    const summary = orderSummaries.find(order => String(order.sales_order_doc_entry) === String(draft.sap_order_doc_entry));
    const totalOrderedQty = summary?.ordered_quantity ?? lines.filter(line => line.is_selected !== false).reduce(
      (sum, l) => sum + Number(l.customized_quantity || l.original_quantity || 0),
      0
    );

    // Sum delivered quantity across related deliveries
    let totalDeliveredQty = 0;
    relatedDeliveries.forEach((del) => {
      (del.lines || []).forEach((dl) => {
        totalDeliveredQty += Number(dl.delivery_quantity || 0);
      });
    });
    totalDeliveredQty = summary?.delivered_quantity ?? totalDeliveredQty;

    const remainingQty = Math.max(0, totalOrderedQty - totalDeliveredQty);
    let deliveryStatus = 'NOT_DELIVERED';
    if (totalDeliveredQty >= totalOrderedQty && totalOrderedQty > 0) {
      deliveryStatus = 'FULLY_DELIVERED';
    } else if (totalDeliveredQty > 0) {
      deliveryStatus = 'PARTIAL';
    }

    return {
      relatedDeliveries,
      relatedDeliveryNums,
      totalOrderedQty,
      totalDeliveredQty,
      remainingQty,
      deliveryStatus,
    };
  }, [deliveriesByOrderNum, orderSummaries]);

  // Review contains only locally-created Sales Orders that were posted successfully.
  const workflowDrafts = useMemo(() => {
    return (drafts || []).filter(
      (d) => d.is_local_creation !== false && isSalesOrderReviewEligible(d)
    );
  }, [drafts]);

  const filteredDrafts = useMemo(() => {
    let result = workflowDrafts;

    if (statusFilter !== 'ALL') {
      result = result.filter((d) => d.status === statusFilter);
    }

    if (deliveryStatusFilter !== 'ALL') {
      result = result.filter((d) => {
        const progress = getOrderDeliveryProgress(d);
        return progress.deliveryStatus === deliveryStatusFilter;
      });
    }

    return result;
  }, [workflowDrafts, statusFilter, deliveryStatusFilter, getOrderDeliveryProgress]);

  const getDeliveryStatusBadge = (deliveryStatus, percentDelivered) => {
    switch (deliveryStatus) {
      case 'FULLY_DELIVERED':
        return (
          <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} />
            <span>{isAr ? 'تم التسليم بالكامل' : 'Fully Delivered'}</span>
          </span>
        );
      case 'PARTIAL':
        return (
          <span className="badge badge--warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={13} />
            <span>{isAr ? `تسليم جزئي (${percentDelivered}%)` : `Partially Delivered (${percentDelivered}%)`}</span>
          </span>
        );
      case 'NOT_DELIVERED':
      default:
        return (
          <span className="badge badge--neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Truck size={13} />
            <span>{isAr ? 'لم يُسلّم بعد' : 'Not Delivered'}</span>
          </span>
        );
    }
  };

  return (
    <div className="shipping-delivery-page page-shell cd-list-page sales-orders-review-page sales-readiness-workflow" style={{ paddingBottom: '32px' }}>
      <PageHeader
        eyebrow={t('customizationDelivery.salesOrdersReviewEyebrow')}
        title={t('customizationDelivery.salesOrdersReviewTitle')}
        description={t('customizationDelivery.salesOrdersReviewSubtitle')}
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
            {isAr ? 'فلاتر مراجعة أوامر البيع' : 'Sales Order Review Filters'}
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
                placeholder={isAr ? 'بحث برقم أمر البيع، العرض، العميل...' : 'Search by order #, quotation, customer...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={loading && drafts.length === 0}
              />
            </div>
          </label>

          <label className="form-field sales-orders-review__filter-field">
            <span className="form-label">{isAr ? 'حالة التسليم' : 'Delivery Progress'}</span>
            <select
              className="app-select"
              value={deliveryStatusFilter}
              onChange={(e) => setDeliveryStatusFilter(e.target.value)}
              disabled={loading && drafts.length === 0}
            >
              <option value="ALL">{isAr ? 'كل حالات التسليم' : 'All Delivery Statuses'}</option>
              <option value="NOT_DELIVERED">{isAr ? 'لم يُسلّم بعد' : 'Not Delivered'}</option>
              <option value="PARTIAL">{isAr ? 'تسليم جزئي' : 'Partially Delivered'}</option>
              <option value="FULLY_DELIVERED">{isAr ? 'تم التسليم بالكامل' : 'Fully Delivered'}</option>
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
      ) : filteredDrafts.length === 0 ? (
        <EmptyState
          title={isAr ? 'لا توجد أوامر بيع مرحلة' : 'No Sales Orders Found'}
          description={
            hasFilters
              ? (isAr ? 'لا توجد أوامر بيع تطابق الفلاتر المحددة.' : 'No sales orders match your selected filters.')
              : (isAr ? 'لم يتم العثور على أي أوامر بيع منشأة في SAP بعد.' : 'No sales orders have been posted to SAP yet.')
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
                    <th style={{ minWidth: '100px' }}>{isAr ? 'أمر البيع' : 'Sales Order #'}</th>
                    <th style={{ minWidth: '85px' }}>{isAr ? 'عرض السعر الأساسي' : 'Base Quotation'}</th>
                    <th style={{ minWidth: '110px' }}>{isAr ? 'العميل' : 'Customer'}</th>
                    <th style={{ minWidth: '120px' }}>{isAr ? 'البنود' : 'Items'}</th>
                    <th style={{ minWidth: '60px', textAlign: 'end' }}>{isAr ? 'الكمية' : 'Qty'}</th>
                    <th style={{ minWidth: '85px', textAlign: 'end' }}>{isAr ? 'الإجمالي' : 'Total'}</th>
                    <th style={{ minWidth: '75px' }}>{isAr ? 'تاريخ الأمر' : 'Order Date'}</th>
                    <th style={{ minWidth: '85px' }}>{isAr ? 'تقدم التسليم' : 'Delivery Status'}</th>
                    <th style={{ minWidth: '95px' }}>{isAr ? 'سلسلة التتبع' : 'Traceability'}</th>
                    <th style={{ minWidth: '70px', textAlign: 'center' }}>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrafts.map((draft) => {
                    const lines = draft.lines || [];
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

                    const orderDate = draft.order_posted_at?.slice(0, 10) || draft.quotation_doc_date || '—';
                    const progress = getOrderDeliveryProgress(draft);
                    const percentDelivered = progress.totalOrderedQty > 0
                      ? Math.round((progress.totalDeliveredQty / progress.totalOrderedQty) * 100)
                      : 0;

                    return (
                      <tr
                        key={draft.id}
                        className="cd-row"
                        onClick={() => setSelectedDraft(draft)}
                        tabIndex={0}
                        role="link"
                        style={{ cursor: 'pointer' }}
                        aria-label={`Sales Order ${draft.sap_order_doc_num}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSelectedDraft(draft);
                          }
                        }}
                      >
                        <td>
                          <div>
                            <div className="sales-orders-review__order-number">
                              <Package size={15} />
                              <span>
                                {isAr ? `أمر بيع #${draft.sap_order_doc_num}` : `Sales Order #${draft.sap_order_doc_num}`}
                              </span>
                            </div>
                            {draft.sap_order_doc_entry && (
                              <div className="cd-muted" style={{ fontSize: '0.78rem', marginTop: '3px' }}>
                                DocEntry: {draft.sap_order_doc_entry}
                              </div>
                            )}
                          </div>
                        </td>

                        <td>
                          <span
                            className="doc-trace-chip doc-trace-chip--clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (draft.quotation_doc_num) {
                                navigate(`/customization-delivery/quotations/review?quotation=${draft.quotation_doc_num}`);
                              }
                            }}
                            title={isAr ? 'فتح عرض السعر في شاشة المراجعة' : 'Open Quotation in Review'}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: 'var(--color-primary)',
                              fontWeight: 600,
                              textDecoration: 'underline',
                            }}
                          >
                            <FileText size={13} />
                            <span>#{draft.quotation_doc_num || draft.id}</span>
                          </span>
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
                          {Number(progress.totalOrderedQty).toLocaleString()}
                        </td>

                        <td className="cd-strong" style={{ textAlign: 'end', color: 'var(--color-primary)' }}>
                          {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>{draft.currency || 'EGP'}</span>
                        </td>

                        <td>{orderDate}</td>

                        <td>
                          {getDeliveryStatusBadge(progress.deliveryStatus, percentDelivered)}
                        </td>

                        <td>
                          <DocumentTraceabilityChain
                            quotationNum={draft.quotation_doc_num || draft.id}
                            orderNum={draft.sap_order_doc_num}
                            deliveryNums={progress.relatedDeliveryNums}
                            currentDoc="order"
                            variant="inline"
                          />
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="app-button app-button--secondary app-button--compact"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDraft(draft);
                            }}
                            title={isAr ? 'عرض تفاصيل أمر البيع' : 'View Sales Order Details'}
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
            {filteredDrafts.map((draft) => {
              const lines = draft.lines || [];
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

              const orderDate = draft.order_posted_at?.slice(0, 10) || draft.quotation_doc_date || '—';
              const progress = getOrderDeliveryProgress(draft);
              const percentDelivered = progress.totalOrderedQty > 0
                ? Math.round((progress.totalDeliveredQty / progress.totalOrderedQty) * 100)
                : 0;

              return (
                <div
                  key={draft.id}
                  className="cd-doc-card"
                  onClick={() => setSelectedDraft(draft)}
                  tabIndex={0}
                  role="link"
                  aria-label={`Sales Order ${draft.sap_order_doc_num}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setSelectedDraft(draft);
                    }
                  }}
                >
                  <div className="cd-doc-card__header">
                    <div className="cd-doc-card__title-wrap">
                      <div className="cd-doc-card__title">
                        <Package size={16} />
                        <span>
                          {isAr ? `أمر بيع #${draft.sap_order_doc_num}` : `Sales Order #${draft.sap_order_doc_num}`}
                        </span>
                      </div>
                      {draft.sap_order_doc_entry && (
                        <span className="cd-muted">DocEntry: {draft.sap_order_doc_entry}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      {getDeliveryStatusBadge(progress.deliveryStatus, percentDelivered)}
                      <span className="cd-muted" style={{ fontSize: '0.75rem' }}>{orderDate}</span>
                    </div>
                  </div>

                  <div className="cd-doc-card__grid">
                    <div className="cd-doc-card__field">
                      <span className="cd-doc-card__label">{isAr ? 'عرض السعر الأساسي' : 'Base Quotation'}</span>
                      <div className="cd-doc-card__value">
                        <span
                          className="doc-trace-chip doc-trace-chip--clickable"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (draft.quotation_doc_num) {
                              navigate(`/customization-delivery/quotations/review?quotation=${draft.quotation_doc_num}`);
                            }
                          }}
                          title={isAr ? 'فتح عرض السعر في شاشة المراجعة' : 'Open Quotation in Review'}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--color-primary)',
                            fontWeight: 600,
                            textDecoration: 'underline',
                          }}
                        >
                          <FileText size={13} />
                          <span>#{draft.quotation_doc_num || draft.id}</span>
                        </span>
                      </div>
                    </div>

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
                      <span className="cd-doc-card__label">{isAr ? 'الكمية المطلوبة' : 'Ordered Qty'}</span>
                      <div className="cd-doc-card__value cd-strong">
                        {Number(progress.totalOrderedQty).toLocaleString()}
                      </div>
                    </div>

                    <div className="cd-doc-card__field">
                      <span className="cd-doc-card__label">{isAr ? 'إجمالي القيمة' : 'Total Amount'}</span>
                      <div className="cd-doc-card__value cd-strong" style={{ color: 'var(--color-primary)' }}>
                        {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>{draft.currency || 'EGP'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="cd-doc-card__trace-row">
                    <DocumentTraceabilityChain
                      quotationNum={draft.quotation_doc_num || draft.id}
                      orderNum={draft.sap_order_doc_num}
                      deliveryNums={progress.relatedDeliveryNums}
                      currentDoc="order"
                      variant="inline"
                    />
                  </div>

                  <div className="cd-doc-card__footer">
                    <button
                      type="button"
                      className="app-button app-button--secondary app-button--compact"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDraft(draft);
                      }}
                      title={isAr ? 'عرض تفاصيل أمر البيع' : 'View Sales Order Details'}
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

      {/* STRICTLY READ-ONLY SALES ORDER INSPECTION MODAL */}
      {selectedDraft && (() => {
        const progress = getOrderDeliveryProgress(selectedDraft);
        const percentDelivered = progress.totalOrderedQty > 0
          ? Math.round((progress.totalDeliveredQty / progress.totalOrderedQty) * 100)
          : 0;

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
            onClick={() => setSelectedDraft(null)}
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
                    <Package size={22} color="var(--accent-success, #22c55e)" />
                    <h3 style={{ margin: 0, color: 'var(--text-heading)', fontSize: '1.25rem' }}>
                      {isAr
                        ? `أمر بيع في SAP #${selectedDraft.sap_order_doc_num}`
                        : `SAP Sales Order #${selectedDraft.sap_order_doc_num}`}
                    </h3>
                    <span className="badge badge--success">
                      <CheckCircle2 size={13} style={{ marginInlineEnd: '4px' }} />
                      {isAr ? 'تم الإنشاء في SAP' : 'Posted to SAP'}
                    </span>
                    {getDeliveryStatusBadge(progress.deliveryStatus, percentDelivered)}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>SAP DocEntry: {selectedDraft.sap_order_doc_entry || '—'}</span>
                    {selectedDraft.quotation_doc_num && (
                      <span> • {isAr ? 'مبني على عرض سعر: ' : 'Based on Quotation: '}#{selectedDraft.quotation_doc_num}</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="app-button app-button--ghost app-button--compact"
                  onClick={() => setSelectedDraft(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Traceability Flow Banner */}
              {/* Section G: Document Traceability Flow */}
              <DocumentTraceabilityChain
                quotationNum={selectedDraft.quotation_doc_num || selectedDraft.id}
                orderNum={selectedDraft.sap_order_doc_num}
                deliveryNums={progress.relatedDeliveryNums}
                currentDoc="order"
                variant="full"
              />

              {/* Section B & C: Customer, Source & Commercial Details */}
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
                      {selectedDraft.customer_name || selectedDraft.customer_code}
                    </div>
                  </div>
                  {selectedDraft.customer_code && (
                    <span className="badge badge--neutral" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                      {isAr ? 'كود العميل: ' : 'Code: '}{selectedDraft.customer_code}
                    </span>
                  )}
                </div>

                {/* Source Quotation, Dates & Commercial Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                    fontSize: '0.88rem',
                  }}
                >
                  <div>
                    <span className="cd-muted">{isAr ? 'عرض السعر الأساسي: ' : 'Base Quotation: '}</span>
                    <strong
                      style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => {
                        if (selectedDraft.quotation_doc_num) {
                          navigate(`/customization-delivery/quotations/review?quotation=${selectedDraft.quotation_doc_num}`);
                        }
                      }}
                      title={isAr ? 'فتح عرض السعر في شاشة المراجعة' : 'Open Quotation in Review'}
                    >
                      #{selectedDraft.quotation_doc_num || selectedDraft.id}
                    </strong>
                  </div>
                  <div>
                    <span className="cd-muted">{isAr ? 'تاريخ أمر البيع: ' : 'Order Date: '}</span>
                    <strong>{selectedDraft.order_posted_at?.slice(0, 10) || selectedDraft.quotation_doc_date || '—'}</strong>
                  </div>
                  <div>
                    <span className="cd-muted">{isAr ? 'تاريخ الترحيل: ' : 'Posted Date & Time: '}</span>
                    <strong>{selectedDraft.order_posted_at?.slice(0, 16).replace('T', ' ') || '—'}</strong>
                  </div>
                  <div>
                    <span className="cd-muted">{isAr ? 'العملة وسعر الصرف: ' : 'Currency & Rate: '}</span>
                    <strong>{selectedDraft.currency || 'EGP'}</strong>
                    {selectedDraft.doc_rate ? <span className="cd-muted"> (Rate: {selectedDraft.doc_rate})</span> : null}
                  </div>
                  {selectedDraft.order_posted_by && (
                    <div>
                      <span className="cd-muted">{isAr ? 'تم الترحيل بواسطة: ' : 'Posted by: '}</span>
                      <strong>{selectedDraft.order_posted_by}</strong>
                    </div>
                  )}
                  {selectedDraft.payment_group_code && (
                    <div>
                      <span className="cd-muted">{isAr ? 'شروط الدفع: ' : 'Payment Terms: '}</span>
                      <strong>#{selectedDraft.payment_group_code}</strong>
                    </div>
                  )}
                  {selectedDraft.header_fields?.PriceListNum && (
                    <div>
                      <span className="cd-muted">{isAr ? 'قائمة الأسعار: ' : 'Price List: '}</span>
                      <strong>#{selectedDraft.header_fields.PriceListNum}</strong>
                    </div>
                  )}
                  {selectedDraft.customer_reference_number && (
                    <div>
                      <span className="cd-muted">{isAr ? 'مرجع اعتماد العميل: ' : 'Customer PO / Ref: '}</span>
                      <strong>
                        {selectedDraft.customer_approval_type_display || selectedDraft.customer_approval_type}: {selectedDraft.customer_reference_number}
                      </strong>
                    </div>
                  )}
                  {selectedDraft.comments && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span className="cd-muted">{isAr ? 'ملاحظات: ' : 'Comments: '}</span>
                      <span>{selectedDraft.comments}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section D: Order Totals & Delivery Progress Overview */}
              {(() => {
                const totalOrderAmount = (selectedDraft.lines || []).reduce(
                  (sum, l) =>
                    sum +
                    (Number(l.line_total) ||
                      Number(l.customized_quantity || l.original_quantity || 0) *
                        Number(l.customized_unit_price || l.original_unit_price || 0)),
                  0
                );

                return (
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-heading)', fontSize: '0.95rem' }}>
                        {isAr ? 'إجماليات أمر البيع وحالة التسليم' : 'Order Totals & Delivery Progress'}
                      </div>
                      {getDeliveryStatusBadge(progress.deliveryStatus, percentDelivered)}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', fontSize: '0.85rem' }}>
                      <div style={{ padding: '8px 12px', background: 'var(--bg-soft)', borderRadius: '6px' }}>
                        <div className="cd-muted">{isAr ? 'الكمية المطلوبة' : 'Ordered Qty'}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Number(progress.totalOrderedQty).toLocaleString()}</div>
                      </div>
                      <div style={{ padding: '8px 12px', background: 'var(--bg-soft)', borderRadius: '6px' }}>
                        <div className="cd-muted">{isAr ? 'الكمية المسلّمة' : 'Delivered Qty'}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-success, #22c55e)' }}>
                          {Number(progress.totalDeliveredQty).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ padding: '8px 12px', background: 'var(--bg-soft)', borderRadius: '6px' }}>
                        <div className="cd-muted">{isAr ? 'الكمية المتبقية' : 'Remaining Qty'}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: progress.remainingQty > 0 ? 'var(--color-primary)' : 'var(--text-muted)' }}>
                          {Number(progress.remainingQty).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ padding: '8px 12px', background: 'var(--bg-soft)', borderRadius: '6px' }}>
                        <div className="cd-muted">{isAr ? 'إجمالي قيمة الأمر' : 'Order Total Amount'}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                          {totalOrderAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>{selectedDraft.currency || 'EGP'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Section E: Items & Delivery Progress Table */}
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', color: 'var(--text-heading)' }}>
                  {isAr ? 'بنود أمر البيع وموقف التسليم' : 'Sales Order Items & Delivery Progress'} ({selectedDraft.lines?.length || 0})
                </h4>
                <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')} style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  <table className="cd-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th style={{ minWidth: '120px' }}>{isAr ? 'رمز الصنف' : 'Item Code'}</th>
                        <th style={{ minWidth: '170px' }}>{isAr ? 'الوصف' : 'Description'}</th>
                        <th style={{ width: '70px' }}>{isAr ? 'الوحدة' : 'UOM'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'المطلوب' : 'ORDERED'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'المسلّم' : 'DELIVERED'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'المتبقي' : 'REMAINING'}</th>
                        <th style={{ width: '90px', textAlign: 'end' }}>{isAr ? 'السعر' : 'Unit Price'}</th>
                        <th style={{ width: '65px', textAlign: 'end' }}>{isAr ? 'خصم %' : 'Disc %'}</th>
                        <th style={{ width: '75px', textAlign: 'center' }}>{isAr ? 'الضريبة' : 'Tax'}</th>
                        <th style={{ width: '100px', textAlign: 'end' }}>{isAr ? 'الإجمالي' : 'Total'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedDraft.lines || []).map((line, idx) => {
                        const orderedQty = Number(line.customized_quantity || line.original_quantity || 0);
                        const price = Number(line.customized_unit_price || line.original_unit_price || 0);
                        const lineTotal = Number(line.line_total) || orderedQty * price;

                        // Calculate line-level delivered quantity
                        let lineDeliveredQty = 0;
                        progress.relatedDeliveries.forEach((del) => {
                          (del.lines || []).forEach((dl) => {
                            if (dl.item_code === line.item_code) {
                              lineDeliveredQty += Number(dl.delivery_quantity || 0);
                            }
                          });
                        });
                        const lineRemainingQty = Math.max(0, orderedQty - lineDeliveredQty);

                        return (
                          <tr key={line.id || idx}>
                            <td>{idx + 1}</td>
                            <td style={{ fontWeight: 600 }}>{line.item_code}</td>
                            <td>{line.item_description || '—'}</td>
                            <td>{line.uom || '—'}</td>
                            <td style={{ textAlign: 'end', fontWeight: 700 }}>{orderedQty.toLocaleString()}</td>
                            <td style={{ textAlign: 'end', color: 'var(--accent-success, #22c55e)', fontWeight: 700 }}>
                              {lineDeliveredQty.toLocaleString()}
                            </td>
                            <td style={{ textAlign: 'end', color: lineRemainingQty > 0 ? 'var(--color-primary)' : 'var(--text-muted)', fontWeight: 700 }}>
                              {lineRemainingQty.toLocaleString()}
                            </td>
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

              {/* Section F: Linked Deliveries Card */}
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px 16px',
                }}
              >
                <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: 'var(--text-heading)' }}>
                  {isAr ? 'مستندات التسليم المرتبطة بأمر البيع' : 'Linked Delivery Documents'} ({progress.relatedDeliveries.length})
                </h4>

                {progress.relatedDeliveries.length > 0 ? (
                  <div className="cd-table-wrap" tabIndex={0} role="region" aria-label={t('customizationDelivery.scrollTable')}>
                    <table className="cd-table" style={{ fontSize: '0.84rem' }}>
                      <thead>
                        <tr>
                          <th>{isAr ? 'رقم التسليم في SAP' : 'SAP Delivery #'}</th>
                          <th>{isAr ? 'تاريخ التسليم' : 'Delivery Date'}</th>
                          <th style={{ textAlign: 'end' }}>{isAr ? 'الكمية المسلّمة' : 'Delivered Qty'}</th>
                          <th>{isAr ? 'الحالة' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {progress.relatedDeliveries.map((del) => {
                          const delQty = (del.lines || []).reduce(
                            (sum, l) => sum + (Number(l.delivery_quantity) || 0),
                            0
                          );
                          const delNum = del.sap_doc_num || del.id;
                          return (
                            <tr key={del.id || delNum}>
                              <td>
                                <span
                                  className="doc-trace-chip doc-trace-chip--clickable"
                                  onClick={() => navigate(`/customization-delivery/review/deliveries?delivery=${delNum}`)}
                                  title={isAr ? 'فتح مستند التسليم في شاشة المراجعة' : 'Open Delivery in Review'}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    color: 'var(--color-primary)',
                                    fontWeight: 700,
                                    textDecoration: 'underline',
                                  }}
                                >
                                  <Truck size={14} />
                                  <span>#{delNum}</span>
                                </span>
                              </td>
                              <td>{del.doc_date || del.posted_at?.slice(0, 10) || '—'}</td>
                              <td style={{ textAlign: 'end', fontWeight: 700, color: 'var(--accent-success, #22c55e)' }}>
                                {delQty.toLocaleString()}
                              </td>
                              <td>
                                <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <CheckCircle2 size={12} />
                                  <span>{isAr ? 'مرحل في SAP' : 'Posted to SAP'}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '12px 16px',
                      background: 'var(--bg-soft)',
                      borderRadius: '6px',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.88rem',
                    }}
                  >
                    <Clock size={16} />
                    <span>{isAr ? 'لم يتم التسليم بعد (في انتظار إنشاء مستند التسليم)' : 'Not delivered yet — awaiting delivery creation'}</span>
                  </div>
                )}
              </div>

              {/* Read-Only Notice & Close Button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '14px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  🔒 {isAr ? 'أمر البيع في وضع المراجعة (للقراءة فقط).' : 'Sales Order is in read-only review mode.'}
                </div>

                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() => setSelectedDraft(null)}
                >
                  {isAr ? 'إغلاق' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <p className="cd-readonly-note" style={{ marginTop: '16px' }}>
        {isAr
          ? 'شاشة مراجعة أوامر البيع مخصصة للمعاينة ومتابعة التسليمات فقط (للقراءة فقط).'
          : 'The Sales Orders Review screen is strictly read-only for reviewing posted orders and tracking delivery progress.'}
      </p>
      <WorkflowPagination paging={paging} loading={loading} />
    </div>
  );
}
