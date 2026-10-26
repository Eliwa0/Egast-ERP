import '../styles/pages/sales-readiness.css';
import useWorkflowPagination from '../hooks/useWorkflowPagination';
import WorkflowPagination from '../components/ui/WorkflowPagination';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import {
  Plus,
  RefreshCw,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  Search,
  Check,
  X,
  Send,
  FileCheck,
  Truck,
  Printer,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { canManageCustomization } from '../utils/roles';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { getProductIcon } from '../utils/productIcon';
import SalesDocumentPrintable from '../components/print/SalesDocumentPrintable';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import {
  fetchCustomizationDrafts,
  submitCustomizationDraft,
  approveCustomizationDraft,
  rejectCustomizationDraft,
  recordCustomerApproval,
  createSalesOrder,
  fetchSalesOrderDocument,
} from '../services/customizationDeliveryService';
import '../styles/pages/quality-inspection.css';
import '../styles/pages/customization-delivery-landing.css';

export default function SalesQuotationsPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const isManager = canManageCustomization(user);

  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');
  const [serverCounts, setServerCounts] = useState(null);
  const paging = useWorkflowPagination(search, activeTab);
  const { params: pageParams, setInfo: setPageInfo, requestGuard } = paging;

  // Action loading state
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Customer Approval Modal state
  const [approvalModalDraft, setApprovalModalDraft] = useState(null);
  const [approvalType, setApprovalType] = useState('PURCHASE_ORDER');
  const [refNumber, setRefNumber] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');

  // Manager Reject Modal state
  const [rejectModalDraft, setRejectModalDraft] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Order Creation Success Modal & Print state
  const [createdOrderSuccess, setCreatedOrderSuccess] = useState(null);
  const [isPrintingOrder, setIsPrintingOrder] = useState(false);
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const handlePrintOrder = async () => {
    if (!createdOrderSuccess) return;
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Please allow popups for printing.');
      return;
    }
    setIsPrintingOrder(true);
    try {
      const document = await fetchSalesOrderDocument(createdOrderSuccess.orderDocEntry);
      setPrintRequest({ printWindow, document,
        generatedAt: new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') });
    } catch (error) {
      printWindow.close();
      toast.error(error.response?.data?.error || t('common.errorLoadingData'));
      setIsPrintingOrder(false);
    }
  };

  useEffect(() => {
    if (!printRequest) return undefined;
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
      setIsPrintingOrder(false);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [printRequest, t, toast, lang]);

  const loadDrafts = useCallback(async () => {
    const identity = requestGuard.begin();
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomizationDrafts({ ...pageParams, tab: activeTab });
      if (!requestGuard.isCurrent(identity)) return;
      setDrafts(data || []);
      setPageInfo(data?.pagination);
      setServerCounts(data?.workflowCounts || null);
    } catch (err) {
      if (!requestGuard.isCurrent(identity)) return;
      console.error('Failed to load quotation drafts:', err);
      const msg = err.response?.data?.error || t('common.errorLoadingData');
      setError(msg);
      toast.error(msg);
    } finally {
      if (requestGuard.isCurrent(identity)) setLoading(false);
    }
  }, [t, toast, pageParams, setPageInfo, requestGuard, activeTab]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // Tab counts
  const counts = useMemo(() => {
    if (serverCounts) return serverCounts;
    const all = drafts || [];
    const inReview = all.filter((d) =>
      ['DRAFT', 'PENDING_INTERNAL_REVIEW', 'INTERNAL_REJECTED'].includes(d.status)
    ).length;
    const approved = all.filter((d) =>
      ['INTERNAL_APPROVED', 'WAITING_CUSTOMER_APPROVAL'].includes(d.status)
    ).length;
    const ready = all.filter((d) => d.status === 'READY_FOR_ORDER').length;
    const ordered = all.filter((d) => d.status === 'ORDER_POSTED').length;
    return { all: all.length, inReview, approved, ready, ordered };
  }, [drafts, serverCounts]);

  // Filtered list
  const filteredDrafts = useMemo(() => {
    let list = drafts || [];
    if (activeTab === 'IN_REVIEW') {
      list = list.filter((d) =>
        ['DRAFT', 'PENDING_INTERNAL_REVIEW', 'INTERNAL_REJECTED'].includes(d.status)
      );
    } else if (activeTab === 'APPROVED') {
      list = list.filter((d) =>
        ['INTERNAL_APPROVED', 'WAITING_CUSTOMER_APPROVAL'].includes(d.status)
      );
    } else if (activeTab === 'READY') {
      list = list.filter((d) => ['READY_FOR_ORDER', 'ORDER_POSTING'].includes(d.status));
    } else if (activeTab === 'ORDERED') {
      list = list.filter((d) => d.status === 'ORDER_POSTED');
    }

    return list;
  }, [drafts, activeTab]);

  // Actions
  const handleSubmitReview = async (draftId) => {
    setActionLoadingId(draftId);
    try {
      await submitCustomizationDraft(draftId);
      toast.success(
        lang === 'ar'
          ? 'تم تقديم عرض السعر للمراجعة الداخلية بنجاح'
          : 'Sales quotation submitted for internal review'
      );
      await loadDrafts();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleManagerApprove = async (draftId) => {
    setActionLoadingId(draftId);
    try {
      await approveCustomizationDraft(draftId);
      toast.success(
        lang === 'ar'
          ? 'تم اعتماد عرض السعر داخلياً وهو بانتظار موافقة العميل'
          : 'Quotation approved internally, awaiting customer approval'
      );
      await loadDrafts();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleManagerReject = async () => {
    if (!rejectModalDraft) return;
    if (!rejectionReason.trim()) {
      toast.error(lang === 'ar' ? 'يرجى كتابة سبب الرفض' : 'Rejection reason is required');
      return;
    }
    setActionLoadingId(rejectModalDraft.id);
    try {
      await rejectCustomizationDraft(rejectModalDraft.id, rejectionReason.trim());
      toast.success(lang === 'ar' ? 'تم رفض عرض السعر' : 'Quotation rejected');
      setRejectModalDraft(null);
      setRejectionReason('');
      await loadDrafts();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCustomerApprovalSubmit = async (e) => {
    e.preventDefault();
    if (!approvalModalDraft) return;
    setActionLoadingId(approvalModalDraft.id);
    try {
      await recordCustomerApproval(approvalModalDraft.id, {
        approval_type: approvalType,
        reference_number: refNumber.trim(),
        contact_person: contactPerson.trim(),
        notes: approvalNotes.trim(),
      });
      toast.success(
        lang === 'ar'
          ? 'تم تسجيل موافقة العميل بنجاح! عرض السعر جاهز للتحويل إلى أمر بيع.'
          : 'Customer approval recorded! Quotation is ready for Sales Order creation.'
      );
      setApprovalModalDraft(null);
      setRefNumber('');
      setContactPerson('');
      setApprovalNotes('');
      await loadDrafts();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCreateSalesOrder = async (draft) => {
    if (!draft?.id) return;
    setActionLoadingId(draft.id);
    try {
      const result = await createSalesOrder(draft.id);
      const orderDocNum = result?.sap_order_doc_num || result?.draft?.sap_order_doc_num || '';
      setCreatedOrderSuccess({
        orderDocNum,
        orderDocEntry: result?.sap_order_doc_entry || result?.draft?.sap_order_doc_entry,
        draft: result?.draft || result || draft,
      });
      toast.success(
        lang === 'ar'
          ? `تم إنشاء أمر البيع #${orderDocNum} في SAP بنجاح!`
          : `Sales Order #${orderDocNum} created in SAP successfully!`
      );
      await loadDrafts();
    } catch (err) {
      console.error('Failed to create sales order:', err);
      toast.error(
        err.response?.data?.error ||
        err.message ||
        (lang === 'ar' ? 'فشل إنشاء أمر البيع' : 'Failed to create sales order')
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const getStatusBadge = (status, orderNum) => {
    switch (status) {
      case 'DRAFT':
        return (
          <span className="badge badge--neutral">
            {lang === 'ar' ? 'مسودة جديدة' : 'Draft'}
          </span>
        );
      case 'PENDING_INTERNAL_REVIEW':
        return (
          <span className="badge badge--warning">
            {lang === 'ar' ? 'بانتظار مراجعة المدير' : 'Pending Review'}
          </span>
        );
      case 'INTERNAL_APPROVED':
        return (
          <span className="badge badge--info">
            {lang === 'ar' ? 'معتمد داخلياً (بانتظار العميل)' : 'Manager Approved'}
          </span>
        );
      case 'INTERNAL_REJECTED':
        return (
          <span className="badge badge--danger">
            {lang === 'ar' ? 'مرفوض' : 'Rejected'}
          </span>
        );
      case 'WAITING_CUSTOMER_APPROVAL':
        return (
          <span className="badge badge--info">
            {lang === 'ar' ? 'بانتظار موافقة العميل' : 'Waiting Customer Approval'}
          </span>
        );
      case 'READY_FOR_ORDER':
        return (
          <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <FileCheck size={13} />
            <span>{lang === 'ar' ? 'منشأ في SAP • جاهز للطلب' : 'SAP Created • Ready for Order'}</span>
          </span>
        );
      case 'ORDER_POSTED':
        return (
          <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={13} />
            <span>{lang === 'ar' ? `تم إنشاء أمر بيع #${orderNum || ''}` : `Order #${orderNum || ''} Created`}</span>
          </span>
        );
      default:
        return <span className="badge badge--neutral">{status}</span>;
    }
  };

  return (
    <div className="shipping-delivery-page page-shell sales-readiness-workflow">
      <PageHeader
        eyebrow={lang === 'ar' ? 'المرحلة ١: عروض الأسعار' : 'Layer 1: Sales Quotations'}
        title={t('customizationDelivery.quotationsTitle')}
        description={
          lang === 'ar'
            ? 'إدارة دورة عمل عروض أسعار البيع: الإنشاء المباشر في SAP Business One والتحويل الفوري إلى أوامر بيع.'
            : 'Manage sales quotations: direct creation in SAP Business One and instant conversion to Sales Orders.'
        }
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={loadDrafts}
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
              className="app-button app-button--primary app-button--compact"
              onClick={() => navigate('/customization-delivery/quotations/new')}
            >
              <Plus size={16} />
              <span style={{ marginInlineStart: '6px' }}>
                {lang === 'ar' ? 'إنشاء عرض سعر جديد' : 'New Sales Quotation'}
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
              className={`app-button app-button--compact ${activeTab === 'ALL' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setActiveTab('ALL')}
            >
              {lang === 'ar' ? 'الكل' : 'All'} ({counts.all})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${activeTab === 'IN_REVIEW' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setActiveTab('IN_REVIEW')}
            >
              {lang === 'ar' ? 'قيد المراجعة' : 'In Review'} ({counts.inReview})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${activeTab === 'APPROVED' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setActiveTab('APPROVED')}
            >
              {lang === 'ar' ? 'معتمد / موافقة العميل' : 'Customer Approval'} ({counts.approved})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${activeTab === 'READY' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setActiveTab('READY')}
            >
              {lang === 'ar' ? 'جاهز لأمر البيع' : 'Ready for Order'} ({counts.ready})
            </button>
            <button
              type="button"
              className={`app-button app-button--compact ${activeTab === 'ORDERED' ? 'app-button--primary' : 'app-button--secondary'}`}
              onClick={() => setActiveTab('ORDERED')}
            >
              {lang === 'ar' ? 'تم إنشاء أمر البيع' : 'Orders Created'} ({counts.ordered})
            </button>
          </div>

          <div style={{ flex: '1 1 240px', maxWidth: '360px' }}>
            <input
              type="search"
              className="app-input"
              placeholder={lang === 'ar' ? 'بحث برقم العرض أو أمر البيع أو العميل...' : 'Search by quotation #, order # or customer...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Quotations Grid */}
      {loading && drafts.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <AppSpinner size="md" label={t('common.loading')} />
          <LoadingSkeleton rows={5} style={{ width: '100%', maxWidth: '800px' }} />
        </section>
      ) : error && drafts.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
          <button type="button" className="app-button app-button--primary" onClick={loadDrafts}>
            {t('common.retry')}
          </button>
        </section>
      ) : filteredDrafts.length === 0 ? (
        <EmptyState
          title={
            activeTab === 'READY'
              ? (lang === 'ar' ? 'لا توجد عروض أسعار جاهزة لإنشاء أمر بيع حالياً' : 'No Quotations Ready for Order')
              : (lang === 'ar' ? 'لا توجد عروض أسعار مسجلة في هذا التبويب' : 'No Sales Quotations Found')
          }
          description={
            lang === 'ar'
              ? 'يمكنك إنشاء عرض سعر جديد واختيار العميل والأصناف لبدء مسار الاعتماد.'
              : 'Create a new Sales Quotation with customer and items to initiate the workflow.'
          }
          actionLabel={lang === 'ar' ? 'إنشاء عرض سعر جديد' : 'Create Sales Quotation'}
          onAction={() => navigate('/customization-delivery/quotations/new')}
        />
      ) : (
        <div className="quotations-grid">
          {filteredDrafts.map((draft) => {
            const isActing = actionLoadingId === draft.id;
            const itemsSummary = (draft.lines || [])
              .map((l) => l.item_description || l.item_code)
              .filter(Boolean)
              .slice(0, 3)
              .join(', ') + ((draft.lines || []).length > 3 ? ` (+${draft.lines.length - 3} more)` : '');

            return (
              <div
                key={draft.id}
                className="card-panel quotation-card"
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
                        background: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.08))',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <FileText size={20} />
                    </div>
                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-heading, var(--text))' }}>
                        {draft.quotation_doc_num
                          ? (lang === 'ar' ? `عرض سعر #${draft.quotation_doc_num}` : `Quotation #${draft.quotation_doc_num}`)
                          : (lang === 'ar' ? `مسودة عرض سعر #${draft.id}` : `Quotation Draft #${draft.id}`)}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {draft.quotation_doc_entry ? `SAP DocEntry: ${draft.quotation_doc_entry} • ` : ''}
                        {draft.quotation_doc_date || draft.created_at ? String(draft.quotation_doc_date || draft.created_at).split('T')[0] : '—'}
                      </div>
                    </div>
                  </div>
                  <div>
                    {getStatusBadge(draft.status, draft.sap_order_doc_num)}
                  </div>
                </div>

                {/* Customer & Details */}
                <div style={{ fontSize: '0.9rem', display: 'grid', gap: '8px', color: 'var(--text)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🏢</span>
                      {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                    </span>
                    <strong style={{ color: 'var(--text)' }}>{draft.customer_name || draft.customer_code}</strong>
                    {draft.customer_name && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginInlineStart: '6px' }}>
                        ({draft.customer_code})
                      </span>
                    )}
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginInlineEnd: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">{getProductIcon(itemsSummary)}</span>
                      {lang === 'ar' ? 'الأصناف: ' : 'Items: '}
                    </span>
                    <span style={{ color: 'var(--text)' }}>{itemsSummary || (lang === 'ar' ? 'أصناف العرض' : 'Quotation items')}</span>
                  </div>

                  {/* Metrics Box */}
                  <div className="quotation-card__metrics">
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">📊</span>
                        {lang === 'ar' ? 'إجمالي الكمية' : 'Total Quantity'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>
                        {draft.total_quantity || 0}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="meta-label-icon" aria-hidden="true">💰</span>
                        {lang === 'ar' ? 'إجمالي القيمة' : 'Total Amount'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary)' }}>
                        {draft.total_amount ? `${draft.currency || ''} ${draft.total_amount}`.trim() : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Audit Trail Note if available */}
                  {draft.internal_reviewed_by && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="meta-label-icon" aria-hidden="true">👤</span>
                      <span>{lang === 'ar' ? 'اعتمد بواسطة: ' : 'Reviewed by: '}</span>
                      <strong style={{ color: 'var(--text)' }}>{draft.internal_reviewed_by}</strong>
                    </div>
                  )}
                  {draft.customer_reference_number && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--success, #16803c)' }}>
                      ✓ {lang === 'ar' ? 'موافقة العميل (أمر الشراء): ' : 'Customer PO Ref: '}
                      <strong style={{ color: 'var(--text)' }}>{draft.customer_reference_number}</strong>
                    </div>
                  )}
                </div>

                {/* Workflow Actions */}
                <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {draft.status === 'DRAFT' && (
                    <button
                      type="button"
                      className="app-button app-button--primary"
                      onClick={() => handleSubmitReview(draft.id)}
                      disabled={isActing}
                      style={{ width: '100%', padding: '10px' }}
                    >
                      {isActing ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <>
                          <Send size={16} />
                          <span style={{ marginInlineStart: '6px' }}>
                            {lang === 'ar' ? 'تقديم للمراجعة الداخلية' : 'Submit for Internal Review'}
                          </span>
                        </>
                      )}
                    </button>
                  )}

                  {draft.status === 'PENDING_INTERNAL_REVIEW' && (
                    isManager ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          className="app-button app-button--primary"
                          onClick={() => handleManagerApprove(draft.id)}
                          disabled={isActing}
                          style={{ padding: '8px 12px', fontSize: '0.88rem' }}
                        >
                          {isActing ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <>
                              <Check size={16} />
                              <span style={{ marginInlineStart: '6px' }}>
                                {lang === 'ar' ? 'اعتماد المدير' : 'Manager Approve'}
                              </span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="app-button app-button--danger"
                          onClick={() => setRejectModalDraft(draft)}
                          disabled={isActing}
                          style={{ padding: '8px 12px', fontSize: '0.88rem' }}
                        >
                          <X size={16} />
                          <span style={{ marginInlineStart: '6px' }}>
                            {lang === 'ar' ? 'رفض' : 'Reject'}
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div style={{ padding: '8px', borderRadius: '6px', background: 'var(--bg-warning-soft, rgba(245, 158, 11, 0.08))', color: 'var(--warning, #f59e0b)', border: '1px solid var(--warning-border, rgba(183, 121, 31, 0.35))', fontSize: '0.85rem', textAlign: 'center' }}>
                        ⏳ {lang === 'ar' ? 'بانتظار مراجعة واعتماد المدير' : 'Awaiting Manager Review'}
                      </div>
                    )
                  )}

                  {['INTERNAL_APPROVED', 'WAITING_CUSTOMER_APPROVAL'].includes(draft.status) && (
                    <button
                      type="button"
                      className="app-button app-button--primary"
                      onClick={() => setApprovalModalDraft(draft)}
                      disabled={isActing}
                      style={{ width: '100%', padding: '10px' }}
                    >
                      <FileCheck size={16} />
                      <span style={{ marginInlineStart: '6px' }}>
                        {lang === 'ar' ? 'تسجيل موافقة العميل' : 'Record Customer Approval'}
                      </span>
                    </button>
                  )}

                  {['READY_FOR_ORDER', 'ORDER_POSTING'].includes(draft.status) && (
                    <button
                      type="button"
                      className="app-button app-button--primary"
                      onClick={() => handleCreateSalesOrder(draft)}
                      disabled={isActing}
                      style={{ width: '100%', padding: '10px' }}
                    >
                      {isActing ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <>
                          <CheckCircle2 size={16} />
                          <span style={{ marginInlineStart: '6px' }}>
                            {draft.status === 'ORDER_POSTING' ? t('customizationDelivery.checkPosting') : (lang === 'ar' ? 'إنشاء أمر البيع في SAP (BaseType: 23)' : 'Create Sales Order in SAP')}
                          </span>
                        </>
                      )}
                    </button>
                  )}

                  {draft.status === 'ORDER_POSTED' && (
                    <button
                      type="button"
                      className="app-button app-button--secondary"
                      onClick={() => navigate('/customization-delivery/orders')}
                      style={{ width: '100%', padding: '10px' }}
                    >
                      <Truck size={16} />
                      <span style={{ marginInlineStart: '6px' }}>
                        {lang === 'ar'
                          ? `عرض أمر البيع #${draft.sap_order_doc_num} في شاشة الأوامر`
                          : `View Sales Order #${draft.sap_order_doc_num} in Orders`}
                      </span>
                    </button>
                  )}

                  {/* Link to detail if SAP document exists */}
                  {draft.quotation_doc_entry && (
                    <button
                      type="button"
                      className="app-button app-button--secondary app-button--compact"
                      onClick={() => navigate(`/customization-delivery/customization/documents/${draft.quotation_doc_entry}`)}
                      style={{ width: '100%' }}
                    >
                      <FileText size={15} />
                      <span style={{ marginInlineStart: '6px' }}>
                        {lang === 'ar' ? 'تفاصيل العرض الكاملة' : 'View Full Details'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Customer Approval Modal */}
      {approvalModalDraft && (
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
          onClick={() => setApprovalModalDraft(null)}
        >
          <div
            className="card-panel"
            style={{
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              borderRadius: '12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', color: 'var(--text-heading, var(--text))' }}>
              {lang === 'ar' ? 'تسجيل موافقة العميل على عرض السعر' : 'Record Customer Approval'} #{approvalModalDraft.quotation_doc_num || approvalModalDraft.id}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '20px' }}>
              {lang === 'ar'
                ? 'أدخل بيانات أمر الشراء أو الموافقة الواردة من العميل لتفعيل إمكانية إنشاء أمر البيع.'
                : 'Enter customer purchase order or approval confirmation to enable Sales Order creation.'}
            </p>

            <form onSubmit={handleCustomerApprovalSubmit}>
              <div style={{ display: 'grid', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: 'var(--text)' }}>
                    {lang === 'ar' ? 'طريقة الموافقة *' : 'Approval Method *'}
                  </label>
                  <select
                    className="app-input"
                    value={approvalType}
                    onChange={(e) => setApprovalType(e.target.value)}
                  >
                    <option value="PURCHASE_ORDER">{lang === 'ar' ? 'أمر شراء من العميل (Customer PO)' : 'Customer Purchase Order'}</option>
                    <option value="EMAIL">{lang === 'ar' ? 'تأكيد عبر البريد الإلكتروني (Email)' : 'Email Confirmation'}</option>
                    <option value="SIGNED_PROPOSAL">{lang === 'ar' ? 'عرض سعر موقع ومختوم (Signed Proposal)' : 'Signed Proposal'}</option>
                    <option value="VERBAL_CONFIRMATION">{lang === 'ar' ? 'تأكيد شفهي معتمد (Verbal/Phone)' : 'Verbal Confirmation'}</option>
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: 'var(--text)' }}>
                    {lang === 'ar' ? 'رقم أمر الشراء / المرجع *' : 'PO / Reference Number *'}
                  </label>
                  <input
                    type="text"
                    required
                    className="app-input"
                    placeholder={lang === 'ar' ? 'مثال: PO-2026-9812' : 'e.g. PO-2026-9812'}
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: 'var(--text)' }}>
                    {lang === 'ar' ? 'اسم الشخص المسؤول لدى العميل' : 'Contact Person'}
                  </label>
                  <input
                    type="text"
                    className="app-input"
                    placeholder={lang === 'ar' ? 'اسم ممثل العميل...' : 'Client representative name...'}
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: 'var(--text)' }}>
                    {lang === 'ar' ? 'ملاحظات إضافية' : 'Approval Notes'}
                  </label>
                  <textarea
                    className="app-input"
                    rows={2}
                    placeholder={lang === 'ar' ? 'أي شروط أو ملاحظات خاصة...' : 'Any terms or notes...'}
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() => setApprovalModalDraft(null)}
                  disabled={actionLoadingId !== null}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="app-button app-button--primary"
                  disabled={actionLoadingId !== null || !refNumber.trim()}
                >
                  {actionLoadingId === approvalModalDraft.id ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    (lang === 'ar' ? 'حفظ واعتماد العميل' : 'Save & Confirm')
                  )}
                </button>
              </div>
            </form>
          </div>
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
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', color: 'var(--text-heading, var(--text))' }}>
              {lang === 'ar' ? 'رفض عرض السعر' : 'Reject Quotation'} #{rejectModalDraft.quotation_doc_num || rejectModalDraft.id}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
              {lang === 'ar'
                ? 'يرجى كتابة سبب رفض عرض السعر لإعادته للمسؤول لتعديله.'
                : 'Please specify the rejection reason to return the quotation for revision.'}
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
                onClick={handleManagerReject}
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

      {/* Sales Order Creation Success & Print Modal */}
      {createdOrderSuccess && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setCreatedOrderSuccess(null)}
        >
          <div
            className="card-panel"
            style={{
              maxWidth: '540px',
              width: '100%',
              padding: '28px',
              borderRadius: '12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.12)',
                color: 'var(--accent-success, #22c55e)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <CheckCircle2 size={36} />
            </div>

            <h3 style={{ margin: '0 0 10px', color: 'var(--text-heading, var(--text))', fontSize: '1.25rem' }}>
              {lang === 'ar'
                ? 'تم إنشاء أمر البيع بنجاح في SAP Business One!'
                : 'Sales Order Created Successfully in SAP!'}
            </h3>

            <div
              style={{
                padding: '14px 18px',
                borderRadius: '8px',
                background: 'var(--bg-muted, rgba(255, 255, 255, 0.03))',
                border: '1px solid var(--border)',
                margin: '18px 0',
                textAlign: 'start',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.92rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ar' ? 'رقم أمر البيع: ' : 'Sales Order #: '}
                  </span>
                  <strong style={{ color: 'var(--primary)', fontSize: '1.15rem' }}>
                    #{createdOrderSuccess.orderDocNum}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>SAP DocEntry: </span>
                  <strong>{createdOrderSuccess.orderDocEntry || '—'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ar' ? 'العميل: ' : 'Customer: '}
                  </span>
                  <strong>
                    {createdOrderSuccess.draft?.customer_name || createdOrderSuccess.draft?.customer_code}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {lang === 'ar' ? 'عرض السعر المصدر: ' : 'Source Quotation: '}
                  </span>
                  <strong>#{createdOrderSuccess.draft?.quotation_doc_num || createdOrderSuccess.draft?.id}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>{t('common.total')}: </span>
                  <strong>{createdOrderSuccess.draft?.currency} {Number(createdOrderSuccess.draft?.total_amount || 0).toFixed(2)}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={handlePrintOrder}
                disabled={isPrintingOrder}
                aria-busy={isPrintingOrder ? 'true' : 'false'}
                style={{
                  padding: '10px 20px',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isPrintingOrder ? (
                  <>
                    <AppSpinner size="xs" />
                    <span style={{ marginInlineStart: '6px' }}>{t('common.preparingPrint')}</span>
                  </>
                ) : (
                  <>
                    <Printer size={18} />
                    <span style={{ marginInlineStart: '6px' }}>
                      {lang === 'ar' ? 'طباعة أمر البيع' : 'Print Sales Order'}
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => {
                  setCreatedOrderSuccess(null);
                  navigate('/customization-delivery/orders');
                }}
              >
                <Truck size={16} />
                <span style={{ marginInlineStart: '6px' }}>
                  {lang === 'ar' ? 'عرض أوامر البيع' : 'Go to Sales Orders'}
                </span>
              </button>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => setCreatedOrderSuccess(null)}
              >
                {lang === 'ar' ? 'إنهاء' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden printable sheet for Sales Order */}
      {printRequest && createdOrderSuccess && (
        <div ref={printContainerRef} aria-hidden="true" style={{ display: 'none' }}>
          <SalesDocumentPrintable
            document={{
              documentType: 'SALES_ORDER',
              docNum: printRequest.document.document_number,
              docEntry: printRequest.document.document_entry,
              customerName: printRequest.document.customer_name,
              customerCode: printRequest.document.customer_code,
              docDate: printRequest.document.document_date,
              dueDate: printRequest.document.due_date,
              currency: printRequest.document.currency,
              remarks: printRequest.document.remarks || '',
              baseDocumentNum: createdOrderSuccess.draft?.quotation_doc_num,
              lines: (printRequest.document.lines || []).map((l) => ({
                item_code: l.item_code,
                warehouse_code: l.warehouse_code,
                item_description: l.item_description,
                quantity: Number(l.quantity ?? 0),
                unit_price: Number(l.unit_price ?? 0),
                line_total: l.line_total,
                uom: l.uom,
              })),
              totalQuantity: printRequest.document.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
              totalAmount: printRequest.document.total_amount,
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
