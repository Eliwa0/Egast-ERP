/**
 * Customization & Delivery - read-only document list.
 *
 * Shared by the Customization (Sales Quotations) and Delivery (Sales Orders)
 * screens. Only the column set and the date labels differ between the two, so the
 * fetch/render/empty/error handling lives here once.
 *
 * The record key (`primaryDateKey` / `secondaryDateKey`) and its column label
 * (`dateColumnLabel` / `secondaryDateLabel`) are separate props on purpose.
 * Deriving the label from the record key renders a raw translation key whenever
 * the two naming styles differ.
 *
 * There is deliberately no create, edit, post or cancel affordance anywhere in
 * this component. The module is read-only in SAP and in the backend.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import PageHeader from '../components/ui/PageHeader';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import EmptyState from '../components/ui/EmptyState';
import '../styles/pages/customization-delivery.css';

export function formatQuantity(value) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return numeric.toLocaleString();
}

export function formatMoney(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  const amount = numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${amount} ${currency}` : amount;
}

function StatusPill({ label, code }) {
  if (!label) return <span className="cd-status cd-status--none">—</span>;
  const key = String(code || '').toLowerCase();
  return (
    <span className={`cd-status cd-status--${key}`}>
      {label}
    </span>
  );
}

export default function SalesDocumentListPage({
  title,
  description,
  emptyTitle,
  emptyMessage,
  dateColumnLabel,
  primaryDateKey,
  secondaryDateKey,
  secondaryDateLabel,
  fetcher,
  detailPath,
  statusOptions = [],
  actionLabel,
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState(null);
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page_size: 50, offset };
      if (status) params.status = status;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const payload = await fetcher(params);
      setDocuments(payload.documents || []);
      setHasMore(Boolean(payload.has_more));
      setNextOffset(payload.next_offset ?? (offset + (payload.documents || []).length));
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [fetcher, status, dateFrom, dateTo, offset, t]);

  useEffect(() => {
    load();
  }, [load]);

  const resetFilters = () => {
    setOffset(0);
    setStatus('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = Boolean(status || dateFrom || dateTo);

  return (
    <div className="home-page cd-list-page">
      <PageHeader title={title} description={description} />

      <div className="card-panel cd-filters">
        <label className="cd-field">
          <span>{t('customizationDelivery.filters.status')}</span>
          <select
            className="app-input"
            value={status}
            onChange={(event) => { setOffset(0); setStatus(event.target.value); }}
          >
            <option value="">{t('customizationDelivery.filters.allStatuses')}</option>
            {statusOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="cd-field">
          <span>{t('customizationDelivery.filters.dateFrom')}</span>
          <input
            type="date"
            className="app-input"
            value={dateFrom}
            onChange={(event) => { setOffset(0); setDateFrom(event.target.value); }}
          />
        </label>

        <label className="cd-field">
          <span>{t('customizationDelivery.filters.dateTo')}</span>
          <input
            type="date"
            className="app-input"
            value={dateTo}
            onChange={(event) => { setOffset(0); setDateTo(event.target.value); }}
          />
        </label>

        <div className="cd-filter-actions">
          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={resetFilters}
            disabled={!hasFilters || loading}
          >
            {t('customizationDelivery.filters.clear')}
          </button>
        </div>
      </div>

      {error && (
        <div className="cd-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={load}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : documents.length === 0 && !error ? (
        <EmptyState
          icon="📄"
          title={emptyTitle}
          message={hasFilters ? t('customizationDelivery.emptyFiltered') : emptyMessage}
        />
      ) : (
        <>
          <div className="cd-table-wrap">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>{t('customizationDelivery.columns.documentNumber')}</th>
                  <th>{t('customizationDelivery.columns.customer')}</th>
                  <th>{dateColumnLabel}</th>
                  <th>{secondaryDateLabel}</th>
                  <th>{t('customizationDelivery.columns.status')}</th>
                  <th>{t('customizationDelivery.columns.currency')}</th>
                  <th style={{ textAlign: 'center' }}>{t('customizationDelivery.workflow.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr
                    key={document.document_entry}
                    className="cd-row"
                    onClick={() => navigate(detailPath(document.document_entry))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        navigate(detailPath(document.document_entry));
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`${t('customizationDelivery.columns.documentNumber')} ${document.document_number}`}
                  >
                    <td className="cd-strong">{document.document_number || '—'}</td>
                    <td>
                      <div className="cd-customer">{document.customer_name || '—'}</div>
                      {document.customer_code && (
                        <div className="cd-muted">{document.customer_code}</div>
                      )}
                    </td>
                    <td>{document[primaryDateKey] || '—'}</td>
                    <td>{document[secondaryDateKey] || '—'}</td>
                    <td>
                      <StatusPill label={document.status_label} code={document.status_code} />
                    </td>
                    <td>{document.currency || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="app-button app-button--secondary"
                        style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(detailPath(document.document_entry));
                        }}
                      >
                        {actionLabel || t('common.view')} →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {offset > 0 && <button type="button" className="app-button app-button--ghost" disabled={loading} onClick={() => setOffset(Math.max(0, offset - 50))}>{t('common.previous')}</button>}
          {hasMore && (
            <button type="button" className="app-button app-button--ghost" disabled={loading} onClick={() => setOffset(nextOffset)}>{t('common.next')}</button>
          )}
        </>
      )}

      <p className="cd-readonly-note">{t('customizationDelivery.workflowGuidanceNote')}</p>
    </div>
  );
}
