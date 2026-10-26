import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { canManageCustomization } from '../../utils/roles';
import {
  fetchCustomizationDrafts,
  approveCustomizationDraft,
  rejectCustomizationDraft,
  recordCustomerApproval,
  createSalesOrder,
} from '../../services/customizationDeliveryService';
import LoadingSkeleton from '../ui/LoadingSkeleton';

export default function CustomizationWorkflowPanel({ quotation, onRefresh }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isManager = canManageCustomization(user);

  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modals & form state
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalData, setApprovalData] = useState({
    approval_type: 'PURCHASE_ORDER',
    reference_number: '',
    contact_person: '',
    notes: '',
  });

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [docDueDate, setDocDueDate] = useState('');

  const loadDraft = useCallback(async () => {
    if (!quotation?.document_entry) return;
    setLoading(true);
    setError('');
    try {
      const drafts = await fetchCustomizationDrafts({ quotation_doc_entry: quotation.document_entry });
      if (drafts && drafts.length > 0) {
        setDraft(drafts[0]);
      } else {
        setDraft(null);
      }
    } catch (err) {
      console.error('Error fetching customization draft:', err);
    } finally {
      setLoading(false);
    }
  }, [quotation?.document_entry]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  const handleApprove = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await approveCustomizationDraft(draft.id, approveNotes);
      setDraft(updated);
      setSuccessMsg(t('customizationDelivery.workflow.approve') + ' ' + t('common.success'));
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!draft || !rejectionReason.trim()) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await rejectCustomizationDraft(draft.id, rejectionReason.trim());
      setDraft(updated);
      setShowRejectModal(false);
      setRejectionReason('');
      setSuccessMsg(t('customizationDelivery.workflow.reject') + ' ' + t('common.success'));
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRecordCustomerApproval = async (e) => {
    e.preventDefault();
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await recordCustomerApproval(draft.id, approvalData);
      setDraft(updated);
      setShowApprovalModal(false);
      setSuccessMsg(t('customizationDelivery.workflow.recordCustomerApproval') + ' ' + t('common.success'));
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateOrder = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await createSalesOrder(draft.id, { doc_due_date: docDueDate || undefined });
      setDraft(updated);
      setSuccessMsg(t('customizationDelivery.workflow.salesOrderCreated') + ` #${updated.sap_order_doc_num}!`);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <LoadingSkeleton rows={2} />;
  }

  // If no draft exists yet, this is purely a SAP quotation view
  if (!draft) {
    return null;
  }

  const isPendingReview = draft.status === 'PENDING_INTERNAL_REVIEW';
  const isInternalApproved = draft.status === 'INTERNAL_APPROVED';
  const isWaitingCustomer = draft.status === 'WAITING_CUSTOMER_APPROVAL' || isInternalApproved;
  const isReadyForOrder = draft.status === 'READY_FOR_ORDER';
  const isOrderPosted = draft.status === 'ORDER_POSTED';

  return (
    <section className="card-panel cd-section cd-workflow-card" style={{ marginTop: 16 }}>
      {/* Workflow Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 className="cd-section__title" style={{ margin: 0 }}>
            {lang === 'ar' ? 'مراجعة عرض السعر' : 'Sales Quotation Review'} #{draft.quotation_doc_num || draft.id}
          </h2>
          <span className="cd-muted">
            {t('customizationDelivery.columns.quotationDate')}: {quotation.quotation_date || quotation.document_date || '—'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`cd-status cd-status--${draft.status.toLowerCase()}`}>
            {draft.status_display || draft.status}
          </span>
        </div>
      </div>

      {error && (
        <div className="cd-error" role="alert" style={{ marginBottom: 12 }}>
          <span>{error}</span>
          <button type="button" className="app-button app-button--ghost" onClick={() => setError('')}>
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', color: 'var(--text)', marginBottom: 12, fontSize: '0.85rem' }}>
          {successMsg}
        </div>
      )}

      {/* Internal Rejection Reason Banner */}
      {draft.internal_rejection_reason && draft.status === 'INTERNAL_REJECTED' && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid var(--danger)', marginBottom: 12 }}>
          <strong>{t('customizationDelivery.workflow.rejectionReason')}:</strong> {draft.internal_rejection_reason}
        </div>
      )}

      {/* Order Posted Banner */}
      {isOrderPosted && (
        <div style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', color: 'var(--success)' }}>
                ✓ {t('customizationDelivery.workflow.salesOrderCreated')}: #{draft.sap_order_doc_num}
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                SAP DocEntry: <strong>{draft.sap_order_doc_entry}</strong> | Customer Reference: <strong>{draft.customer_reference_number}</strong>
              </p>
              <p className="cd-muted" style={{ margin: '6px 0 0', fontSize: '0.82rem' }}>
                ℹ {t('customizationDelivery.workflow.relationshipChain')}: Quotation #{draft.quotation_doc_num} (DocEntry {draft.quotation_doc_entry}) ──[BaseType: 23]──&gt; Sales Order #{draft.sap_order_doc_num} (DocEntry {draft.sap_order_doc_entry})
              </p>
            </div>
            <button
              type="button"
              className="app-button app-button--primary"
              style={{ padding: '8px 16px', fontWeight: 600 }}
              onClick={() => navigate(`/customization-delivery/orders/documents/${draft.sap_order_doc_entry}`)}
            >
              ⚡ {t('customizationDelivery.workflow.viewOrder')} #{draft.sap_order_doc_num} →
            </button>
          </div>
        </div>
      )}

      {/* Strictly Read-Only Lines Table */}
      <div className="cd-table-wrap" style={{ marginBottom: 16 }}>
        <table className="cd-table">
          <thead>
            <tr>
              <th>{t('customizationDelivery.columns.line')}</th>
              <th>{t('customizationDelivery.columns.item')}</th>
              <th>{t('customizationDelivery.columns.description')}</th>
              <th>{t('customizationDelivery.columns.warehouse')}</th>
              <th>{lang === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
              <th>{t('customizationDelivery.columns.quantity')}</th>
              <th>{t('customizationDelivery.columns.unit')}</th>
              <th>{t('customizationDelivery.columns.unitPrice')}</th>
              <th>{lang === 'ar' ? 'رمز الضريبة' : 'Tax Code'}</th>
              <th>{lang === 'ar' ? 'العلامة' : 'Brand'}</th>
              <th>{lang === 'ar' ? 'المقاس' : 'Size'}</th>
              <th>{lang === 'ar' ? 'البالتات' : 'Pallets'}</th>
              <th>{t('customizationDelivery.workflow.packaging')}</th>
              <th>{t('customizationDelivery.columns.lineTotal')}</th>
              <th>{t('customizationDelivery.workflow.freeText')}</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines?.map((line) => {
              const qty = line.customized_quantity != null ? line.customized_quantity : line.original_quantity;
              const price = line.customized_unit_price != null ? line.customized_unit_price : line.original_unit_price;
              const lineTotal = (Number(qty || 0) * Number(price || 0)).toFixed(2);

              return (
                <tr key={line.id}>
                  <td>{line.line_number + 1}</td>
                  <td className="cd-strong">{line.item_code}</td>
                  <td>{line.item_description || '—'}</td>
                  <td>{line.warehouse_code || '—'}</td>
                  <td>{line.cost_center_code || '—'}</td>
                  <td><strong>{qty}</strong></td>
                  <td>{line.uom || '—'}</td>
                  <td>{price}</td>
                  <td>{line.tax_code || '—'}</td>
                  <td>{line.u_brand || '—'}</td>
                  <td>{line.u_size || '—'}</td>
                  <td>{line.u_pallets || '—'}</td>
                  <td>{line.u_packing || '—'}</td>
                  <td className="cd-strong">{lineTotal}</td>
                  <td>{line.free_text || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Workflow Action Bar: Allowed review actions only (Approve, Reject, Record Customer Approval, Create Order) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {isPendingReview && isManager && (
          <>
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={handleApprove}
              disabled={actionLoading}
            >
              ✓ {t('customizationDelivery.workflow.approve')}
            </button>
            <button
              type="button"
              className="app-button app-button--danger"
              onClick={() => setShowRejectModal(true)}
              disabled={actionLoading}
            >
              ✕ {t('customizationDelivery.workflow.reject')}
            </button>
          </>
        )}

        {isWaitingCustomer && (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={() => setShowApprovalModal(true)}
            disabled={actionLoading}
          >
            📋 {t('customizationDelivery.workflow.recordCustomerApproval')}
          </button>
        )}

        {isReadyForOrder && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem' }}>
              {t('customizationDelivery.columns.dueDate')}:
              <input
                type="date"
                className="app-input"
                style={{ marginInlineStart: 6 }}
                value={docDueDate}
                onChange={(e) => setDocDueDate(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={handleCreateOrder}
              disabled={actionLoading}
            >
              ⚡ {t('customizationDelivery.workflow.createOrder')}
            </button>
          </div>
        )}
      </div>

      {/* Customer Approval Modal */}
      {showApprovalModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="card-panel" style={{ width: '100%', maxWidth: 520, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
              {t('customizationDelivery.workflow.recordCustomerApproval')}
            </h3>

            <form onSubmit={handleRecordCustomerApproval}>
              <div style={{ marginBottom: 12 }}>
                <label className="cd-field-label" style={{ display: 'block', marginBottom: 4 }}>
                  {t('customizationDelivery.workflow.approvalType')} *
                </label>
                <select
                  className="app-input"
                  style={{ width: '100%' }}
                  value={approvalData.approval_type}
                  onChange={(e) => setApprovalData({ ...approvalData, approval_type: e.target.value })}
                  required
                >
                  <option value="PURCHASE_ORDER">{t('customizationDelivery.workflow.poApproval')}</option>
                  <option value="SIGNED_QUOTATION">{t('customizationDelivery.workflow.signedDocApproval')}</option>
                  <option value="EMAIL_CONFIRMATION">{t('customizationDelivery.workflow.emailApproval')}</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="cd-field-label" style={{ display: 'block', marginBottom: 4 }}>
                  {t('customizationDelivery.workflow.referenceNumber')} *
                </label>
                <input
                  type="text"
                  className="app-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. PO-2026-9041"
                  value={approvalData.reference_number}
                  onChange={(e) => setApprovalData({ ...approvalData, reference_number: e.target.value })}
                  required
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="cd-field-label" style={{ display: 'block', marginBottom: 4 }}>
                  {t('customizationDelivery.workflow.contactPerson')} *
                </label>
                <input
                  type="text"
                  className="app-input"
                  style={{ width: '100%' }}
                  placeholder="Customer Director / Approver Name"
                  value={approvalData.contact_person}
                  onChange={(e) => setApprovalData({ ...approvalData, contact_person: e.target.value })}
                  required
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="cd-field-label" style={{ display: 'block', marginBottom: 4 }}>
                  {t('customizationDelivery.workflow.notes')}
                </label>
                <textarea
                  className="app-input"
                  style={{ width: '100%', minHeight: 60 }}
                  value={approvalData.notes}
                  onChange={(e) => setApprovalData({ ...approvalData, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="app-button app-button--ghost"
                  onClick={() => setShowApprovalModal(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="app-button app-button--primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? t('common.loading') : t('customizationDelivery.workflow.recordCustomerApproval')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manager Reject Modal */}
      {showRejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div className="card-panel" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1.15rem' }}>
              {t('customizationDelivery.workflow.reject')}
            </h3>

            <div style={{ marginBottom: 16 }}>
              <label className="cd-field-label" style={{ display: 'block', marginBottom: 4 }}>
                {t('customizationDelivery.workflow.rejectionReason')} *
              </label>
              <textarea
                className="app-input"
                style={{ width: '100%', minHeight: 80 }}
                placeholder="State the reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="app-button app-button--ghost"
                onClick={() => setShowRejectModal(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="app-button app-button--danger"
                disabled={actionLoading || !rejectionReason.trim()}
                onClick={handleReject}
              >
                {actionLoading ? t('common.loading') : t('customizationDelivery.workflow.reject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
