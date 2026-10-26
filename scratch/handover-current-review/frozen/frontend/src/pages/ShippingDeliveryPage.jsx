import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress } from '@mui/material';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { canManagePurchaseQuotation } from '../utils/roles';
import { useToast } from '../components/ui/ToastProvider';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
  cancelPurchaseQuotationDraft,
  createPurchaseQuotationDraft,
  loadPurchaseQuotationDrafts,
} from '../services/purchaseQuotationService';
import { getProductIcon } from '../utils/productIcon';
import '../styles/pages/quality-inspection.css';

function ShippingDeliveryPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const canAdministerQuotation = canManagePurchaseQuotation(user);
  const toast = useToast();

  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadPurchaseQuotationDrafts(search);
      setDrafts(data);
    } catch (err) {
      console.error('Failed to load Shipping & Delivery quotation drafts:', err);
      const msg = err.response?.data?.error || t('purchaseQuotation.errorLoading');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [search, t, toast]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const filteredDrafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((d) => {
      const idStr = String(d.id || '');
      const vendorName = String(d.vendor_name || '').toLowerCase();
      const vendorCode = String(d.vendor_card_code || '').toLowerCase();
      const sapNum = String(d.sap_doc_num || '').toLowerCase();
      const refNo = String(d.vendor_ref_no || '').toLowerCase();
      return (
        idStr.includes(q) ||
        vendorName.includes(q) ||
        vendorCode.includes(q) ||
        sapNum.includes(q) ||
        refNo.includes(q)
      );
    });
  }, [drafts, search]);

  const handleCreateNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const newDraft = await createPurchaseQuotationDraft({
        vendor_card_code: '',
        vendor_name: '',
        posting_date: today,
        valid_until: today,
        document_date: today,
        required_date: today,
        currency: 'EGP',
        lines: [
          {
            item_code: '',
            item_description: '',
            quoted_date: today,
            required_date: today,
            quoted_qty: 1,
            required_qty: 1,
            unit_price: 0,
            discount_percent: 0,
            uom_code: 'PCS',
            warehouse_code: '',
            location_code: '',
            costing_code: '',
          },
        ],
      });
      if (newDraft?.id) {
        toast.success(t('purchaseQuotation.draftCreated'));
        navigate(`/shipping-delivery/${newDraft.id}`);
      }
    } catch (err) {
      console.error('Failed to create quotation draft:', err);
      toast.error(err.response?.data?.error || t('purchaseQuotation.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!draftToDelete) return;
    const targetId = draftToDelete.id;
    setDeletingId(targetId);
    try {
      await cancelPurchaseQuotationDraft(targetId, 'Cancelled from draft card');
      setDrafts((prev) => prev.filter((d) => d.id !== targetId));
      toast.success(t('purchaseQuotation.draftDeleted'));
      setDraftToDelete(null);
    } catch (err) {
      console.error('Failed to delete quotation draft:', err);
      toast.error(err.response?.data?.error || t('purchaseQuotation.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED_FOR_POSTING':
        return (
          <span className="rr-status-badge rr-status-badge--APPROVED_FOR_POSTING">
            {t('purchaseQuotation.statusApprovedForPosting')}
          </span>
        );
      case 'POSTING_FAILED':
        return (
          <span className="rr-status-badge rr-status-badge--POSTING_FAILED">
            {t('purchaseQuotation.statusPostingFailed')}
          </span>
        );
      case 'POSTED':
        return (
          <span className="rr-status-badge rr-status-badge--POSTED">
            {t('purchaseQuotation.statusPosted')}
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="rr-status-badge rr-status-badge--CANCELLED">
            {t('purchaseQuotation.statusCancelled')}
          </span>
        );
      default:
        return (
          <span className="rr-status-badge rr-status-badge--DRAFT">
            {t('purchaseQuotation.statusDraft')}
          </span>
        );
    }
  };

  return (
    <div className="page-shell quality-wizard grpo-page">
      <PageHeader
        eyebrow={t('shippingDelivery.eyebrow') || t('shippingDelivery.title')}
        title={t('shippingDelivery.title')}
        description={t('shippingDelivery.subtitle')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="app-button app-button--primary app-button--compact"
              onClick={handleCreateNew}
              disabled={creating}
            >
              {creating ? (
                <>
                  <CircularProgress size={16} color="inherit" />
                  <span>{t('common.pleaseWait')}</span>
                </>
              ) : (
                <>➕ {t('purchaseQuotation.newQuotation')}</>
              )}
            </button>
            <button
              type="button"
              className="app-button app-button--secondary app-button--compact"
              onClick={fetchDrafts}
              disabled={loading}
            >
              {loading ? t('common.loading') : `🔄 ${t('common.refresh')}`}
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
              placeholder={t('purchaseQuotation.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading && drafts.length === 0}
            />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>
            {filteredDrafts.length} {t('purchaseQuotation.records')}
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      {loading && drafts.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '48px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
            <CircularProgress size={22} />
            <span>{t('common.loading')}</span>
          </div>
        </section>
      ) : error && drafts.length === 0 ? (
        <section className="card-panel" style={{ textAlign: 'center', padding: '40px 16px' }}>
          <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={fetchDrafts}
          >
            {t('common.retry')}
          </button>
        </section>
      ) : filteredDrafts.length === 0 ? (
        <section className="card-panel" style={{ padding: '48px 24px' }}>
          <EmptyState
            icon="📄"
            title={t('purchaseQuotation.noQuotations')}
            message={t('purchaseQuotation.noQuotationsDesc')}
            action={
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={handleCreateNew}
                disabled={creating}
              >
                ➕ {t('purchaseQuotation.newQuotation')}
              </button>
            }
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
          {filteredDrafts.map((item) => {
            const linesCount = Array.isArray(item.lines) ? item.lines.length : 0;
            const itemsText = Array.isArray(item.lines)
              ? item.lines.map((l) => l.item_description || l.item_name || l.item_code || '').join(' ')
              : '';
            const fields = [
              {
                label: t('purchaseQuotation.vendor'),
                value: item.vendor_name || item.vendor_card_code || '-',
                icon: '🏢',
              },
              {
                label: t('purchaseQuotation.postingDate'),
                value: item.posting_date || '-',
                icon: '📅',
              },
              {
                label: t('purchaseQuotation.validUntil'),
                value: item.valid_until || '-',
                icon: '📅',
              },
              {
                label: t('purchaseQuotation.itemsCount'),
                value: `${linesCount} ${t('purchaseQuotation.items')}`,
                icon: getProductIcon(itemsText),
              },
              {
                label: t('purchaseQuotation.totalPaymentDue'),
                value: `${Number(item.total_payment_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${item.currency || 'EGP'}`,
                icon: '💰',
              },
            ];

            return (
              <div
                role="button"
                tabIndex={0}
                key={item.id}
                className="card-panel click-card"
                style={{
                  textAlign: lang === 'ar' ? 'right' : 'left',
                  direction: lang === 'ar' ? 'rtl' : 'ltr',
                  padding: '16px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--color-bg)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: '12px',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease',
                }}
                onClick={() => {
                  const targetPath = item.status === 'POSTED'
                    ? `/shipping-delivery/documents/${item.id}`
                    : `/shipping-delivery/${item.id}`;
                  navigate(targetPath);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const targetPath = item.status === 'POSTED'
                      ? `/shipping-delivery/documents/${item.id}`
                      : `/shipping-delivery/${item.id}`;
                    navigate(targetPath);
                  }
                }}
              >
                {/* Header: Document ID + Status Badge + Delete Action */}
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
                    <span aria-hidden="true">📝</span>
                    <span>#{item.id}</span>
                    {item.sap_doc_num && (
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        ({lang === 'ar' ? 'المرجع' : 'Reference'}: {item.sap_doc_num})
                      </span>
                    )}
                  </strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getStatusBadge(item.status)}
                    {canAdministerQuotation && item.status !== 'POSTED' && item.status !== 'CANCELLED' && (
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
                          setDraftToDelete(item);
                        }}
                        disabled={deletingId === item.id}
                      >
                        {deletingId === item.id ? (
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
                    <span>{t('purchaseQuotation.openDoc')} {lang === 'ar' ? '←' : '→'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(draftToDelete)}
        title={t('purchaseQuotation.deleteConfirmTitle')}
        message={
          draftToDelete
            ? `${t('purchaseQuotation.confirmDelete')} (#${draftToDelete.id})`
            : t('purchaseQuotation.confirmDelete')
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        loading={Boolean(deletingId)}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!deletingId) setDraftToDelete(null);
        }}
      />
    </div>
  );
}

export default ShippingDeliveryPage;
