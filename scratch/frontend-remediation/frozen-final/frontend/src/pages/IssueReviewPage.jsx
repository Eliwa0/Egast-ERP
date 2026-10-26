import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Send,
  RefreshCw,
  Search,
  FileText,
  Layers,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canManageProduction } from '../utils/roles';
import {
  fetchPendingIssues,
  fetchPendingIssue,
  rejectPendingIssue,
  approvePostPendingIssue,
  reconcilePendingIssue,
} from '../services/productionIssueService';
import PageHeader from '../components/ui/PageHeader';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import AppSpinner from '../components/ui/AppSpinner';
import '../styles/pages/IssueReviewPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtQty(value) {
  const n = Number(value || 0);
  return isNaN(n) ? '0' : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function StatusBadge({ status, isAmbiguous = false }) {
  const { t } = useI18n();

  if (status === 'FAILED' && isAmbiguous) {
    return (
      <span className="issue-status-badge issue-status-badge--ambiguous">
        <AlertTriangle size={13} />
        <span>{t('issueReview.ambiguousNotice')}</span>
      </span>
    );
  }

  const config = {
    PENDING_REVIEW: {
      className: 'issue-status-badge--pending',
      icon: <Clock size={13} />,
      label: t('issueReview.pendingReview'),
    },
    POSTING: {
      className: 'issue-status-badge--posting',
      icon: <RefreshCw size={13} className="spin" />,
      label: t('issueReview.posting'),
    },
    POSTED: {
      className: 'issue-status-badge--posted',
      icon: <CheckCircle2 size={13} />,
      label: t('issueReview.posted'),
    },
    FAILED: {
      className: 'issue-status-badge--failed',
      icon: <AlertTriangle size={13} />,
      label: t('issueReview.failed'),
    },
    REJECTED: {
      className: 'issue-status-badge--rejected',
      icon: <XCircle size={13} />,
      label: t('issueReview.rejected'),
    },
  };

  const current = config[status] || {
    className: 'issue-status-badge--rejected',
    icon: null,
    label: status || '—',
  };

  return (
    <span className={`issue-status-badge ${current.className}`}>
      {current.icon}
      <span>{current.label}</span>
    </span>
  );
}

// ── Reject Confirmation Modal ────────────────────────────────────────────────

