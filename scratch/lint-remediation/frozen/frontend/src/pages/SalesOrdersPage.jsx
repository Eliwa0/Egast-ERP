import '../styles/pages/sales-readiness.css';
import useWorkflowPagination from '../hooks/useWorkflowPagination';
import WorkflowPagination from '../components/ui/WorkflowPagination';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  FileText,
  Package,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowRight,
  Clock,
  Layers,
  Search,
  Printer,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import SalesDocumentPrintable from '../components/print/SalesDocumentPrintable';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import { fetchWorkflowSalesOrders, fetchSalesOrderDocument } from '../services/customizationDeliveryService';
import { getProductIcon } from '../utils/productIcon';
import '../styles/pages/quality-inspection.css';
import '../styles/pages/customization-delivery-landing.css';

export default function SalesOrdersPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all', 'active', 'completed'
  const paging = useWorkflowPagination(search, filterMode);
  const { params: pageParams, setInfo: setPageInfo, requestGuard } = paging;

  // Print state for sales orders
  const [printRequest, setPrintRequest] = useState(null);
  const [printingOrder, setPrintingOrder] = useState(null);
  const [printingOrderId, setPrintingOrderId] = useState(null);
  const printContainerRef = useRef(null);

  const handlePrintOrder = async (order) => {
    if (!order) return;
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Please allow popups for printing.');
      return;
    }
    setPrintingOrderId(order.sales_order_doc_entry);
    try {
      const document = await fetchSalesOrderDocument(order.sales_order_doc_entry);
      setPrintingOrder({ ...order, sales_order_doc_num: document.document_number, sales_order_doc_entry: document.document_entry,
        currency: document.currency, customer_name: document.customer_name,
        customer_code: document.customer_code, lines: document.lines, total_amount: document.total_amount,
        order_date: document.document_date, due_date: document.due_date, remarks: document.remarks,
        total_ordered: document.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0) });
      setPrintRequest({ printWindow, generatedAt: new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') });
    } catch (err) {
      printWindow.close();
      toast.error(err.response?.data?.error || t('common.errorLoadingData'));
      setPrintingOrderId(null);
    }
  };

  useEffect(() => {
    if (!printRequest || !printingOrder) return undefined;
    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []);
      const opened = writePrintDocument({
        printWindow: printRequest.printWindow,
        title: t('customizationDelivery.salesOrderDocument') || 'Sales Order',
        elements: sheets,
        orientation: 'landscape',
        direction: lang === 'ar' ? 'rtl' : 'ltr',
      });
      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(t('quality.printWindowBlocked') || 'Please allow popups for printing.');
      }
      setPrintRequest(null);
      setPrintingOrder(null);
      setPrintingOrderId(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [printRequest, printingOrder, t, toast, lang]);

  const loadOrders = useCallback(async () => {
    const identity = requestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkflowSalesOrders({ ...pageParams, filter: filterMode });
      if (!requestGuard.isCurrent(identity)) return;
      setOrders(data?.orders || []);
      setPageInfo(data?.pagination);
      if (data?.counts) {
        setCounts(data.counts);
      }
    } catch (err) {
      if (!requestGuard.isCurrent(identity)) return;
      console.error('Failed to load workflow sales orders:', err);
      const msg = err.response?.data?.error || t('common.errorLoadingData');
      setError(msg);
      toast.error(msg);
    } finally {
      if (requestGuard.isCurrent(identity)) setLoading(false);
    }
  }, [t, toast, pageParams, setPageInfo, requestGuard, filterMode]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (filterMode === 'active') {
      list = list.filter((o) => o.has_remaining);
    } else if (filterMode === 'completed') {
      list = list.filter((o) => !o.has_remaining);
    }

    return list;
  }, [orders, filterMode]);

  return (
    <div className="shipping-delivery-page page-shell sales-readiness-workflow">
      <PageHeader
        eyebrow={lang === 'ar' ? 'المرحلة ٢: أوامر البيع' : 'Layer 2: Sales Orders'}
        title={t('customizationDelivery.ordersTitle')}
        description={
          lang === 'ar'
            ? 'متابعة أوامر البيع والكميات المطلوبة والمُسلّمة والمتبقية. إنشاء إذن التسليم يتم لاحقًا من موديول Delivery.'
            : 'Track Sales Orders and ordered, delivered, and remaining quantities. Create deliveries later from the Delivery module.'
        }
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={loadOrders}
              disabled={loading}
            >
              {loading ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <>
                  <RefreshCw size={15} />
                  <span style={{ marginInlineStart: '6px' }}>{t('common.refresh')}</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={() => navigate('/customization-delivery/quotations')}
            >
              <FileText size={15} />
              <span style={{ marginInlineStart: '6px' }}>
                {lang === 'ar' ? 'عروض الأسعار' : 'Sales Quotations'}
              </span>
            </button>
          </div>
        }
      />

      {/* Tabs and Search */}
      <section className="card-panel" style={{ padding: '14px 18px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'all' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('all')}
            >
              {lang === 'ar' ? 'جميع أوامر البيع' : 'All Sales Orders'} ({counts.total})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'active' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('active')}
            >
              {lang === 'ar' ? 'بانتظار التسليم (كميات متبقية)' : 'Active (Remaining Open)'} ({counts.active})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'completed' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('completed')}
            >
              {lang === 'ar' ? 'مكتملة التسليم' : 'Fully Delivered'} ({counts.completed})
            </button>
          </div>

          <div style={{ flex: '1 1 240px', maxWidth: '360px' }}>
            <input
              type="search"
              className="app-input"
              placeholder={lang === 'ar' ? 'بحث برقم أمر البيع أو العميل أو عرض السعر...' : 'Search by order #, quotation # or customer...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Orders Grid */}
      {loading && orders.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <AppSpinner size="md" label={t('common.loading')} />
          <LoadingSkeleton rows={5} style={{ width: '100%', maxWidth: '800px' }} />
        </section>
      ) : error && orders.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
          <button type="button" className="app-button app-button--primary" onClick={loadOrders}>
            {t('common.retry')}
          </button>
        </section>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={
            filterMode === 'active'
              ? (lang === 'ar' ? 'لا توجد أوامر بيع تتطلب تسليماً حالياً' : 'No Sales Orders Awaiting Delivery')
              : (lang === 'ar' ? 'لا توجد أوامر بيع مسجلة في هذا المسار' : 'No Sales Orders Found')
          }
          description={
            lang === 'ar'
              ? 'تظهر هنا أوامر البيع المنشأة من عروض الأسعار المعتمدة. يمكنك اعتماد عرض سعر وتحويله لأمر بيع لتبدأ دورة التسليم.'
              : 'Sales orders created from approved quotations appear here. Approve a quotation and convert it to start fulfillment.'
          }
          actionLabel={lang === 'ar' ? 'الذهاب إلى عروض الأسعار' : 'Go to Sales Quotations'}
          onAction={() => navigate('/customization-delivery/quotations')}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: '20px' }}>
          {filteredOrders.map((order) => {
            const totalOrdered = Number(order.ordered_quantity) || 0;
            const totalDelivered = Number(order.delivered_quantity) || 0;
            const remaining = Number(order.remaining_open_quantity) || 0;
            const percent = totalOrdered > 0 ? Math.min(100, Math.round((totalDelivered / totalOrdered) * 100)) : 0;
            const isPartiallyDelivered = totalDelivered > 0 && remaining > 0;
            const isFullyDelivered = !order.has_remaining || remaining <= 0.0001;

            return (
              <div
                key={order.sales_order_doc_entry}
                className="card-panel"
                style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  borderRadius: '12px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '8px',
                        background: 'var(--bg-primary-soft, rgba(59,130,246,0.1))',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Package size={20} />
                    </div>
                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-heading)' }}>
                        {lang === 'ar' ? 'أمر بيع' : 'Sales Order'} #{order.sales_order_doc_num}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        SAP DocEntry: {order.sales_order_doc_entry}
                      {order.sap_error && <div role="alert">{lang === 'ar' ? 'تعذر تحديث SAP؛ بيانات محلية: ' : 'SAP refresh failed; local data: '}{order.sap_error}</div>}
                        {order.quotation_doc_num && (
                          <span> • {lang === 'ar' ? 'عرض سعر' : 'Quotation'} #{order.quotation_doc_num}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    {isFullyDelivered ? (
                      <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={13} />
                        <span>{lang === 'ar' ? 'مكتمل التسليم' : 'Fully Delivered'}</span>
                      </span>
                    ) : isPartiallyDelivered ? (
                      <span className="badge badge--warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={13} />
                        <span>{lang === 'ar' ? 'تسليم جزئي' : 'Partially Delivered'}</span>
                      </span>
                    ) : (
                      <span className="badge badge--neutral">
                        {lang === 'ar' ? 'بانتظار التسليم' : 'Not Delivered'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div style={{ fontSize: '0.9rem', display: 'grid', gap: '8px', color: 'var(--text)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🏢</span>
                      {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                    </span>
                    <strong>{order.customer_name || order.customer_code}</strong>
                    {order.customer_name && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginInlineStart: '6px' }}>
                        ({order.customer_code})
                      </span>
                    )}
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">📅</span>
                      {lang === 'ar' ? 'تاريخ الأمر: ' : 'Order Date: '}
                    </span>
                    <span>{order.order_date || '—'}</span>
                    {order.doc_total > 0 && (
                      <span style={{ marginInlineStart: '12px', color: 'var(--text-muted)' }}>
                        • {lang === 'ar' ? 'القيمة: ' : 'Total: '} <strong>{order.doc_total} {order.currency || 'EGP'}</strong>
                      </span>
                    )}
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">{getProductIcon(order.items_summary)}</span>
                      {lang === 'ar' ? 'الأصناف: ' : 'Items: '}
                    </span>
                    <span>{order.items_summary || (lang === 'ar' ? 'أصناف أمر البيع' : 'Order items')}</span>
                  </div>

                  {/* Quantity Breakdown Cards */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      padding: '10px',
                      borderRadius: '8px',
                      background: 'var(--bg-muted, rgba(255,255,255,0.03))',
                      textAlign: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">📊</span>
                        {lang === 'ar' ? 'المطلوب' : 'Ordered'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-heading)' }}>
                        {totalOrdered}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--accent-success, #22c55e)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">✅</span>
                        {lang === 'ar' ? 'المُسلَّم' : 'Delivered'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--accent-success, #22c55e)' }}>
                        {totalDelivered}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: remaining > 0 ? 'var(--accent-warning, #f59e0b)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">♻️</span>
                        {lang === 'ar' ? 'المتبقي' : 'Remaining'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: remaining > 0 ? 'var(--accent-warning, #f59e0b)' : 'var(--text-muted)' }}>
                        {remaining}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <span>{lang === 'ar' ? 'نسبة إنجاز التسليم' : 'Fulfillment Progress'}</span>
                      <span>{percent}%</span>
                    </div>
                    <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${percent}%`,
                          background: percent === 100 ? 'var(--accent-success, #22c55e)' : 'var(--primary, #3b82f6)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>

                  {/* Deliveries Count if any */}
                  {order.deliveries_count > 0 && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-success, #22c55e)' }}>
                      ✓ {lang === 'ar' ? `عدد أذون التسليم المنفذة: ${order.deliveries_count}` : `Deliveries executed: ${order.deliveries_count}`}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {remaining > 0.0001 ? (
                    <>
                      <button
                        type="button"
                        className="app-button app-button--primary"
                        onClick={() => navigate('/customization-delivery/deliveries')}
                        style={{
                          width: '100%',
                          fontSize: '0.95rem',
                          padding: '10px',
                        }}
                      >
                        <Truck size={17} />
                        <span style={{ marginInlineStart: '8px' }}>
                          {lang === 'ar' ? 'فتح موديول Delivery' : 'Open Delivery Module'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="app-button app-button--secondary app-button--compact"
                        onClick={() => handlePrintOrder(order)}
                        disabled={printingOrderId === order.sales_order_doc_entry}
                        aria-busy={printingOrderId === order.sales_order_doc_entry ? 'true' : 'false'}
                        style={{ width: '100%' }}
                      >
                        {printingOrderId === order.sales_order_doc_entry ? (
                          <>
                            <AppSpinner size="xs" />
                            <span style={{ marginInlineStart: '6px' }}>{t('common.preparingPrint')}</span>
                          </>
                        ) : (
                          <>
                            <Printer size={15} />
                            <span style={{ marginInlineStart: '6px' }}>
                              {lang === 'ar' ? 'طباعة أمر البيع' : 'Print Sales Order'}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="app-button app-button--secondary app-button--compact"
                        onClick={() => navigate(`/customization-delivery/orders/documents/${order.sales_order_doc_entry}`)}
                        style={{ width: '100%' }}
                      >
                        <FileText size={15} />
                        <span style={{ marginInlineStart: '6px' }}>
                          {lang === 'ar' ? 'عرض تفاصيل أمر البيع' : 'View Sales Order Details'}
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          padding: '8px',
                          borderRadius: '6px',
                          background: 'rgba(34, 197, 94, 0.08)',
                          color: 'var(--accent-success, #22c55e)',
                          fontSize: '0.88rem',
                          textAlign: 'center',
                          fontWeight: 600,
                        }}
                      >
                        ✓ {lang === 'ar' ? 'تم تسليم كافة كميات أمر البيع بالكامل' : 'All quantities delivered completely'}
                      </div>
                      <button
                        type="button"
                        className="app-button app-button--secondary app-button--compact"
                        onClick={() => handlePrintOrder(order)}
                        disabled={printingOrderId === order.sales_order_doc_entry}
                        aria-busy={printingOrderId === order.sales_order_doc_entry ? 'true' : 'false'}
                        style={{ width: '100%' }}
                      >
                        {printingOrderId === order.sales_order_doc_entry ? (
                          <>
                            <AppSpinner size="xs" />
                            <span style={{ marginInlineStart: '6px' }}>{t('common.preparingPrint')}</span>
                          </>
                        ) : (
                          <>
                            <Printer size={15} />
                            <span style={{ marginInlineStart: '6px' }}>
                              {lang === 'ar' ? 'طباعة أمر البيع' : 'Print Sales Order'}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="app-button app-button--secondary"
                        onClick={() => navigate(`/customization-delivery/orders/documents/${order.sales_order_doc_entry}`)}
                        style={{ width: '100%' }}
                      >
                        <FileText size={16} />
                        <span style={{ marginInlineStart: '6px' }}>
                          {lang === 'ar' ? 'عرض تفاصيل أمر البيع' : 'View Sales Order Details'}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden printable sheet for Sales Order */}
      {printRequest && printingOrder && (
        <div ref={printContainerRef} aria-hidden="true" style={{ display: 'none' }}>
          <SalesDocumentPrintable
            document={{
              documentType: 'SALES_ORDER',
              docNum: printingOrder.sales_order_doc_num,
              docEntry: printingOrder.sales_order_doc_entry,
              customerName: printingOrder.customer_name || printingOrder.customer_code,
              customerCode: printingOrder.customer_code,
              docDate: printingOrder.order_date || printingOrder.doc_date,
              dueDate: printingOrder.due_date,
              currency: printingOrder.currency || '',
              remarks: printingOrder.remarks || '',
              baseDocumentNum: printingOrder.quotation_doc_num,
              lines: (printingOrder.lines || []).map((l) => ({
                item_code: l.item_code,
                warehouse_code: l.warehouse_code,
                item_description: l.item_description,
                quantity: Number(l.ordered_quantity ?? l.quantity ?? 0),
                unit_price: Number(l.unit_price ?? 0),
                line_total: Number(l.line_total ?? (Number(l.ordered_quantity ?? l.quantity ?? 0) * Number(l.unit_price ?? 0))),
                uom: l.uom,
              })),
              totalQuantity: Number(printingOrder.total_ordered ?? 0),
              totalAmount: printingOrder.total_amount,
            }}
            generatedAt={printRequest.generatedAt}
            t={t}
          />
        </div>
      )}
      <WorkflowPagination paging={paging} loading={loading} />
    </div>
  );
}
