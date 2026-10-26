import useWorkflowPagination from '../hooks/useWorkflowPagination';
import WorkflowPagination from '../components/ui/WorkflowPagination';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  Truck,
  Package,
  RefreshCw,
  CheckCircle2,
  FileText,
  Search,
  AlertCircle,
  Clock,
  ArrowRight,
  ClipboardCheck,
  Check,
  X,
  Send,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { canManageDelivery } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';
import ShippingDeliveryHandoff from '../components/ShippingDeliveryHandoff';
import EmptyState from '../components/ui/EmptyState';
import { getProductIcon } from '../utils/productIcon';
import {
  fetchEligibleDeliveryOrders,
  fetchDeliveryDrafts,
  approveDeliveryDraft,
  rejectDeliveryDraft,
  postDeliveryToSap,
} from '../services/customizationDeliveryService';
import '../styles/pages/quality-inspection.css';

export default function DeliveriesPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const isManager = canManageDelivery(user);

  const [orders, setOrders] = useState([]);
  const [pendingDrafts, setPendingDrafts] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('active'); // 'active', 'completed', 'all', 'pending'
  const paging = useWorkflowPagination(search, filterMode);
  const { params: pageParams, setInfo: setPageInfo, requestGuard } = paging;

  // Action states for pending drafts
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [rejectModalDraft, setRejectModalDraft] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const loadOrders = useCallback(async () => {
    const identity = requestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const [data, draftsData] = await Promise.all([
        fetchEligibleDeliveryOrders({ ...pageParams, filter: filterMode === 'pending' ? 'all' : filterMode }),
        fetchDeliveryDrafts({ ...pageParams, status: 'PENDING_REVIEW' }).catch(() => []),
      ]);
      if (!requestGuard.isCurrent(identity)) return;
      setOrders(data?.orders || []);
      setPageInfo(filterMode === 'pending' ? draftsData?.pagination : data?.pagination);
      setPendingDrafts(draftsData || []);
      if (data?.counts) {
        setCounts(data.counts);
      }
    } catch (err) {
      if (!requestGuard.isCurrent(identity)) return;
      console.error('Failed to load eligible delivery orders:', err);
      const msg = err.response?.data?.error || t('common.errorLoadingData');
      setError(msg);
      toast.error(msg);
    } finally {
      if (requestGuard.isCurrent(identity)) setLoading(false);
    }
  }, [filterMode, t, toast, pageParams, setPageInfo, requestGuard]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleApproveAndPostDraft = async (draft) => {
    setActionLoadingId(draft.id);
    try {
      // 1. Approve
      await approveDeliveryDraft(draft.id);
      // 2. Post to SAP
      const posted = await postDeliveryToSap(draft.id);
      toast.success(
        lang === 'ar'
          ? `تم اعتماد وترحيل إذن التسليم #${posted.sap_doc_num || ''} بنجاح إلى SAP!`
          : `Delivery Note #${posted.sap_doc_num || ''} approved and posted to SAP!`
      );
      await loadOrders();
    } catch (err) {
      console.error('Failed to approve and post delivery:', err);
      const msg = err.response?.data?.error || err.message || (lang === 'ar' ? 'فشل الترحيل إلى SAP' : 'Failed to post to SAP');
      toast.error(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRejectDraft = async () => {
    if (!rejectModalDraft) return;
    if (!rejectionReason.trim()) {
      toast.error(lang === 'ar' ? 'يرجى إدخال سبب الرفض' : 'Rejection reason is required');
      return;
    }
    setActionLoadingId(rejectModalDraft.id);
    try {
      await rejectDeliveryDraft(rejectModalDraft.id, rejectionReason.trim());
      toast.success(lang === 'ar' ? 'تم رفض مسودة التسليم بنجاح' : 'Delivery draft rejected');
      setRejectModalDraft(null);
      setRejectionReason('');
      await loadOrders();
    } catch (err) {
      console.error('Failed to reject delivery draft:', err);
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredOrders = orders;

  return (
    <div className="shipping-delivery-page page-shell sales-readiness-workflow">
      <PageHeader
        eyebrow={lang === 'ar' ? 'المرحلة ٣: التسليم' : 'Layer 3: Delivery'}
        title={t('customizationDelivery.deliveryTitle')}
        description={t('customizationDelivery.deliverySubtitle')}
        actions={
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
        }
      />

      {/* Tabs and Search */}
      <ShippingDeliveryHandoff />
      <section className="card-panel" style={{ padding: '14px 18px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'active' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('active')}
            >
              {lang === 'ar' ? 'أوامر بانتظار التسليم (كميات متبقية)' : 'Active (Remaining Open Qty)'} ({counts.active})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'completed' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('completed')}
            >
              {lang === 'ar' ? 'مكتملة التسليم' : 'Fully Delivered'} ({counts.completed})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'all' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('all')}
            >
              {lang === 'ar' ? 'جميع الأوامر' : 'All Orders'} ({counts.total})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${filterMode === 'pending' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setFilterMode('pending')}
            >
              <ClipboardCheck size={14} style={{ marginInlineEnd: 4 }} />
              {lang === 'ar' ? 'مسودات بانتظار الاعتماد' : 'Pending Review'} ({pendingDrafts.length})
            </button>
          </div>

          <div style={{ flex: '1 1 240px', maxWidth: '360px' }}>
            <input
              type="search"
              className="app-input"
              placeholder={lang === 'ar' ? 'بحث برقم أمر البيع أو العميل...' : 'Search by order # or customer...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Orders or Pending Drafts Cards Grid */}
      {loading && orders.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <CircularProgress size={24} />
          <div style={{ marginTop: '12px', color: 'var(--text-muted)' }}>{t('common.loading')}</div>
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
      ) : filterMode === 'pending' ? (
        pendingDrafts.length === 0 ? (
          <EmptyState
            title={lang === 'ar' ? 'لا توجد مسودات تسليم بانتظار الاعتماد' : 'No Pending Delivery Drafts'}
            description={
              lang === 'ar'
                ? 'عندما يقدم المشغل مسودة تسليم، ستظهر هنا لمراجعتها واعتمادها وترحيلها إلى SAP.'
                : 'When operators submit delivery drafts for review, they will appear here for manager review and posting.'
            }
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: '20px' }}>
            {pendingDrafts.map((d) => {
              const totalDraftQty = (d.lines || []).reduce((sum, l) => sum + (Number(l.delivery_quantity) || 0), 0);
              const isSubmittingThis = actionLoadingId === d.id;

              return (
                <div
                  key={d.id}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '8px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          color: 'var(--accent-warning, #f59e0b)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <ClipboardCheck size={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-heading)' }}>
                          {lang === 'ar' ? 'مسودة تسليم' : 'Delivery Draft'} #{d.id}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {lang === 'ar' ? 'لأمر البيع' : 'For Order'} #{d.sales_order_doc_num} (SAP DocEntry: {d.sales_order_doc_entry})
                        </div>
                      </div>
                    </div>
                    <span className="badge badge--warning">
                      {lang === 'ar' ? 'بانتظار الاعتماد' : 'Pending Review'}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.9rem', display: 'grid', gap: '8px', color: 'var(--text)' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">🏢</span>
                        {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                      </span>
                      <strong>{d.customer_name || d.customer_code}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">📅</span>
                        {lang === 'ar' ? 'تاريخ الترحيل: ' : 'Posting Date: '}
                      </span>
                      <span>{d.doc_date || '—'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">👤</span>
                        {lang === 'ar' ? 'بواسطة: ' : 'Created By: '}
                      </span>
                      <span>{d.created_by || '—'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">📊</span>
                        {lang === 'ar' ? 'الكمية الجاهزة للتسليم: ' : 'Delivery Qty: '}
                      </span>
                      <strong style={{ color: 'var(--primary)', fontSize: '1rem' }}>{totalDraftQty}</strong>
                    </div>
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {isManager ? (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <button
                            type="button"
                            className="app-button app-button--primary"
                            onClick={() => handleApproveAndPostDraft(d)}
                            disabled={isSubmittingThis}
                            style={{ padding: '8px 12px', fontSize: '0.88rem' }}
                          >
                            {isSubmittingThis ? (
                              <CircularProgress size={16} color="inherit" />
                            ) : (
                              <>
                                <Check size={16} />
                                <span style={{ marginInlineStart: '6px' }}>
                                  {lang === 'ar' ? 'اعتماد وترحيل' : 'Approve & Post'}
                                </span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            className="app-button app-button--danger"
                            onClick={() => setRejectModalDraft(d)}
                            disabled={isSubmittingThis}
                            style={{ padding: '8px 12px', fontSize: '0.88rem' }}
                          >
                            <X size={16} />
                            <span style={{ marginInlineStart: '6px' }}>
                              {lang === 'ar' ? 'رفض' : 'Reject'}
                            </span>
                          </button>
                        </div>
                        <button
                          type="button"
                          className="app-button app-button--secondary app-button--compact"
                          onClick={() => navigate(`/customization-delivery/deliveries/new/${d.sales_order_doc_entry}`)}
                          style={{ width: '100%' }}
                        >
                          <FileText size={15} />
                          <span style={{ marginInlineStart: '6px' }}>
                            {lang === 'ar' ? 'فتح معالج التسليم للفحص / التعديل' : 'Open in Wizard to Inspect'}
                          </span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="app-button app-button--secondary"
                        onClick={() => navigate(`/customization-delivery/deliveries/new/${d.sales_order_doc_entry}`)}
                        style={{ width: '100%' }}
                      >
                        <FileText size={15} />
                        <span style={{ marginInlineStart: '6px' }}>
                          {lang === 'ar' ? 'تعديل المسودة في المعالج' : 'Edit Draft in Wizard'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={
            filterMode === 'active'
              ? (lang === 'ar' ? 'لا توجد أوامر بيع تتطلب تسليماً حالياً' : 'No Sales Orders Awaiting Delivery')
              : (lang === 'ar' ? 'لا توجد أوامر بيع مطابقة' : 'No matching sales orders')
          }
          description={
            lang === 'ar'
              ? 'يتم إدراج أوامر البيع المنشأة عبر نظامنا هنا تلقائياً ما دامت الكمية المتبقية أكبر من الصفر'
              : 'Sales orders created through our workflow appear here as long as Remaining Open Quantity > 0'
          }
          actionLabel={lang === 'ar' ? 'الذهاب إلى أوامر البيع' : 'Go to Sales Orders'}
          onAction={() => navigate('/customization-delivery/orders')}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: '20px' }}>
          {filteredOrders.map((order) => {
            const totalOrdered = Number(order.ordered_quantity) || 0;
            const totalDelivered = Number(order.delivered_quantity) || 0;
            const remaining = Number(order.remaining_open_quantity) || 0;
            const percent = totalOrdered > 0 ? Math.min(100, Math.round((totalDelivered / totalOrdered) * 100)) : 0;

            return (
              <div
                key={order.sales_order_doc_entry}
                className="card-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  padding: '20px',
                  border: order.has_remaining
                    ? '1px solid var(--primary, #3b82f6)'
                    : '1px solid var(--border)',
                  borderRadius: '12px',
                  background: 'var(--bg-elevated)',
                  boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.1))',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
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
                        {order.quotation_doc_num && (
                          <span> • {lang === 'ar' ? 'من عرض سعر' : 'From Quotation'} #{order.quotation_doc_num}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    {order.has_remaining ? (
                      <span className="badge badge--warning">
                        {lang === 'ar' ? `متبقي: ${remaining}` : `Remaining: ${remaining}`}
                      </span>
                    ) : (
                      <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={13} />
                        <span>{lang === 'ar' ? 'مكتمل التسليم' : 'Fully Delivered'}</span>
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
                      <span className="meta-label-icon" aria-hidden="true">{getProductIcon(order.items_summary)}</span>
                      {lang === 'ar' ? 'الأصناف: ' : 'Items: '}
                    </span>
                    <span>{order.items_summary || (lang === 'ar' ? 'أصناف العرض' : 'Order items')}</span>
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
                </div>

                {/* Actions */}
                <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {order.has_remaining ? (
                    <>
                      <button
                        type="button"
                        className="app-button app-button--primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/customization-delivery/deliveries/new/${order.sales_order_doc_entry}`);
                        }}
                        style={{
                          width: '100%',
                          fontSize: '0.95rem',
                          padding: '10px',
                          pointerEvents: 'auto',
                          cursor: 'pointer',
                        }}
                      >
                        <Truck size={17} />
                        <span style={{ marginInlineStart: '8px' }}>
                          {lang === 'ar' ? 'إنشاء إذن تسليم في SAP' : 'Create Delivery Note in SAP'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="app-button app-button--secondary app-button--compact"
                        onClick={() => navigate(`/customization-delivery/delivery/documents/${order.sales_order_doc_entry}`)}
                        style={{ width: '100%' }}
                      >
                        <FileText size={15} />
                        <span style={{ marginInlineStart: '6px' }}>
                          {lang === 'ar' ? 'سجل التسليمات السابقة' : 'Delivery History'}
                        </span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="app-button app-button--secondary"
                      onClick={() => navigate(`/customization-delivery/delivery/documents/${order.sales_order_doc_entry}`)}
                      style={{ width: '100%' }}
                    >
                      <FileText size={16} />
                      <span style={{ marginInlineStart: '6px' }}>
                        {lang === 'ar' ? 'عرض تفاصيل وسجل التسليم' : 'View Delivery Details & History'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manager Reject Modal */}
      {rejectModalDraft && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setRejectModalDraft(null)}
        >
          <div
            className="card-panel"
            style={{
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              borderRadius: '12px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', color: 'var(--text-heading)' }}>
              {lang === 'ar' ? 'رفض مسودة التسليم' : 'Reject Delivery Draft'} #{rejectModalDraft.id}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
              {lang === 'ar'
                ? 'يرجى كتابة سبب رفض المسودة لإعادتها للمُشغّل للتعديل.'
                : 'Please specify the reason for rejection to return the draft for editing.'}
            </p>
            <textarea
              className="app-input"
              rows={3}
              placeholder={lang === 'ar' ? 'سبب الرفض...' : 'Reason for rejection...'}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              style={{ marginBottom: '20px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => setRejectModalDraft(null)}
                disabled={actionLoadingId !== null}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="app-button app-button--danger"
                onClick={handleRejectDraft}
                disabled={actionLoadingId !== null || !rejectionReason.trim()}
              >
                {actionLoadingId === rejectModalDraft.id ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  (lang === 'ar' ? 'تأكيد الرفض' : 'Confirm Reject')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <WorkflowPagination paging={paging} loading={loading} />
    </div>
  );
}
