import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { canManageDelivery } from '../../utils/roles';
import {
  fetchDeliveryDrafts,
  createDeliveryDraft,
  updateDeliveryDraft,
  submitDeliveryDraft,
  approveDeliveryDraft,
  rejectDeliveryDraft,
  postDeliveryToSap,
  reconcileDeliveryDraft,
} from '../../services/customizationDeliveryService';
import LoadingSkeleton from '../ui/LoadingSkeleton';

function DeliveryHistorySection({ postedDrafts, order, t }) {
  if (!postedDrafts || postedDrafts.length === 0) return null;

  return (
    <section className="card-panel cd-section" style={{ marginTop: 16 }}>
      <h2 className="cd-section__title" style={{ margin: '0 0 12px' }}>
        📜 {t('customizationDelivery.workflow.deliveryHistory')} ({postedDrafts.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {postedDrafts.map((pDraft) => (
          <div
            key={pDraft.id}
            style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-muted)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <div>
                <strong style={{ fontSize: '1rem', color: 'var(--success)' }}>
                  ✓ {t('customizationDelivery.workflow.deliveryCreated')}: #{pDraft.sap_doc_num}
                </strong>
                <span className="cd-muted" style={{ marginInlineStart: 8, fontSize: '0.85rem' }}>
                  (SAP DocEntry: {pDraft.sap_doc_entry})
                </span>
              </div>
              <span className="cd-muted" style={{ fontSize: '0.8rem' }}>
                {pDraft.doc_date || pDraft.posted_at || '—'}
              </span>
            </div>

            <p className="cd-muted" style={{ margin: '0 0 10px', fontSize: '0.82rem' }}>
              ℹ {t('customizationDelivery.workflow.relationshipChain')}: Quotation ──[BaseType: 23]──&gt;
              Sales Order #{order?.document_number || order?.document_entry} (DocEntry{' '}
              {order?.document_entry}) ──[BaseType: 17]──&gt; Delivery Note #{pDraft.sap_doc_num} (DocEntry{' '}
              {pDraft.sap_doc_entry})
            </p>

            <div className="cd-table-wrap">
              <table className="cd-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>{t('customizationDelivery.columns.line')}</th>
                    <th>{t('customizationDelivery.columns.item')}</th>
                    <th>{t('customizationDelivery.workflow.deliveryQuantity')}</th>
                    <th>{t('customizationDelivery.columns.warehouse')}</th>
                    <th>{t('customizationDelivery.workflow.batches')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pDraft.lines
                    ?.filter((l) => Number(l.delivery_quantity) > 0)
                    .map((l) => (
                      <tr key={l.id}>
                        <td>{l.line_number + 1}</td>
                        <td className="cd-strong">{l.item_code}</td>
                        <td>
                          {l.delivery_quantity} {l.uom}
                        </td>
                        <td>{l.warehouse_code}</td>
                        <td>
                          {l.batches?.length > 0 ? (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {l.batches.map((b, bIdx) => (
                                <span
                                  key={bIdx}
                                  style={{
                                    background: 'var(--bg-soft)',
                                    padding: '2px 6px',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border)',
                                    fontSize: '0.78rem',
                                  }}
                                >
                                  <strong>{b.batch_number}</strong>: {b.quantity}{' '}
                                  {b.bin_code ? `(${b.bin_code})` : ''}
                                </span>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DeliveryWorkflowPanel({ order, onRefresh }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const isManager = canManageDelivery(user);

  const [allDrafts, setAllDrafts] = useState([]);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Rejection modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // Active line for batch allocation modal
  const [activeBatchLine, setActiveBatchLine] = useState(null);
  const [batchInput, setBatchInput] = useState({
    batch_number: '',
    quantity: '',
    bin_code: '',
    bin_abs_entry: '',
  });

  const loadDraft = useCallback(async () => {
    if (!order?.document_entry) return;
    setLoading(true);
    setError('');
    try {
      const drafts = await fetchDeliveryDrafts({ sales_order_doc_entry: order.document_entry });
      setAllDrafts(drafts || []);
      const active = (drafts || []).find((d) => d.status !== 'POSTED');
      if (active) {
        setDraft(active);
      } else {
        setDraft(null);
      }
    } catch (err) {
      console.error('Error fetching delivery draft:', err);
    } finally {
      setLoading(false);
    }
  }, [order?.document_entry]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  const handleStartDelivery = async () => {
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const newDraft = await createDeliveryDraft({ sales_order_doc_entry: order.document_entry });
      setDraft(newDraft);
      setAllDrafts((prev) => [newDraft, ...prev]);
      setSuccessMsg(t('customizationDelivery.workflow.deliveryDraftTitle') + ' created.');
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleLineQtyChange = (lineNum, value) => {
    if (!draft) return;
    setDraft((prev) => {
      const updatedLines = prev.lines.map((l) => {
        if (l.line_number === lineNum) {
          return { ...l, delivery_quantity: value };
        }
        return l;
      });
      return { ...prev, lines: updatedLines };
    });
  };

  const handleSaveAllocations = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await updateDeliveryDraft(draft.id, {
        lines: draft.lines,
        comments: draft.comments,
        doc_date: draft.doc_date,
        doc_due_date: draft.doc_due_date,
      });
      setDraft(updated);
      setSuccessMsg(t('common.save') + ' ' + t('common.success'));
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');

    // Check batch allocation sum match for each line
    const mismatch = draft.lines?.find((line) => {
      const delivQty = parseFloat(line.delivery_quantity || 0);
      if (delivQty > 0 && line.batches?.length > 0) {
        const batchSum = line.batches.reduce((acc, b) => acc + parseFloat(b.quantity || 0), 0);
        return Math.abs(batchSum - delivQty) > 0.0001;
      }
      return false;
    });

    if (mismatch) {
      setError(
        `${t('customizationDelivery.workflow.batchSumMismatch')} (${mismatch.item_code})`
      );
      setActionLoading(false);
      return;
    }

    try {
      const updated = await submitDeliveryDraft(draft.id);
      setDraft(updated);
      setSuccessMsg(t('customizationDelivery.workflow.submitReview') + ' ' + t('common.success'));
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await approveDeliveryDraft(draft.id);
      setDraft(updated);
      setSuccessMsg(t('customizationDelivery.workflow.approve') + ' ' + t('common.success'));
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
      const updated = await rejectDeliveryDraft(draft.id, rejectionReason.trim());
      setDraft(updated);
      setShowRejectModal(false);
      setRejectionReason('');
      setSuccessMsg(t('customizationDelivery.workflow.reject') + ' ' + t('common.success'));
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostDelivery = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await postDeliveryToSap(draft.id);
      setDraft(null); // Return to summary/history view once posted
      setAllDrafts((prev) => [updated, ...prev.filter((d) => d.id !== updated.id)]);
      setSuccessMsg(t('customizationDelivery.workflow.deliveryCreated') + ` #${updated.sap_doc_num}!`);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReconcile = async () => {
    if (!draft) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const updated = await reconcileDeliveryDraft(draft.id);
      setDraft(updated);
      if (updated.status === 'POSTED') {
        setSuccessMsg(t('customizationDelivery.workflow.deliveryCreated') + ` #${updated.sap_doc_num}!`);
        if (onRefresh) onRefresh();
      } else {
        setSuccessMsg('Reconciliation complete. No existing Delivery Note was detected in SAP.');
      }
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddBatch = (lineNum) => {
    if (!batchInput.batch_number.trim() || !batchInput.quantity) return;
    const qty = parseFloat(batchInput.quantity);
    if (isNaN(qty) || qty <= 0) return;

    setDraft((prev) => {
      const updatedLines = prev.lines.map((l) => {
        if (l.line_number === lineNum) {
          const currentBatches = l.batches || [];
          const newBatch = {
            id: Date.now(),
            batch_number: batchInput.batch_number.trim(),
            quantity: qty,
            bin_code: batchInput.bin_code.trim(),
            bin_abs_entry: batchInput.bin_abs_entry ? parseInt(batchInput.bin_abs_entry, 10) : null,
          };
          return { ...l, batches: [...currentBatches, newBatch] };
        }
        return l;
      });
      return { ...prev, lines: updatedLines };
    });

    setBatchInput({ batch_number: '', quantity: '', bin_code: '', bin_abs_entry: '' });
  };

  const handleRemoveBatch = (lineNum, batchIdx) => {
    setDraft((prev) => {
      const updatedLines = prev.lines.map((l) => {
        if (l.line_number === lineNum) {
          const newBatches = (l.batches || []).filter((_, idx) => idx !== batchIdx);
          return { ...l, batches: newBatches };
        }
        return l;
      });
      return { ...prev, lines: updatedLines };
    });
  };

  const postedDrafts = allDrafts.filter((d) => d.status === 'POSTED');
  const hasOpenQuantity =
    order?.status_code !== 'C' &&
    (!order?.lines || order.lines.some((l) => Number(l.remaining_open_quantity) > 0));

  if (loading) {
    return <LoadingSkeleton rows={2} />;
  }

  // If no active draft exists yet
  if (!draft) {
    return (
      <>
        {hasOpenQuantity || postedDrafts.length === 0 ? (
          <section className="card-panel cd-section cd-workflow-card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 className="cd-section__title" style={{ margin: 0 }}>
                  {postedDrafts.length > 0
                    ? t('customizationDelivery.workflow.createAnotherDelivery')
                    : t('customizationDelivery.workflow.createDelivery')}
                </h2>
                <p className="cd-muted" style={{ margin: '4px 0 0' }}>
                  Fulfill customer sales order items with native SAP BaseType: 17 delivery notes.
                </p>
              </div>
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={handleStartDelivery}
                disabled={actionLoading}
              >
                {actionLoading
                  ? t('common.loading')
                  : postedDrafts.length > 0
                  ? `+ ${t('customizationDelivery.workflow.createAnotherDelivery')}`
                  : t('customizationDelivery.workflow.createDelivery')}
              </button>
            </div>
            {error && <div className="cd-error" style={{ marginTop: 12 }}>{error}</div>}
            {successMsg && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid var(--success)',
                  color: 'var(--text)',
                  marginTop: 12,
                  fontSize: '0.85rem',
                }}
              >
                {successMsg}
              </div>
            )}
          </section>
        ) : (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid var(--success)',
              marginTop: 16,
              fontSize: '0.9rem',
            }}
          >
            ✓ All lines in this Sales Order have been fully delivered and closed in SAP.
          </div>
        )}
        <DeliveryHistorySection postedDrafts={postedDrafts} order={order} t={t} />
      </>
    );
  }

  const isEditable = draft.status === 'DRAFT' || draft.status === 'REJECTED';
  const isPendingReview = draft.status === 'PENDING_REVIEW';
  const isApproved = draft.status === 'APPROVED';
  const isPosted = draft.status === 'POSTED';
  const isFailed = draft.status === 'FAILED';

  return (
    <>
      <section className="card-panel cd-section cd-workflow-card" style={{ marginTop: 16 }}>
      {/* Workflow Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 className="cd-section__title" style={{ margin: 0 }}>
            {t('customizationDelivery.workflow.deliveryDraftTitle')} #{draft.id}
          </h2>
          <span className="cd-muted">
            Target Sales Order #{draft.sales_order_doc_num} (DocEntry {draft.sales_order_doc_entry})
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

      {/* Posted Success Banner */}
      {isPosted && (
        <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-md)', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--success)', marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--success)' }}>
            ✓ {t('customizationDelivery.workflow.deliveryCreated')}: #{draft.sap_doc_num}
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            SAP DocEntry: <strong>{draft.sap_doc_entry}</strong> | Posted by: <strong>{draft.posted_by || 'system'}</strong>
          </p>
          <p className="cd-muted" style={{ margin: '6px 0 0' }}>
            ℹ {t('customizationDelivery.workflow.relationshipMapInfo')} (Sales Quotation → Sales Order → Delivery Note).
          </p>
        </div>
      )}

      {/* Rejection / Failure Banner */}
      {draft.rejection_reason && draft.status === 'REJECTED' && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid var(--danger)', marginBottom: 12 }}>
          <strong>{t('customizationDelivery.workflow.rejectionReason')}:</strong> {draft.rejection_reason}
        </div>
      )}

      {draft.sap_error && isFailed && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid var(--danger)', marginBottom: 12 }}>
          <strong>SAP Error:</strong> {draft.sap_error}
        </div>
      )}

      {/* Costing Dimensions Banner */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-muted)',
          border: '1px solid var(--border)',
          marginBottom: 16,
          fontSize: '0.84rem',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ color: 'var(--primary)' }}>✓ {t('customizationDelivery.workflow.costingDimensions')}:</strong>
        <span className="cd-muted">
          Dim 1 (COGS): <strong>{draft.cost_center_1 || 'MPH53VPT'}</strong> | Dim 2: <strong>{draft.cost_center_2 || 'PPAPOTLM'}</strong> | Dim 3: <strong>{draft.cost_center_3 || '00003NON'}</strong> ({draft.cost_center_1 || draft.cost_center_2 ? (lang === 'ar' ? 'محدد بواسطة المستخدم' : 'User Specified') : (lang === 'ar' ? 'تخصيص تلقائي وفق إعداد SAP' : 'Auto-assigned per live SAP setup')})
        </span>
      </div>

      {/* Header Fields (Dates, Comments) */}
      <div className="cd-field-grid" style={{ marginBottom: 16 }}>
        <div className="cd-field-item">
          <span className="cd-field-label">{t('customizationDelivery.columns.documentDate')}</span>
          {isEditable ? (
            <input
              type="date"
              className="app-input"
              value={draft.doc_date || ''}
              onChange={(e) => setDraft({ ...draft, doc_date: e.target.value })}
            />
          ) : (
            <span className="cd-field-value">{draft.doc_date || '—'}</span>
          )}
        </div>
        <div className="cd-field-item">
          <span className="cd-field-label">{t('customizationDelivery.columns.dueDate')}</span>
          {isEditable ? (
            <input
              type="date"
              className="app-input"
              value={draft.doc_due_date || ''}
              onChange={(e) => setDraft({ ...draft, doc_due_date: e.target.value })}
            />
          ) : (
            <span className="cd-field-value">{draft.doc_due_date || '—'}</span>
          )}
        </div>
        <div className="cd-field-item" style={{ gridColumn: 'span 2' }}>
          <span className="cd-field-label">{t('customizationDelivery.workflow.notes')}</span>
          {isEditable ? (
            <input
              type="text"
              className="app-input"
              value={draft.comments || ''}
              placeholder="Delivery comments..."
              onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
            />
          ) : (
            <span className="cd-field-value">{draft.comments || '—'}</span>
          )}
        </div>
      </div>

      {/* Lines & Allocation Table */}
      <div className="cd-table-wrap" style={{ marginBottom: 16 }}>
        <table className="cd-table">
          <thead>
            <tr>
              <th>{t('customizationDelivery.columns.line')}</th>
              <th>{t('customizationDelivery.columns.item')}</th>
              <th>{t('customizationDelivery.columns.description')}</th>
              <th>{t('customizationDelivery.workflow.orderQuantity')}</th>
              <th>{t('customizationDelivery.workflow.openQuantity')}</th>
              <th>{t('customizationDelivery.workflow.deliveryQuantity')}</th>
              <th>{t('customizationDelivery.columns.warehouse')}</th>
              <th>{t('customizationDelivery.workflow.batches')}</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines?.map((line) => {
              const batchSum = (line.batches || []).reduce((acc, b) => acc + parseFloat(b.quantity || 0), 0);
              const delivQty = parseFloat(line.delivery_quantity || 0);
              const isBatchMatching = (line.batches && line.batches.length > 0) ? Math.abs(batchSum - delivQty) < 0.0001 : true;

              return (
                <React.Fragment key={line.id}>
                  <tr>
                    <td>{line.line_number + 1}</td>
                    <td className="cd-strong">{line.item_code}</td>
                    <td>{line.item_description || '—'}</td>
                    <td>{line.order_quantity} {line.uom}</td>
                    <td>{line.open_quantity_at_draft} {line.uom}</td>
                    <td>
                      {isEditable ? (
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max={line.open_quantity_at_draft}
                          className="app-input"
                          style={{ width: 100, padding: '4px 6px' }}
                          value={line.delivery_quantity}
                          onChange={(e) => handleLineQtyChange(line.line_number, e.target.value)}
                        />
                      ) : (
                        <span>{line.delivery_quantity} {line.uom}</span>
                      )}
                    </td>
                    <td>{line.warehouse_code}</td>
                    <td>
                      <button
                        type="button"
                        className="app-button app-button--ghost"
                        style={{ fontSize: '0.78rem', padding: '3px 8px' }}
                        onClick={() => setActiveBatchLine(activeBatchLine === line.line_number ? null : line.line_number)}
                      >
                        {line.batches?.length ? `${line.batches.length} batch(es)` : '+ Add Batches'}
                        {!isBatchMatching && delivQty > 0 && <span style={{ color: 'var(--danger)', marginInlineStart: 4 }}>⚠️</span>}
                      </button>
                    </td>
                  </tr>

                  {/* Batch Allocation Expander */}
                  {activeBatchLine === line.line_number && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--bg-soft)', padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                            {t('customizationDelivery.workflow.batches')} for {line.item_code}:
                          </span>
                          <span style={{ fontSize: '0.8rem', color: isBatchMatching ? 'var(--success)' : 'var(--danger)' }}>
                            Allocated: {batchSum} / Delivery Qty: {delivQty}
                          </span>
                        </div>

                        {line.batches && line.batches.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                            {line.batches.map((batch, bIdx) => (
                              <div
                                key={bIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  background: 'var(--bg-muted)',
                                  border: '1px solid var(--border)',
                                  padding: '4px 8px',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: '0.8rem',
                                }}
                              >
                                <strong>{batch.batch_number}</strong>: {batch.quantity}
                                {batch.bin_code && <span className="cd-muted">({batch.bin_code})</span>}
                                {isEditable && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveBatch(line.line_number, bIdx)}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)' }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {isEditable && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                              type="text"
                              className="app-input"
                              placeholder={t('customizationDelivery.workflow.batchNumber')}
                              style={{ width: 140, padding: '4px 6px' }}
                              value={batchInput.batch_number}
                              onChange={(e) => setBatchInput({ ...batchInput, batch_number: e.target.value })}
                            />
                            <input
                              type="number"
                              step="any"
                              className="app-input"
                              placeholder={t('customizationDelivery.columns.quantity')}
                              style={{ width: 90, padding: '4px 6px' }}
                              value={batchInput.quantity}
                              onChange={(e) => setBatchInput({ ...batchInput, quantity: e.target.value })}
                            />
                            <input
                              type="text"
                              className="app-input"
                              placeholder={t('customizationDelivery.workflow.binCode')}
                              style={{ width: 110, padding: '4px 6px' }}
                              value={batchInput.bin_code}
                              onChange={(e) => setBatchInput({ ...batchInput, bin_code: e.target.value })}
                            />
                            <button
                              type="button"
                              className="app-button app-button--secondary"
                              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              onClick={() => handleAddBatch(line.line_number)}
                            >
                              + {t('customizationDelivery.workflow.addBatch')}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Action Bar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {isEditable && (
          <>
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={handleSaveAllocations}
              disabled={actionLoading}
            >
              {t('customizationDelivery.workflow.saveDraft')}
            </button>
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={handleSubmitReview}
              disabled={actionLoading}
            >
              {t('customizationDelivery.workflow.submitReview')}
            </button>
          </>
        )}

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

        {isApproved && isManager && (
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={handlePostDelivery}
            disabled={actionLoading}
          >
            🚀 {t('customizationDelivery.workflow.postDelivery')}
          </button>
        )}

        {isFailed && (
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={handleReconcile}
            disabled={actionLoading}
          >
            ↻ Reconcile with SAP
          </button>
        )}
      </div>

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
    <DeliveryHistorySection postedDrafts={postedDrafts} order={order} t={t} />
  </>
);
}
