import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
  cancelPurchaseGRPODraft,
  createOrGetGRPOFromScaleDraft,
  loadPendingGrpoShipments,
  openPurchaseGRPODraft,
} from '../services/purchaseGrpoService';
import { getProductIcon } from '../utils/productIcon';
import '../styles/pages/quality-inspection.css';

function GRPOPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [openingId, setOpeningId] = useState(null);
  const [shipmentToDelete, setShipmentToDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const getShipmentKey = (shipment) => {
    if (!shipment) return '';
    return shipment.source_type === 'scale'
      ? `scale-${shipment.scale_draft_id}`
      : `insp-${shipment.id}`;
  };

  const fetchPendingShipments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadPendingGrpoShipments();
      setShipments(data);
    } catch (err) {
      console.error('Failed to load pending GRPO shipments:', err);
      const msg = err.response?.data?.error || t('grpo.errorLoading');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    fetchPendingShipments();
  }, [fetchPendingShipments]);

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shipments;
    return shipments.filter((s) => {
      const batch = String(s.batch_number || '').toLowerCase();
      const car = String(s.car_number || '').toLowerCase();
      const vendor = String(s.vendor_name || s.supplier_name || '').toLowerCase();
      const item = String(s.item_name || s.item_code || '').toLowerCase();
      const wh = String(s.warehouse_code || '').toLowerCase();
      return (
        batch.includes(q) ||
        car.includes(q) ||
        vendor.includes(q) ||
        item.includes(q) ||
        wh.includes(q)
      );
    });
  }, [shipments, search]);

  const handleOpenShipment = async (shipment) => {
    const key = getShipmentKey(shipment);
    if (openingId) return;
    setOpeningId(key);
    try {
      let draft = null;
      if (shipment.has_active_draft && shipment.grpo_draft_id) {
        const targetPath = shipment.grpo_draft_status === 'POSTED'
          ? `/grpo/documents/${shipment.grpo_draft_id}`
          : `/grpo/${shipment.grpo_draft_id}`;
        navigate(targetPath);
        return;
      }
      if (shipment.source_type === 'scale') {
        draft = await createOrGetGRPOFromScaleDraft(shipment.scale_draft_id);
      } else {
        draft = await openPurchaseGRPODraft(shipment.id);
      }
      if (!draft?.id) {
        toast.error(t('grpo.openFailed'));
        return;
      }
      const targetPath = draft.status === 'POSTED'
        ? `/grpo/documents/${draft.id}`
        : `/grpo/${draft.id}`;
      navigate(targetPath);
    } catch (err) {
      console.error('Failed to open GRPO draft:', err);
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        toast.error(t('grpo.openTimeoutRetrying', 'استغرقت العملية وقتاً أطول من المتوقع، جاري تحديث القائمة...'));
        fetchPendingShipments();
      } else {
        toast.error(err.response?.data?.error || t('grpo.openFailed'));
      }
    } finally {
      setOpeningId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!shipmentToDelete) return;
    const targetDraftId = shipmentToDelete.grpo_draft_id;
    const targetShipmentKey = getShipmentKey(shipmentToDelete);
    if (!targetDraftId) return;
    setDeletingId(targetShipmentKey);
    try {
      await cancelPurchaseGRPODraft(targetDraftId, 'Cancelled from draft card');
      toast.success(t('grpo.draftDeleted'));
      setShipmentToDelete(null);
      if (shipmentToDelete.is_manual) {
        setShipments((prev) => prev.filter((s) => s.id !== shipmentToDelete.id));
      } else {
        setShipments((prev) =>
          prev.map((s) =>
            getShipmentKey(s) === targetShipmentKey
              ? { ...s, has_active_draft: false, grpo_draft_id: null, grpo_draft_status: null }
              : s
          )
        );
      }
    } catch (err) {
      console.error('Failed to delete GRPO draft:', err);
      toast.error(err.response?.data?.error || t('grpo.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (shipment) => {
    if (shipment.has_active_draft) {
      const status = shipment.grpo_draft_status;
      if (status === 'APPROVED_FOR_POSTING') {
        return (
          <span className="rr-status-badge rr-status-badge--APPROVED_FOR_POSTING">
            {t('grpo.statusApprovedForPosting')}
          </span>
        );
      }
      if (status === 'POSTING_FAILED') {
        return (
          <span className="rr-status-badge rr-status-badge--POSTING_FAILED">
            {t('grpo.statusPostingFailed')}
          </span>
        );
      }
      return (
        <span className="rr-status-badge rr-status-badge--DRAFT">
          {t('grpo.statusDraft')}
        </span>
      );
    }
    return (
      <span className="rr-status-badge rr-status-badge--PENDING_REVIEW">
        {t('grpo.statusReady')}
      </span>
    );
  };

  return (
    <div className="page-shell quality-wizard grpo-page">
      <PageHeader
        eyebrow={t('grpo.kicker')}
        title={t('grpo.pendingShipments')}
        description={t('grpo.pendingShipmentsDesc')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={() => navigate('/grpo/manual/new')}
            >
              ✍️ {t('grpo.manualReceiving')}
            </button>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={fetchPendingShipments}
              disabled={loading}
            >
              {loading ? t('common.loading') : `🔄 ${t('grpo.refresh')}`}
            </button>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <section className="card-panel" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', maxWidth: '480px' }}>
            <input
              type="search"
              className="app-input"
              placeholder={t('grpo.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading && shipments.length === 0}
            />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
            {typeof t('grpo.countShipments') === 'function'
              ? t('grpo.countShipments')(filteredShipments.length)
              : `${filteredShipments.length} ${t('grpo.pendingShipments')}`}
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      {loading && shipments.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
            <CircularProgress size={22} />
            <span>{t('grpo.loading')}</span>
          </div>
        </section>
      ) : error && shipments.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={fetchPendingShipments}
          >
            {t('common.retry')}
          </button>
        </section>
      ) : filteredShipments.length === 0 ? (
        <section className="card-panel" style={{ padding: '48px 24px' }}>
          <EmptyState
            icon="📦"
            title={t('grpo.noPendingShipments')}
            message={t('grpo.noPendingShipmentsDesc')}
          />
        </section>
      ) : (
        <section
          className="grpo-shipments-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))',
            gap: '14px',
          }}
        >
          {filteredShipments.map((shipment) => {
            const shipmentKey = getShipmentKey(shipment);
            const isOpening = openingId === shipmentKey;
            const isScale = shipment.source_type === 'scale';

            if (isScale) {
              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={shipmentKey}
                  className="card-panel click-card grpo-scale-card"
                  style={{
                    textAlign: lang === 'ar' ? 'right' : 'left',
                    direction: lang === 'ar' ? 'rtl' : 'ltr',
                    cursor: isOpening ? 'wait' : 'pointer',
                    opacity: isOpening ? 0.7 : 1,
                  }}
                  onClick={() => {
                    if (!isOpening) handleOpenShipment(shipment);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isOpening) {
                      e.preventDefault();
                      handleOpenShipment(shipment);
                    }
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Header: Vehicle Number (Primary Title) + Deterministic Badges Stack */}
                    <div className="grpo-scale-card__header">
                      <div className="grpo-scale-card__vehicle-box">
                        <span aria-hidden="true" className="grpo-scale-card__truck-icon">🚛</span>
                        <strong className="grpo-scale-card__vehicle-title">
                          {shipment.car_number && shipment.car_number !== '-' ? shipment.car_number : (shipment.batch_number || `#${shipment.scale_draft_id}`)}
                        </strong>
                      </div>
                      <div className="grpo-scale-card__badges-stack">
                        <div className="grpo-scale-card__badge-row">
                          <span
                            className="rr-status-badge grpo-scale-card__scale-badge"
                            title={t('grpo.sourceScaleDesc')}
                          >
                            ⚖️ {t('grpo.sourceScale')}
                          </span>
                          {shipment.has_active_draft && shipment.grpo_draft_id && shipment.grpo_draft_status !== 'POSTED' && (
                            <button
                              type="button"
                              className="app-button app-button--danger app-button--compact grpo-scale-card__delete-btn"
                              title={t('common.deleteDraft')}
                              aria-label={t('common.deleteDraft')}
                              onClick={(e) => {
                                e.stopPropagation();
                                setShipmentToDelete(shipment);
                              }}
                              disabled={deletingId === shipmentKey || isOpening}
                            >
                              {deletingId === shipmentKey ? (
                                <CircularProgress size={12} color="inherit" />
                              ) : (
                                <span aria-hidden="true">🗑</span>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="grpo-scale-card__badge-row">
                          {getStatusBadge(shipment)}
                        </div>
                      </div>
                    </div>

                    {/* Secondary Row: Stable 3-Column Ticket Strip */}
                    <div className="grpo-scale-card__ticket-strip">
                      <span className="grpo-scale-card__ticket-label">
                        {t('grpo.scaleDraftNumber')}
                      </span>
                      <span className="grpo-scale-card__ticket-number" dir="ltr">
                        {shipment.batch_number || `#${shipment.scale_draft_id}`}
                      </span>
                      <span className="grpo-scale-card__ticket-date" dir="ltr">
                        {shipment.created_at ? shipment.created_at.slice(0, 10) : '-'}
                      </span>
                    </div>

                    {shipment.quotation_id && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--primary, #047857)', fontWeight: 700, padding: '2px 0' }}>
                        <span>📋 مرجع الشحن: #{shipment.quotation_number || shipment.quotation_id}</span>
                        {shipment.quotation_sap_doc_entry && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748b)', fontWeight: 600 }}>
                            (المرجع: {shipment.quotation_sap_doc_entry})
                          </span>
                        )}
                      </div>
                    )}

                    {/* Main Shipment Details: Supplier & Product */}
                    <div className="grpo-scale-card__info-box">
                      <div className="grpo-scale-card__info-item">
                        <span className="grpo-scale-card__info-label">
                          <span className="meta-label-icon" aria-hidden="true">🏢</span>
                          {t('grpo.supplier')}
                        </span>
                        <strong className="grpo-scale-card__info-val">
                          {shipment.vendor_name || shipment.supplier_name || shipment.vendor_card_code || '-'}
                        </strong>
                      </div>

                      <div className="grpo-scale-card__info-item">
                        <span className="grpo-scale-card__info-label">
                          <span className="meta-label-icon" aria-hidden="true">{getProductIcon(shipment.item_name || shipment.item_code)}</span>
                          {t('grpo.item')}
                        </span>
                        <strong className="grpo-scale-card__info-val">
                          {shipment.item_name || shipment.item_code || '-'}
                        </strong>
                      </div>

                      {shipment.warehouse_code && shipment.warehouse_code !== '-' && (
                        <div className="grpo-scale-card__info-warehouse">
                          <span className="grpo-scale-card__info-label" style={{ marginBottom: 0 }}>
                            <span className="meta-label-icon" aria-hidden="true">🏭</span>
                            {t('grpo.warehouse')}:
                          </span>
                          <strong className="grpo-scale-card__info-val" style={{ fontSize: '0.8rem' }}>
                            {shipment.warehouse_code}
                          </strong>
                        </div>
                      )}
                    </div>

                    {/* Prominent Certified Net Weight Block */}
                    <div className="grpo-scale-card__weight-block">
                      <div className="grpo-scale-card__weight-info">
                        <span className="grpo-scale-card__weight-label">
                          <span className="meta-label-icon" aria-hidden="true">⚖️</span>
                          {t('grpo.quantity')}
                        </span>
                        <span className="grpo-scale-card__weight-certified">
                          ✓ {t('grpo.certifiedWeight')}
                        </span>
                      </div>
                      <div className="grpo-scale-card__weight-value-wrap">
                        <span className="grpo-scale-card__weight-val" dir="ltr">
                          {Number(shipment.quantity || 0).toLocaleString()}
                        </span>
                        <span className="grpo-scale-card__weight-unit">
                          {shipment.uom_name || shipment.uom_code || 'KG'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer / CTA */}
                  <div className="grpo-scale-card__footer">
                    <div className="app-button app-button--primary app-button--block grpo-scale-card__cta">
                      {isOpening ? (
                        <>
                          <CircularProgress size={15} color="inherit" />
                          <span>{t('common.pleaseWait')}</span>
                        </>
                      ) : (
                        <span>{t('grpo.openGrpo')} {lang === 'ar' ? '←' : '→'}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (shipment.is_manual) {
              return (
                <div
                  role="button"
                  tabIndex={0}
                  key={shipmentKey}
                  className="card-panel click-card grpo-scale-card grpo-manual-card"
                  style={{
                    textAlign: lang === 'ar' ? 'right' : 'left',
                    direction: lang === 'ar' ? 'rtl' : 'ltr',
                    cursor: isOpening ? 'wait' : 'pointer',
                    opacity: isOpening ? 0.7 : 1,
                  }}
                  onClick={() => {
                    if (!isOpening) handleOpenShipment(shipment);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isOpening) {
                      e.preventDefault();
                      handleOpenShipment(shipment);
                    }
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Header: Vehicle Number (Primary Title) + Deterministic Badges Stack */}
                    <div className="grpo-scale-card__header">
                      <div className="grpo-scale-card__vehicle-box">
                        <span aria-hidden="true" className="grpo-scale-card__truck-icon">🚛</span>
                        <strong className="grpo-scale-card__vehicle-title">
                          {shipment.car_number && shipment.car_number !== '-' ? shipment.car_number : (shipment.batch_number || `#${shipment.id}`)}
                        </strong>
                      </div>
                      <div className="grpo-scale-card__badges-stack">
                        <div className="grpo-scale-card__badge-row">
                          <span
                            className="rr-status-badge grpo-manual-card__badge"
                            title={t('grpo.manualBadgeDesc')}
                          >
                            ✍️ {t('grpo.manualBadge')}
                          </span>
                          {shipment.has_active_draft && shipment.grpo_draft_id && shipment.grpo_draft_status !== 'POSTED' && (
                            <button
                              type="button"
                              className="app-button app-button--danger app-button--compact grpo-scale-card__delete-btn"
                              title={t('common.deleteDraft')}
                              aria-label={t('common.deleteDraft')}
                              onClick={(e) => {
                                e.stopPropagation();
                                setShipmentToDelete(shipment);
                              }}
                              disabled={deletingId === shipmentKey || isOpening}
                            >
                              {deletingId === shipmentKey ? (
                                <CircularProgress size={12} color="inherit" />
                              ) : (
                                <span aria-hidden="true">🗑</span>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="grpo-scale-card__badge-row">
                          {getStatusBadge(shipment)}
                        </div>
                      </div>
                    </div>

                    {/* Secondary Row: Stable 3-Column Identifier Strip */}
                    <div className="grpo-scale-card__ticket-strip">
                      <span className="grpo-scale-card__ticket-label">
                        {t('grpo.batchNumber')}
                      </span>
                      <span className="grpo-scale-card__ticket-number" dir="ltr">
                        {shipment.batch_number || `#${shipment.id}`}
                      </span>
                      <span className="grpo-scale-card__ticket-date" dir="ltr">
                        {shipment.inspection_date || (shipment.created_at ? shipment.created_at.slice(0, 10) : '-')}
                      </span>
                    </div>

                    {/* Main Shipment Details: Supplier, Product, and Warehouse */}
                    <div className="grpo-scale-card__info-box">
                      <div className="grpo-scale-card__info-item">
                        <span className="grpo-scale-card__info-label">
                          <span className="meta-label-icon" aria-hidden="true">🏢</span>
                          {t('grpo.supplier')}
                        </span>
                        <strong className="grpo-scale-card__info-val">
                          {shipment.vendor_name || shipment.supplier_name || shipment.vendor_card_code || '-'}
                        </strong>
                      </div>

                      <div className="grpo-scale-card__info-item">
                        <span className="grpo-scale-card__info-label">
                          <span className="meta-label-icon" aria-hidden="true">{getProductIcon(shipment.item_name || shipment.item_code)}</span>
                          {t('grpo.item')}
                        </span>
                        <strong className="grpo-scale-card__info-val">
                          {shipment.item_name || shipment.item_code || '-'}
                        </strong>
                      </div>

                      <div className="grpo-scale-card__info-warehouse">
                        <span className="grpo-scale-card__info-label" style={{ marginBottom: 0 }}>
                          <span className="meta-label-icon" aria-hidden="true">🏭</span>
                          {t('grpo.warehouse')}:
                        </span>
                        <strong className="grpo-scale-card__info-val" style={{ fontSize: '0.8rem' }}>
                          {shipment.warehouse_code || '-'}
                        </strong>
                      </div>
                    </div>

                    {/* Quantity Block */}
                    <div className="grpo-scale-card__weight-block grpo-manual-card__weight-block">
                      <div className="grpo-scale-card__weight-info">
                        <span className="grpo-scale-card__weight-label">
                          <span className="meta-label-icon" aria-hidden="true">⚖️</span>
                          {t('grpo.quantity')}
                        </span>
                        <span className="grpo-manual-card__weight-sublabel">
                          {t('grpo.manualBadge')}
                        </span>
                      </div>
                      <div className="grpo-scale-card__weight-value-wrap">
                        <span className="grpo-scale-card__weight-val" dir="ltr">
                          {Number(shipment.quantity || 0).toLocaleString()}
                        </span>
                        <span className="grpo-scale-card__weight-unit">
                          {shipment.uom_name || shipment.uom_code || 'KG'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer / CTA */}
                  <div className="grpo-scale-card__footer">
                    <div className="app-button app-button--primary app-button--block grpo-scale-card__cta">
                      {isOpening ? (
                        <>
                          <CircularProgress size={15} color="inherit" />
                          <span>{t('common.pleaseWait')}</span>
                        </>
                      ) : (
                        <span>{t('grpo.openGrpo')} {lang === 'ar' ? '←' : '→'}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Quality shipment cards (preserved structure)
            const fields = [
              {
                label: t('grpo.batchNumber'),
                value: shipment.batch_number || `#${shipment.id}`,
                icon: '🏷️',
              },
              {
                label: t('grpo.supplier'),
                value: shipment.vendor_name || shipment.supplier_name || shipment.vendor_card_code || '-',
                icon: '🏢',
              },
              {
                label: t('grpo.item'),
                value: shipment.item_name || shipment.item_code || '-',
                icon: getProductIcon(shipment.item_name || shipment.item_code),
              },
              {
                label: t('grpo.quantity'),
                value: `${Number(shipment.quantity || 0).toLocaleString()} ${shipment.uom_name || shipment.uom_code || 'KG'}`,
                icon: '⚖️',
              },
              {
                label: t('grpo.warehouse'),
                value: shipment.warehouse_code || '-',
                icon: '🏭',
              },
              {
                label: t('grpo.inspectionDate'),
                value: shipment.inspection_date || '-',
                icon: '📅',
              },
            ];

            return (
              <div
                role="button"
                tabIndex={0}
                key={shipmentKey}
                className="card-panel click-card"
                style={{
                  textAlign: lang === 'ar' ? 'right' : 'left',
                  direction: lang === 'ar' ? 'rtl' : 'ltr',
                  padding: '16px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--color-bg)',
                  color: 'var(--text)',
                  cursor: isOpening ? 'wait' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease',
                  opacity: isOpening ? 0.7 : 1,
                }}
                onClick={() => {
                  if (!isOpening) handleOpenShipment(shipment);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isOpening) {
                    e.preventDefault();
                    handleOpenShipment(shipment);
                  }
                }}
              >
                {/* Header: Truck Info + Status Badge + Delete Action */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '8px',
                    gap: '8px',
                  }}
                >
                  <strong style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span aria-hidden="true">🚛</span>
                    <span>{shipment.car_number && shipment.car_number !== '-' ? shipment.car_number : shipment.batch_number}</span>
                  </strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {shipment.is_manual ? (
                      <span
                        className="rr-status-badge"
                        title={t('grpo.manualBadgeDesc')}
                        style={{
                          background: 'rgba(14, 165, 233, 0.15)',
                          color: '#0284c7',
                          border: '1px solid rgba(14, 165, 233, 0.4)',
                        }}
                      >
                        ✍️ {t('grpo.manualBadge')}
                      </span>
                    ) : null}
                    {getStatusBadge(shipment)}
                    {shipment.has_active_draft && shipment.grpo_draft_id && shipment.grpo_draft_status !== 'POSTED' && (
                      <button
                        type="button"
                        className="app-button app-button--danger app-button--compact"
                        style={{
                          padding: '4px 6px',
                          minHeight: 'auto',
                          fontSize: '0.88rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                        }}
                        title={t('common.deleteDraft')}
                        aria-label={t('common.deleteDraft')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShipmentToDelete(shipment);
                        }}
                        disabled={deletingId === shipmentKey || isOpening}
                      >
                        {deletingId === shipmentKey ? (
                          <CircularProgress size={14} color="inherit" />
                        ) : (
                          <span aria-hidden="true">🗑</span>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Field Details */}
                <div style={{ display: 'grid', gap: '8px', fontSize: '0.85rem' }}>
                  {fields.map((field) => (
                    <div
                      key={field.label}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: '8px',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        {field.icon && <span className="meta-label-icon" aria-hidden="true">{field.icon}</span>}
                        {field.label}:
                      </span>
                      <strong
                        style={{
                          overflowWrap: 'anywhere',
                          textAlign: lang === 'ar' ? 'left' : 'right',
                          maxWidth: '65%',
                        }}
                      >
                        {field.value}
                      </strong>
                    </div>
                  ))}
                </div>

                {/* Card Footer / CTA */}
                <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px dashed var(--border)' }}>
                  <div
                    className="app-button app-button--primary app-button--block"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      fontSize: '0.88rem',
                    }}
                  >
                    {isOpening ? (
                      <>
                        <CircularProgress size={16} color="inherit" />
                        <span>{t('common.pleaseWait')}</span>
                      </>
                    ) : (
                      <span>{t('grpo.openGrpo')} {lang === 'ar' ? '←' : '→'}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(shipmentToDelete)}
        title={t('grpo.deleteConfirmTitle')}
        message={
          shipmentToDelete
            ? `${t('grpo.confirmDelete')} (${
                shipmentToDelete.source_type === 'scale'
                  ? `${t('grpo.scaleDraftNumber')}: ${shipmentToDelete.batch_number || `#${shipmentToDelete.scale_draft_id}`}`
                  : `${t('grpo.batchNumber')}: ${shipmentToDelete.batch_number || `#${shipmentToDelete.id}`}`
              })`
            : t('grpo.confirmDelete')
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        loading={Boolean(deletingId)}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!deletingId) setShipmentToDelete(null);
        }}
      />
    </div>
  );
}

export default GRPOPage;