function RejectModal({ isOpen, onClose, onConfirm, isSubmitting }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(t('issueReview.rejectReasonLabel'));
      return;
    }
    setError('');
    onConfirm(reason.trim());
  };

  return (
    <div className="issue-modal-backdrop" onClick={onClose}>
      <div className="issue-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="issue-modal-header">
          <h3 className="issue-modal-title">{t('issueReview.rejectModalTitle')}</h3>
          <button type="button" className="app-button app-button--secondary" onClick={onClose} disabled={isSubmitting}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="issue-modal-body">
          <label htmlFor="rejection-reason" className="issue-meta-label">
            {t('issueReview.rejectReasonLabel')}
          </label>
          <textarea
            id="rejection-reason"
            className="issue-modal-textarea"
            rows={4}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError('');
            }}
            placeholder={t('issueReview.rejectReasonPlaceholder')}
            autoFocus
            disabled={isSubmitting}
          />
          {error && <div className="form-error-msg">{error}</div>}

          <div className="issue-modal-actions">
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t('issueReview.rejectCancelBtn')}
            </button>
            <button
              type="submit"
              className="issue-action-btn-danger"
              disabled={isSubmitting || !reason.trim()}
            >
              {isSubmitting ? t('common.pleaseWait') : t('issueReview.rejectConfirmBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Approve & Post Confirmation Modal ────────────────────────────────────────

function ApproveModal({ isOpen, onClose, onConfirm, issue, isSubmitting }) {
  const { t } = useI18n();

  if (!isOpen || !issue) return null;

  return (
    <div className="issue-modal-backdrop" onClick={onClose}>
      <div className="issue-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="issue-modal-header">
          <h3 className="issue-modal-title">{t('issueReview.approveModalTitle')}</h3>
          <button type="button" className="app-button app-button--secondary" onClick={onClose} disabled={isSubmitting}>
            ✕
          </button>
        </div>

        <div className="issue-modal-body">
          <div className="issue-modal-warning-text">
            <strong>⚠️ {t('issueReview.approveWarning')}</strong>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>{t('issueReview.approveIrreversibleNotice')}</p>
          </div>

          <div className="issue-modal-recap">
            <div>
              <strong>{t('issueReview.approveOrderRecap')}:</strong> #{issue.production_order_doc_num}
            </div>
            <div>
              <strong>{t('issueReview.approveProductRecap')}:</strong> {issue.production_order_item_code} — {issue.production_order_item_name}
            </div>
            <div>
              <strong>{t('issueReview.approveComponentsRecap')}:</strong> {issue.total_components_count}
            </div>
            <div>
              <strong>{t('issueReview.approveQtyRecap')}:</strong> {fmtQty(issue.total_quantity)}
            </div>
          </div>

          <div className="issue-modal-actions">
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t('issueReview.approveCancelBtn')}
            </button>
            <button
              type="button"
              className="app-button app-button--primary issue-action-btn-post"
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>{t('issueReview.actionPosting')}</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>{t('issueReview.approveConfirmBtn')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reconcile Confirmation Modal ─────────────────────────────────────────────

function ReconcileModal({ isOpen, onClose, onConfirm, issue, isSubmitting }) {
  const { t } = useI18n();
  const [showManual, setShowManual] = useState(false);
  const [manualDocEntry, setManualDocEntry] = useState('');
  const [manualDocNum, setManualDocNum] = useState('');

  if (!isOpen || !issue) return null;

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualDocEntry.trim()) return;
    onConfirm({
      sap_doc_entry: manualDocEntry.trim(),
      sap_doc_num: manualDocNum.trim() || manualDocEntry.trim(),
    });
  };

  const handleAutoReconcile = () => {
    onConfirm({});
  };

  return (
    <div className="issue-modal-backdrop" onClick={onClose}>
      <div className="issue-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="issue-modal-header">
          <h3 className="issue-modal-title">{t('issueReview.reconcileModalTitle')}</h3>
          <button type="button" className="app-button app-button--secondary" onClick={onClose} disabled={isSubmitting}>
            ✕
          </button>
        </div>

        <div className="issue-modal-body">
          <p className="issue-modal-reconcile-desc">
            {t('issueReview.reconcileModalDesc')}
          </p>

          <ul className="issue-reconcile-points">
            <li>{t('issueReview.reconcilePoint1')}</li>
            <li>{t('issueReview.reconcilePoint2')}</li>
            <li>{t('issueReview.reconcilePoint3')}</li>
          </ul>

          <div className="issue-modal-recap">
            <div>
              <strong>{t('issueReview.approveOrderRecap')}:</strong> #{issue.production_order_doc_num}
            </div>
            <div>
              <strong>{t('issueReview.finishedProduct')}:</strong> {issue.production_order_item_code} — {issue.production_order_item_name}
            </div>
            <div>
              <strong>{t('issueReview.approveQtyRecap')}:</strong> {fmtQty(issue.total_quantity)}
            </div>
          </div>

          <div className="issue-reconcile-manual-section">
            <button
              type="button"
              className="issue-reconcile-toggle-btn"
              onClick={() => setShowManual((prev) => !prev)}
              disabled={isSubmitting}
            >
              <span>{t('issueReview.reconcileManualToggle')}</span>
              <span>{showManual ? '▲' : '▼'}</span>
            </button>

            {showManual && (
              <form onSubmit={handleManualSubmit} className="issue-reconcile-manual-form">
                <div>
                  <label className="issue-meta-label">{t('issueReview.reconcileManualDocEntry')}</label>
                  <input
                    type="text"
                    className="issue-modal-input"
                    value={manualDocEntry}
                    onChange={(e) => setManualDocEntry(e.target.value)}
                    placeholder="e.g. 10452"
                    disabled={isSubmitting}
                  />
                </div>
                <div>
                  <label className="issue-meta-label">{t('issueReview.reconcileManualDocNum')}</label>
                  <input
                    type="text"
                    className="issue-modal-input"
                    value={manualDocNum}
                    onChange={(e) => setManualDocNum(e.target.value)}
                    placeholder="e.g. 9845"
                    disabled={isSubmitting}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <button
                    type="submit"
                    className="app-button app-button--secondary"
                    disabled={isSubmitting || !manualDocEntry.trim()}
                    style={{ width: '100%' }}
                  >
                    {t('issueReview.reconcileManualSubmitBtn')}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="issue-modal-actions">
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t('issueReview.reconcileCancelBtn')}
            </button>
            <button
              type="button"
              className="issue-action-btn-reconcile"
              onClick={handleAutoReconcile}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>{t('issueReview.actionReconciling')}</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  <span>{t('issueReview.reconcileConfirmBtn')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────────────────────

export default function IssueReviewPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedIdFromUrl = searchParams.get('id');

  // State
  const [issues, setIssues] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState(null);

  const [statusFilter, setStatusFilter] = useState('PENDING_REVIEW');
  const [searchQuery, setSearchQuery] = useState('');

  const [activeIssue, setActiveIssue] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Modals & Action loading
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  const isAdmin = canManageProduction(user);

  // Load Issues List
  const loadIssues = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const data = await fetchPendingIssues({
        status: statusFilter,
      });
      setIssues(data.issues || []);
    } catch (err) {
      console.error('[ISSUE-REVIEW] Failed to load issues:', err);
      setListError(err.response?.data?.error || err.message || t('issueReview.errorLoading'));
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  // Load Specific Issue Detail
  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setActiveIssue(null);
      return;
    }
    setLoadingDetail(true);
    setDetailError(null);
    setActionFeedback(null);
    try {
      const data = await fetchPendingIssue(id);
      setActiveIssue(data);
    } catch (err) {
      console.error(`[ISSUE-REVIEW] Failed to load issue #${id}:`, err);
      setDetailError(err.response?.data?.error || err.message || t('issueReview.errorLoading'));
    } finally {
      setLoadingDetail(false);
    }
  }, [t]);

  useEffect(() => {
    if (selectedIdFromUrl) {
      loadDetail(selectedIdFromUrl);
    } else {
      setActiveIssue(null);
    }
  }, [selectedIdFromUrl, loadDetail]);

  const selectIssue = (issue) => {
    setSearchParams({ id: String(issue.id) });
  };

  const clearSelection = () => {
    setSearchParams({});
    setActiveIssue(null);
    loadIssues();
  };

  // Filtered List items
  const filteredIssues = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return issues;
    return issues.filter((iss) => {
      const idMatch = String(iss.id).includes(q);
      const orderMatch = String(iss.production_order_doc_num || '').toLowerCase().includes(q);
      const codeMatch = String(iss.production_order_item_code || '').toLowerCase().includes(q);
      const nameMatch = String(iss.production_order_item_name || '').toLowerCase().includes(q);
      const userMatch = String(iss.created_by || '').toLowerCase().includes(q);
      return idMatch || orderMatch || codeMatch || nameMatch || userMatch;
    });
  }, [issues, searchQuery]);

  // Handle Reject Action
  const handleRejectConfirm = async (reason) => {
    if (!activeIssue) return;
    setIsActionProcessing(true);
    setActionFeedback(null);
    try {
      await rejectPendingIssue(activeIssue.id, reason);
      setShowRejectModal(false);
      setActionFeedback({
        type: 'success',
        message: t('issueReview.rejectSuccessMsg'),
      });
      // Refresh detail
      await loadDetail(activeIssue.id);
      // Refresh list in background
      loadIssues();
    } catch (err) {
      console.error('[ISSUE-REVIEW] Reject error:', err);
      setActionFeedback({
        type: 'error',
        message: err.response?.data?.error || err.message || 'Failed to reject issue',
      });
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Handle Approve & Post Action
  const handleApproveConfirm = async () => {
    if (!activeIssue) return;
    setIsActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await approvePostPendingIssue(activeIssue.id);
      setShowApproveModal(false);
      setActionFeedback({
        type: 'success',
        message: t('issueReview.postSuccessMsg'),
      });
      // Refresh detail to show POSTED state and SAP identifiers
      await loadDetail(activeIssue.id);
      // Refresh list
      loadIssues();
    } catch (err) {
      console.error('[ISSUE-REVIEW] Approve & post error:', err);
      setShowApproveModal(false);
      const errText = err.response?.data?.error || err.message || t('issueReview.postFailureMsg');
      setActionFeedback({
        type: 'error',
        message: errText,
      });
      // Reload issue status (it might be FAILED in DB)
      await loadDetail(activeIssue.id);
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Check if active issue experienced an ambiguous SAP failure requiring reconciliation
  const isAmbiguous =
    activeIssue?.status === 'FAILED' &&
    String(activeIssue?.sap_error || '').includes('[AMBIGUOUS_FAILURE]');

  // Handle Reconcile Action
  const handleReconcileConfirm = async (payload = {}) => {
    if (!activeIssue) return;
    setIsActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await reconcilePendingIssue(activeIssue.id, payload);
      setShowReconcileModal(false);
      const resultType = res.data?.reconciliation_result;
      if (
        resultType === 'FOUND_AND_LINKED' ||
        resultType === 'MANUALLY_LINKED' ||
        res.data?.status === 'POSTED'
      ) {
        setActionFeedback({
          type: 'success',
          message: t('issueReview.reconcileSuccessFound'),
        });
      } else if (resultType === 'CLEARED_FOR_RETRY') {
        setActionFeedback({
          type: 'success',
          message: t('issueReview.reconcileSuccessCleared'),
        });
      } else {
        setActionFeedback({
          type: 'success',
          message: res.message || t('common.success'),
        });
      }
      // Refresh detail and list
      await loadDetail(activeIssue.id);
      loadIssues();
    } catch (err) {
      console.error('[ISSUE-REVIEW] Reconcile error:', err);
      setShowReconcileModal(false);
      const errText =
        err.response?.data?.error ||
        err.message ||
        t('issueReview.reconcileErrorUnreachable');
      setActionFeedback({
        type: 'error',
        message: errText,
      });
      await loadDetail(activeIssue.id);
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Permission Gate: Production Admin required
  if (!isAdmin) {
    return (
      <div className="issue-review-page">
        <PageHeader eyebrow="Production" title={t('issueReview.pageTitle')} description={t('issueReview.pageDesc')} />
        <div className="card-panel error-banner">
          <ShieldAlert size={28} />
          <div>
            <strong>{t('common.accessDenied')}</strong>
            <p>{t('common.accessDenied')}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Detail View ───────────────────────────────────────────────────────
  if (activeIssue || loadingDetail || detailError) {
    return (
      <div className="issue-review-page">
        <div className="issue-detail-nav">
          <button type="button" className="app-button app-button--secondary issue-back-btn" onClick={clearSelection}>
            <ArrowLeft size={16} />
            <span>{t('issueReview.backToList')}</span>
          </button>
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => loadDetail(selectedIdFromUrl)}
            disabled={loadingDetail || isActionProcessing}
          >
            <RefreshCw size={15} className={loadingDetail ? 'spin' : ''} />
            <span>{t('common.refresh')}</span>
          </button>
        </div>

        {loadingDetail && (
          <div className="issue-section-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', color: 'var(--color-primary)' }}>
              <AppSpinner size="md" />
              <strong style={{ fontSize: '1rem' }}>{t('issueReview.loadingIssues')}</strong>
            </div>
            <LoadingSkeleton rows={5} />
          </div>
        )}

        {detailError && (
          <div className="card-panel error-banner">
            <AlertTriangle size={24} />
            <div>
              <strong>{t('issueReview.errorLoading')}</strong>
              <p>{detailError}</p>
            </div>
          </div>
        )}

        {actionFeedback && (
          <div
            className={`card-panel ${actionFeedback.type === 'success' ? 'batch-balance-banner--success' : 'error-banner'}`}
            style={{ marginBottom: '16px' }}
          >
            {actionFeedback.type === 'success' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
            <div>
              <strong>
                {actionFeedback.type === 'success' ? t('common.success') : t('issueReview.postFailureTitle')}
              </strong>
              <p>{actionFeedback.message}</p>
            </div>
          </div>
        )}

        {activeIssue && (
          <div className="issue-detail-view">
            {/* 1. Status Banner */}
            <div className={`issue-status-banner issue-status-banner--${isAmbiguous ? 'ambiguous' : activeIssue.status.toLowerCase()}`}>
              <div className="issue-status-banner__header">
                <div className="issue-status-banner__title-group">
                  <StatusBadge status={activeIssue.status} isAmbiguous={isAmbiguous} />
                  <h2 className="issue-status-banner__title">
                    {activeIssue.status === 'PENDING_REVIEW' && t('issueReview.localPendingNotice')}
                    {activeIssue.status === 'POSTED' && t('issueReview.postedNotice')}
                    {activeIssue.status === 'POSTING' && t('issueReview.postingNotice')}
                    {activeIssue.status === 'FAILED' && (isAmbiguous ? t('issueReview.ambiguousNotice') : t('issueReview.failedNotice'))}
                    {activeIssue.status === 'REJECTED' && t('issueReview.rejectedNotice')}
                  </h2>
                </div>
              </div>

              <p className="issue-status-banner__desc">
                {activeIssue.status === 'PENDING_REVIEW' && t('issueReview.localPendingDesc')}
                {activeIssue.status === 'POSTED' && t('issueReview.postedDesc')}
                {activeIssue.status === 'POSTING' && t('issueReview.postingDesc')}
                {activeIssue.status === 'FAILED' && (isAmbiguous ? t('issueReview.ambiguousDesc') : t('issueReview.failedDesc'))}
                {activeIssue.status === 'REJECTED' && t('issueReview.rejectedDesc')}
              </p>

              {/* SAP Details for POSTED */}
              {activeIssue.status === 'POSTED' && (
                <div className="issue-status-banner__meta-grid">
                  <div className="issue-meta-item">
                    <span className="issue-meta-label">{t('issueReview.sapDocNum')}</span>
                    <span className="issue-meta-value issue-meta-value--highlight">
                      #{activeIssue.sap_doc_num || '—'}
                    </span>
                  </div>
                  <div className="issue-meta-item">
                    <span className="issue-meta-label">{t('issueReview.sapDocEntry')}</span>
                    <span className="issue-meta-value">#{activeIssue.sap_doc_entry || '—'}</span>
                  </div>
                  <div className="issue-meta-item">
                    <span className="issue-meta-label">{t('issueReview.postedBy')}</span>
                    <span className="issue-meta-value">{activeIssue.posted_by || '—'}</span>
                  </div>
                  <div className="issue-meta-item">
                    <span className="issue-meta-label">{t('issueReview.postedAt')}</span>
                    <span className="issue-meta-value">{fmtDate(activeIssue.posted_at)}</span>
                  </div>
                </div>
              )}

              {/* Error box for FAILED */}
              {activeIssue.status === 'FAILED' && activeIssue.sap_error && (
                <div className={`issue-error-box ${isAmbiguous ? 'issue-error-box--ambiguous' : ''}`}>
                  <strong>SAP Error:</strong> {activeIssue.sap_error}
                  {isAmbiguous && (
                    <div className="issue-ambiguous-explainer">
                      {t('issueReview.ambiguousErrorNotice')}
                    </div>
                  )}
                </div>
              )}

              {/* Rejection box for REJECTED */}
              {activeIssue.status === 'REJECTED' && (
                <div className="issue-reason-box">
                  <strong>{t('issueReview.rejectionReasonDisplay')}</strong> {activeIssue.rejection_reason || '—'}
                  <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {t('issueReview.reviewedBy')} {activeIssue.reviewed_by || '—'} • {fmtDate(activeIssue.reviewed_at)}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Order Header & Document Metadata */}
            <div className="issue-section-card">
              <div className="issue-section-header">
                <div>
                  <h3 className="issue-section-title">{t('issueReview.orderInfoTitle')}</h3>
                  <p className="issue-section-subtitle">
                    {t('issueReview.finishedProduct')}: {activeIssue.production_order_item_code} — {activeIssue.production_order_item_name}
                  </p>
                </div>
              </div>

              <div className="issue-order-grid">
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.issueId')}</span>
                  <span className="issue-meta-value issue-id-cell">#{activeIssue.id}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.orderNumber')}</span>
                  <span className="issue-meta-value">#{activeIssue.production_order_doc_num}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.orderDocEntry')}</span>
                  <span className="issue-meta-value">#{activeIssue.production_order_doc_entry}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.orderStatusAtSubmit')}</span>
                  <span className="issue-meta-value">{activeIssue.production_order_status}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.postingDate')}</span>
                  <span className="issue-meta-value">{activeIssue.posting_date || '—'}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.documentDate')}</span>
                  <span className="issue-meta-value">{activeIssue.document_date || '—'}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.createdBy')}</span>
                  <span className="issue-meta-value">{activeIssue.created_by || '—'}</span>
                </div>
                <div className="issue-meta-item">
                  <span className="issue-meta-label">{t('issueReview.createdAt')}</span>
                  <span className="issue-meta-value">{fmtDate(activeIssue.created_at)}</span>
                </div>
                <div className="issue-meta-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="issue-meta-label">{t('issueReview.comments')}</span>
                  <span className="issue-meta-value">{activeIssue.comments || '—'}</span>
                </div>
                <div className="issue-meta-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="issue-meta-label">{t('issueReview.journalMemo')}</span>
                  <span className="issue-meta-value">{activeIssue.journal_memo || '—'}</span>
                </div>
              </div>
            </div>

            {/* 3. Component Lines */}
            <div className="issue-section-card">
              <div className="issue-section-header">
                <div>
                  <h3 className="issue-section-title">{t('issueReview.componentsTitle')}</h3>
                  <p className="issue-section-subtitle">{t('issueReview.componentsSubtitle')}</p>
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {t('issueReview.colComponents')}: {activeIssue.total_components_count} | {t('issueReview.colQuantity')}: {fmtQty(activeIssue.total_quantity)}
                </div>
              </div>

              <div className="issue-review-table-wrap">
                <table className="issue-review-table">
                  <thead>
                    <tr>
                      <th>{t('issueReview.colLineNum')}</th>
                      <th>{t('issueReview.colItemCode')}</th>
                      <th>{t('issueReview.colItemName')}</th>
                      <th>{t('issueReview.colWarehouse')}</th>
                      <th>{t('issueReview.colIssueType')}</th>
                      <th>{t('issueReview.colUom')}</th>
                      <th>{t('issueReview.colPlannedQty')}</th>
                      <th>{t('issueReview.colIssuedQty')}</th>
                      <th>{t('issueReview.colRemainingQty')}</th>
                      <th style={{ textAlign: 'end' }}>{t('issueReview.colIssueQty')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeIssue.lines || []).map((line) => (
                      <tr key={line.id || line.line_number}>
                        <td style={{ fontWeight: 600 }}>{line.line_number}</td>
                        <td style={{ fontWeight: 600 }}>{line.item_code}</td>
                        <td>{line.item_name}</td>
                        <td>{line.warehouse_code}</td>
                        <td>{line.issue_type}</td>
                        <td>{line.uom_code || '—'}</td>
                        <td>{fmtQty(line.planned_quantity)}</td>
                        <td>{fmtQty(line.issued_quantity_at_submit)}</td>
                        <td>{fmtQty(line.remaining_quantity_at_submit)}</td>
                        <td style={{ textAlign: 'end', fontWeight: 700, color: 'var(--color-primary)' }}>
                          {fmtQty(line.issue_quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Batch & Bin Allocations Review */}
            <div className="issue-section-card">
              <div className="issue-section-header">
                <div>
                  <h3 className="issue-section-title">{t('issueReview.allocationsTitle')}</h3>
                  <p className="issue-section-subtitle">{t('issueReview.allocationsSubtitle')}</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(activeIssue.lines || []).map((line) => {
                  const allocations = line.allocations || [];
                  const allocSum = allocations.reduce((sum, a) => sum + Number(a.quantity || 0), 0);
                  const isMatch = Math.abs(allocSum - Number(line.issue_quantity)) < 0.0001;

                  return (
                    <div key={line.id || line.line_number} className="issue-alloc-group">
                      <div className="issue-alloc-group-header">
                        <div className="issue-alloc-comp-name">
                          Line #{line.line_number}: {line.item_code} — {line.item_name} ({t('issueReview.colIssueQty')}: {fmtQty(line.issue_quantity)} {line.uom_code})
                        </div>
                        <div>
                          {allocations.length > 0 ? (
                            isMatch ? (
                              <span className="issue-alloc-badge-match">
                                ✓ {t('issueReview.allocMatch')} ({fmtQty(allocSum)} / {fmtQty(line.issue_quantity)})
                              </span>
                            ) : (
                              <span className="issue-alloc-badge-mismatch">
                                ⚠️ {t('issueReview.allocMismatch')} ({fmtQty(allocSum)} / {fmtQty(line.issue_quantity)})
                              </span>
                            )
                          ) : (
                            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                              {t('issueReview.standardNoAlloc')}
                            </span>
                          )}
                        </div>
                      </div>

                      {allocations.length > 0 && (
                        <table className="issue-alloc-table">
                          <thead>
                            <tr>
                              <th>{t('issueReview.colBatch')}</th>
                              <th>{t('issueReview.colBin')}</th>
                              <th style={{ textAlign: 'end' }}>{t('issueReview.colAllocQty')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allocations.map((alloc, aIdx) => (
                              <tr key={aIdx}>
                                <td>{alloc.batch_number || '—'}</td>
                                <td>{alloc.bin_code || (alloc.bin_abs_entry ? `Bin #${alloc.bin_abs_entry}` : '—')}</td>
                                <td style={{ textAlign: 'end', fontWeight: 600 }}>{fmtQty(alloc.quantity)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5. Actions Bar */}
            <div className="issue-review-actions-bar">
              {/* If POSTED: Back actions */}
              {activeIssue.status === 'POSTED' && (
                <>
                  <button type="button" className="app-button app-button--secondary" onClick={clearSelection}>
                    {t('issueReview.backToList')}
                  </button>
                  <button type="button" className="app-button app-button--primary" onClick={() => navigate('/production')}>
                    {t('issueReview.backToProduction')}
                  </button>
                </>
              )}

              {/* If REJECTED: Back actions */}
              {activeIssue.status === 'REJECTED' && (
                <button type="button" className="app-button app-button--secondary" onClick={clearSelection}>
                  {t('issueReview.backToList')}
                </button>
              )}

              {/* If POSTING: Show Disabled Loading button */}
              {activeIssue.status === 'POSTING' && (
                <button type="button" className="app-button app-button--secondary" disabled>
                  <RefreshCw size={16} className="spin" />
                  <span>{t('issueReview.postingNotice')}</span>
                </button>
              )}

              {/* If Ambiguous Failure: ONLY Reconcile SAP button is available */}
              {isAmbiguous && (
                <button
                  type="button"
                  className="issue-action-btn-reconcile"
                  onClick={() => setShowReconcileModal(true)}
                  disabled={isActionProcessing}
                >
                  {isActionProcessing ? (
                    <>
                      <RefreshCw size={16} className="spin" />
                      <span>{t('issueReview.actionReconciling')}</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      <span>{t('issueReview.actionReconcile')}</span>
                    </>
                  )}
                </button>
              )}

              {/* If PENDING_REVIEW or non-ambiguous FAILED: Reject and Approve & Post available */}
              {(activeIssue.status === 'PENDING_REVIEW' || (activeIssue.status === 'FAILED' && !isAmbiguous)) && (
                <>
                  <button
                    type="button"
                    className="issue-action-btn-danger"
                    onClick={() => setShowRejectModal(true)}
                    disabled={isActionProcessing}
                  >
                    <XCircle size={16} />
                    <span>{t('issueReview.actionReject')}</span>
                  </button>

                  <button
                    type="button"
                    className="app-button app-button--primary issue-action-btn-post"
                    onClick={() => setShowApproveModal(true)}
                    disabled={isActionProcessing}
                  >
                    {isActionProcessing ? (
                      <>
                        <RefreshCw size={16} className="spin" />
                        <span>{t('issueReview.actionPosting')}</span>
                      </>
                    ) : activeIssue.status === 'FAILED' ? (
                      <>
                        <RotateCcw size={16} />
                        <span>{t('issueReview.actionRetry')}</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>{t('issueReview.actionApprovePost')}</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* Modals */}
            <RejectModal
              isOpen={showRejectModal}
              onClose={() => setShowRejectModal(false)}
              onConfirm={handleRejectConfirm}
              isSubmitting={isActionProcessing}
            />

            <ApproveModal
              isOpen={showApproveModal}
              onClose={() => setShowApproveModal(false)}
              onConfirm={handleApproveConfirm}
              issue={activeIssue}
              isSubmitting={isActionProcessing}
            />

            <ReconcileModal
              isOpen={showReconcileModal}
              onClose={() => setShowReconcileModal(false)}
              onConfirm={handleReconcileConfirm}
              issue={activeIssue}
              isSubmitting={isActionProcessing}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Render List View ─────────────────────────────────────────────────────────
  return (
    <div className="issue-review-page">
      <PageHeader
        eyebrow="Production Admin"
        title={t('issueReview.pageTitle')}
        description={t('issueReview.pageDesc')}
      />

      {/* Toolbar / Filters */}
      <div className="issue-review-toolbar">
        <div className="issue-review-search-wrap">
          <Search size={18} className="issue-review-search-icon" />
          <input
            type="text"
            className="issue-review-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('issueReview.searchPlaceholder')}
          />
        </div>

        <div className="issue-review-filters">
          <select
            className="issue-review-status-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            disabled={loadingList}
            aria-label={t('issueReview.filterStatus')}
          >
            <option value="PENDING_REVIEW">{t('issueReview.pendingReview')}</option>
            <option value="all">{t('issueReview.allStatuses')}</option>
            <option value="POSTING">{t('issueReview.posting')}</option>
            <option value="POSTED">{t('issueReview.posted')}</option>
            <option value="FAILED">{t('issueReview.failed')}</option>
            <option value="REJECTED">{t('issueReview.rejected')}</option>
          </select>

          <button
            type="button"
            className="app-button app-button--secondary issue-review-refresh-btn"
            onClick={loadIssues}
            disabled={loadingList}
            title={t('common.refresh')}
          >
            <RefreshCw size={16} className={loadingList ? 'spin' : ''} />
            <span>{t('common.refresh')}</span>
          </button>
        </div>
      </div>

      {listError && (
        <div className="card-panel error-banner" style={{ marginBottom: '20px' }}>
          <AlertTriangle size={22} />
          <div>
            <strong>{t('issueReview.errorLoading')}</strong>
            <p>{listError}</p>
          </div>
        </div>
      )}

      {/* Issues Table Card */}
      <div className="issue-review-table-card">
        {loadingList ? (
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', color: 'var(--color-primary)' }}>
              <AppSpinner size="md" />
              <strong style={{ fontSize: '1rem' }}>{t('issueReview.loadingIssues')}</strong>
            </div>
            <LoadingSkeleton rows={5} />
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="issue-review-empty">
            <Layers size={36} />
            <p>{searchQuery ? t('issueReview.noIssuesFiltered') : t('issueReview.noIssues')}</p>
          </div>
        ) : (
          <div className="issue-review-table-wrap">
            <table className="issue-review-table">
              <thead>
                <tr>
                  <th>{t('issueReview.colId')}</th>
                  <th>{t('issueReview.colStatus')}</th>
                  <th>{t('issueReview.colOrderNum')}</th>
                  <th>{t('issueReview.colProduct')}</th>
                  <th>{t('issueReview.colComponents')}</th>
                  <th>{t('issueReview.colQuantity')}</th>
                  <th>{t('issueReview.colCreatedBy')}</th>
                  <th>{t('issueReview.colCreatedAt')}</th>
                  <th style={{ textAlign: 'end' }}>{t('issueReview.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((iss) => (
                  <tr key={iss.id}>
                    <td className="issue-id-cell">#{iss.id}</td>
                    <td>
                      <StatusBadge
                        status={iss.status}
                        isAmbiguous={iss.status === 'FAILED' && String(iss.sap_error || '').includes('[AMBIGUOUS_FAILURE]')}
                      />
                    </td>
                    <td style={{ fontWeight: 600 }}>#{iss.production_order_doc_num}</td>
                    <td>
                      <div className="issue-product-cell">
                        <span className="issue-product-code">{iss.production_order_item_code}</span>
                        <span className="issue-product-name">{iss.production_order_item_name}</span>
                      </div>
                    </td>
                    <td>{iss.total_components_count}</td>
                    <td className="issue-qty-cell">{fmtQty(iss.total_quantity)}</td>
                    <td>{iss.created_by || '—'}</td>
                    <td>{fmtDate(iss.created_at)}</td>
                    <td style={{ textAlign: 'end' }}>
                      <button
                        type="button"
                        className="app-button app-button--secondary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                        onClick={() => selectIssue(iss)}
                      >
                        <FileText size={14} />
                        <span>{t('issueReview.actionReview')}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
