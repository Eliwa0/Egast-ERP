import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import API from '../services/api';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { useI18n } from '../contexts/I18nContext';
import '../styles/pages/ActivityLogPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFullTimestamp(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;

    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();

    let hours = d.getHours();
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    return `${day}/${month}/${year} ${pad(hours)}:${minutes}:${seconds} ${ampm}`;
  } catch {
    return isoString;
  }
}

function formatTimestampParts(isoString) {
  const formatted = formatFullTimestamp(isoString);
  const [date = formatted, time = '', period = ''] = formatted.split(' ');
  return { date, time: [time, period].filter(Boolean).join(' ') };
}

function ActivityTimestamp({ value }) {
  const timestamp = formatTimestampParts(value);
  return (
    <>
      <span className="activity-timestamp__date">{timestamp.date}</span>
      <span className="activity-timestamp__time">{timestamp.time}</span>
    </>
  );
}

function getActionStyle(action) {
  const a = (action || '').toUpperCase();
  if (['CREATE', 'APPROVE', 'POST', 'OCCUPY', 'LOGIN'].includes(a)) {
    return 'activity-action-badge--success';
  }
  if (['DELETE', 'CANCEL', 'REJECT'].includes(a)) {
    return 'activity-action-badge--danger';
  }
  if (['RELEASE', 'VACATE', 'LOGOUT'].includes(a)) {
    return 'activity-action-badge--warning';
  }
  return 'activity-action-badge--info';
}

function extractDiffs(details) {
  if (!details || typeof details !== 'object') return [];
  const diffs = [];

  // Pattern 1: { before: { ... }, after: { ... } }
  if (details.before && details.after && typeof details.before === 'object' && typeof details.after === 'object') {
    const keys = new Set([...Object.keys(details.before), ...Object.keys(details.after)]);
    keys.forEach((k) => {
      const b = details.before[k];
      const a = details.after[k];
      if (b !== a) {
        diffs.push({
          field: k,
          before: b,
          after: a,
        });
      }
    });
    return diffs;
  }

  // Pattern 2: { old_values: { ... }, new_values: { ... } }
  if (details.old_values && details.new_values && typeof details.old_values === 'object' && typeof details.new_values === 'object') {
    const keys = new Set([...Object.keys(details.old_values), ...Object.keys(details.new_values)]);
    keys.forEach((k) => {
      const b = details.old_values[k];
      const a = details.new_values[k];
      if (b !== a) {
        diffs.push({
          field: k,
          before: b,
          after: a,
        });
      }
    });
    return diffs;
  }

  // Pattern 3: pair keys like old_active / new_active or before_role / after_role
  Object.keys(details).forEach((k) => {
    if (k.startsWith('old_') || k.startsWith('before_')) {
      const stem = k.replace(/^(old_|before_)/, '');
      const newKey = details[`new_${stem}`] !== undefined ? `new_${stem}` : `after_${stem}`;
      if (details[newKey] !== undefined) {
        diffs.push({
          field: stem,
          before: details[k],
          after: details[newKey],
        });
      }
    }
  });

  return diffs;
}

const TECHNICAL_DETAIL_KEYS = new Set([
  'http_method', 'http_status', 'path', 'url_parameters', 'error_type',
  'exception', 'stack_trace', 'traceback', 'sap_response', 'sap_payload',
  'payload', 'response', 'raw_payload_json', 'error', 'errors', 'debug',
]);

const TECHNICAL_DETAIL_KEY_PARTS = [
  'password', 'token', 'secret', 'cookie', 'authorization', 'credential',
  'stack_trace', 'traceback', 'exception', 'raw_payload', 'sap_payload',
  'sap_response', 'http_',
];

const KNOWN_DETAIL_FIELDS = new Set([
  'item_code', 'item_name', 'order_number', 'production_order', 'final_quantity',
  'warehouse', 'warehouse_code', 'warehouse_name', 'vehicle_number', 'car_number',
  'container_number', 'container_quantity', 'batch_number', 'batch_numbers',
  'from_warehouse', 'to_warehouse', 'from_bin', 'to_bin', 'source_bin',
  'source_pallet_position', 'source_pallet_position_code', 'pallet_position',
  'pallet_position_code', 'transfer_reference', 'reservation_reference',
  'reference', 'sap_document_entry', 'sap_document_number', 'sap_doc_entry',
  'sap_doc_num', 'sap_receipt_doc_num', 'quantity', 'total_quantity', 'uom',
  'uom_code', 'reason', 'notes', 'status', 'username', 'role', 'is_active',
  'transfer_stage', 'draft_number', 'first_weight', 'second_weight',
  'product_weight', 'card_code', 'vendor_card_code', 'vendor_name',
  'target_warehouse', 'updated_fields', 'batch', 'attempted_username',
  'target_pallet_position', 'draft_id', 'stage', 'capacity',
  'allocation_type', 'channel_type',
]);

function isTechnicalDetailKey(key) {
  const normalizedKey = String(key || '').toLowerCase();
  return TECHNICAL_DETAIL_KEYS.has(normalizedKey)
    || TECHNICAL_DETAIL_KEY_PARTS.some((part) => normalizedKey.includes(part));
}

function humanizeDetailKey(key, t, lang) {
  if (KNOWN_DETAIL_FIELDS.has(key)) {
    const path = `audit.detailFields.${key}`;
    const translated = t(path);
    if (translated !== path) return translated;
  }
  const words = String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  if (!words) return t('audit.detailUnknownField');
  return lang === 'ar' ? words : words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getBusinessDetailEntries(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const merged = { ...details };
  if (details.request && typeof details.request === 'object' && !Array.isArray(details.request)) {
    Object.entries(details.request).forEach(([key, value]) => {
      if (merged[key] === undefined) merged[key] = value;
    });
  }
  return Object.entries(merged).filter(([key, value]) => (
    !isTechnicalDetailKey(key)
    && key !== 'request'
    && !['before', 'after', 'old_values', 'new_values'].includes(key)
    && value !== undefined
    && value !== null
    && value !== ''
  ));
}

function getBusinessDescription(item) {
  const description = String(item?.description || '');
  const technicalError = item?.details?.error;
  if (typeof technicalError !== 'string' || !technicalError || !description.endsWith(technicalError)) {
    return description;
  }
  return description.slice(0, -technicalError.length).replace(/[\s:;,-]+$/, '');
}

function BusinessValue({ value, t, lang }) {
  if (value === null || value === undefined || value === '') return <span className="activity-business-empty">—</span>;
  if (typeof value === 'boolean') return <>{value ? t('audit.valueYes') : t('audit.valueNo')}</>;
  if (typeof value === 'number') return <>{new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US').format(value)}</>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="activity-business-empty">—</span>;
    return (
      <ul className="activity-business-list">
        {value.map((entry, index) => (
          <li key={index}><BusinessValue value={entry} t={t} lang={lang} /></li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = getBusinessDetailEntries(value);
    if (entries.length === 0) return <span className="activity-business-empty">—</span>;
    return (
      <div className="activity-business-nested">
        {entries.map(([key, nestedValue]) => (
          <div className="activity-business-nested__row" key={key}>
            <span>{humanizeDetailKey(key, t, lang)}</span>
            <strong><BusinessValue value={nestedValue} t={t} lang={lang} /></strong>
          </div>
        ))}
      </div>
    );
  }
  return <>{String(value)}</>;
}

// ── Details Modal Component ───────────────────────────────────────────────────

function ActivityDetailModal({ item, onClose }) {
  const { t, lang } = useI18n();

  if (!item) return null;

  const diffs = extractDiffs(item.details);
  const businessDetails = getBusinessDetailEntries(item.details);
  const businessDescription = getBusinessDescription(item);

  return createPortal(
    <div
      className="simple-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="simple-modal-card activity-detail-modal">
        <div className="simple-modal__header">
          <h2 className="simple-modal__title">{t('audit.detailsTitle')} #{item.id}</h2>
          <button type="button" className="simple-modal__close" onClick={onClose}>×</button>
        </div>

        <div className="activity-detail-modal__body">
          {/* Metadata Grid */}
          <div className="activity-detail-grid">
            <div className="activity-detail-item">
              <span className="activity-detail-label">{t('audit.colTimestamp')}</span>
              <span className="activity-detail-value">{formatFullTimestamp(item.created_at)}</span>
            </div>
            <div className="activity-detail-item">
              <span className="activity-detail-label">{t('audit.colUser')}</span>
              <span className="activity-detail-value">{item.username || 'System'}</span>
            </div>
            <div className="activity-detail-item">
              <span className="activity-detail-label">{t('audit.colModule')}</span>
              <span className="activity-detail-value">{item.module}</span>
            </div>
            <div className="activity-detail-item">
              <span className="activity-detail-label">{t('audit.colAction')}</span>
              <span className="activity-detail-value">{item.action}</span>
            </div>
            <div className="activity-detail-item">
              <span className="activity-detail-label">{t('audit.colStatus')}</span>
              <span className="activity-detail-value">
                <span className={`activity-status-pill activity-status-pill--${item.status || 'SUCCESS'}`}>
                  <span className="activity-status-dot" />
                  {item.status}
                </span>
              </span>
            </div>
            <div className="activity-detail-item">
              <span className="activity-detail-label">{t('audit.colEntity')}</span>
              <span className="activity-detail-value">
                {item.entity_type ? `${item.entity_type}${item.entity_id ? ` #${item.entity_id}` : ''}` : '—'}
              </span>
            </div>
            {item.ip_address && (
              <div className="activity-detail-item">
                <span className="activity-detail-label">{t('audit.colIp')}</span>
                <span className="activity-detail-value">{item.ip_address}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {businessDescription && (
            <div className="activity-desc-box">
              {businessDescription}
            </div>
          )}

          <section className="activity-business-section">
            <h3 className="activity-business-section__title">{t('audit.businessDetailsTitle')}</h3>
            {businessDetails.length > 0 ? (
              <div className="activity-business-grid">
                {businessDetails.map(([key, value]) => (
                  <div className="activity-business-item" key={key}>
                    <span className="activity-business-label">{humanizeDetailKey(key, t, lang)}</span>
                    <div className="activity-business-value">
                      <BusinessValue value={value} t={t} lang={lang} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="activity-business-empty-message">{t('audit.noAdditionalDetails')}</p>
            )}
          </section>

          {/* Structured Diff (if available) */}
          {diffs.length > 0 && (
            <div className="activity-diff-card">
              <div className="activity-diff-title">{t('audit.changesTitle')}</div>
              <table className="activity-diff-table">
                <thead>
                  <tr>
                    <th>{t('audit.diffField')}</th>
                    <th>{t('audit.diffBefore')}</th>
                    <th>{t('audit.diffAfter')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.field}>
                      <td className="activity-diff-field">{humanizeDetailKey(d.field, t, lang)}</td>
                      <td className="activity-diff-val--old"><BusinessValue value={d.before} t={t} lang={lang} /></td>
                      <td className="activity-diff-val--new"><BusinessValue value={d.after} t={t} lang={lang} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="activity-modal-actions">
            <button type="button" className="app-button app-button--secondary" onClick={onClose}>
              {t('audit.close')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main Page Component ───────────────────────────────────────────────────────

export default function ActivityLogPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  // State
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  // Available options from backend
  const [availableModules, setAvailableModules] = useState([]);
  const [availableActions, setAvailableActions] = useState([]);

  // Active filters
  const [search, setSearch] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Selected item for modal
  const [selectedItem, setSelectedItem] = useState(null);

  // Fetch function
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        page_size: pageSize,
      };
      if (search.trim()) params.search = search.trim();
      if (selectedModule) params.module = selectedModule;
      if (selectedAction) params.action = selectedAction;
      if (selectedStatus) params.status = selectedStatus;
      if (userQuery.trim()) params.user = userQuery.trim();
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const res = await API.get('/audit-log/', { params });
      if (res.data && res.data.success) {
        const d = res.data.data;
        setLogs(d.results || []);
        setTotalCount(d.count || 0);
        setTotalPages(d.total_pages || 1);
        if (d.available_modules) setAvailableModules(d.available_modules);
        if (d.available_actions) setAvailableActions(d.available_actions);
      } else {
        setError(res.data?.error || t('audit.errorLoading'));
      }
    } catch (err) {
      console.error('AuditLog fetch error:', err);
      const msg = err.response?.data?.error || err.message || t('audit.errorLoading');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, selectedModule, selectedAction, selectedStatus, userQuery, dateFrom, dateTo, t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Clear filters
  const handleClearFilters = () => {
    setSearch('');
    setSelectedModule('');
    setSelectedAction('');
    setSelectedStatus('');
    setUserQuery('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  // Pagination calculation
  const rangeFrom = useMemo(() => (totalCount === 0 ? 0 : (page - 1) * pageSize + 1), [totalCount, page, pageSize]);
  const rangeTo = useMemo(() => Math.min(page * pageSize, totalCount), [page, pageSize, totalCount]);

  return (
    <div className="activity-log-shell">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="activity-header">
        <div className="activity-header-left">
          <div className="activity-icon-wrap">📋</div>
          <div className="activity-header-copy">
            <span className="section-kicker">{t('common.admin')}</span>
            <h1 className="activity-title">{t('audit.title')}</h1>
            <p className="activity-subtitle">
              {t('audit.subtitle')}
            </p>
          </div>
        </div>

        <div className="activity-header-right">
          <button
            type="button"
            className="app-button app-button--secondary activity-header-button"
            onClick={() => navigate('/users')}
          >
            ← {t('nav.usersPage')}
          </button>
          <button
            type="button"
            className="app-button app-button--secondary activity-header-button"
            onClick={fetchLogs}
            disabled={loading}
          >
            🔄 {t('audit.refresh')}
          </button>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="activity-filter-card">
        <div className="activity-filter-grid">
          {/* Search */}
          <div className="activity-filter-field activity-filter-field--search">
            <label className="activity-filter-label">{t('common.search')}</label>
            <input
              type="text"
              className="activity-input"
              placeholder={t('audit.filterSearch')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          {/* Module */}
          <div className="activity-filter-field activity-filter-field--module">
            <label className="activity-filter-label">{t('audit.filterModule')}</label>
            <select
              className="activity-select"
              value={selectedModule}
              onChange={(e) => { setSelectedModule(e.target.value); setPage(1); }}
            >
              <option value="">{t('audit.allModules')}</option>
              {availableModules.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Action */}
          <div className="activity-filter-field activity-filter-field--action">
            <label className="activity-filter-label">{t('audit.filterAction')}</label>
            <select
              className="activity-select"
              value={selectedAction}
              onChange={(e) => { setSelectedAction(e.target.value); setPage(1); }}
            >
              <option value="">{t('audit.allActions')}</option>
              {availableActions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div className="activity-filter-field activity-filter-field--status">
            <label className="activity-filter-label">{t('audit.filterStatus')}</label>
            <select
              className="activity-select"
              value={selectedStatus}
              onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
            >
              <option value="">{t('audit.allStatuses')}</option>
              <option value="SUCCESS">{t('audit.statusSuccess')}</option>
              <option value="FAILED">{t('audit.statusFailed')}</option>
              <option value="WARNING">{t('audit.statusWarning')}</option>
            </select>
          </div>

          {/* User query */}
          <div className="activity-filter-field activity-filter-field--user">
            <label className="activity-filter-label">{t('audit.filterUser')}</label>
            <input
              type="text"
              className="activity-input"
              placeholder="Username…"
              value={userQuery}
              onChange={(e) => { setUserQuery(e.target.value); setPage(1); }}
            />
          </div>

          {/* Date from */}
          <div className="activity-filter-field activity-filter-field--date">
            <label className="activity-filter-label">{t('audit.filterDateFrom')}</label>
            <input
              type="date"
              className="activity-input"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
          </div>

          {/* Date to */}
          <div className="activity-filter-field activity-filter-field--date">
            <label className="activity-filter-label">{t('audit.filterDateTo')}</label>
            <input
              type="date"
              className="activity-input"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>

          {/* Clear button */}
          <div className="activity-filter-actions">
            <button
              type="button"
              className="app-button app-button--secondary activity-reset-button"
              onClick={handleClearFilters}
            >
              ✕ {t('audit.clearFilters')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Table Card ───────────────────────────────────────────────────── */}
      <div className="activity-table-card">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '1.25rem' }}>
            <AppSpinner size="md" label={t('audit.loading')} />
            <LoadingSkeleton rows={5} style={{ width: '100%' }} />
          </div>
        ) : error ? (
          <div className="activity-state">
            <div className="feedback-message feedback-message--error activity-state__message">
              {error}
            </div>
            <div className="activity-state__actions">
              <button type="button" className="app-button app-button--secondary" onClick={fetchLogs}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="activity-state activity-state--empty">
            <div className="activity-state__icon activity-state__icon--empty">📭</div>
            <h3 className="activity-state__title">{t('audit.emptyTitle')}</h3>
            <p className="activity-state__subtitle">
              {t('audit.emptySubtitle')}
            </p>
          </div>
        ) : (
          <>
            <div className="activity-table-overflow">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>{t('audit.colTimestamp')}</th>
                    <th>{t('audit.colUser')}</th>
                    <th>{t('audit.colModule')}</th>
                    <th>{t('audit.colAction')}</th>
                    <th>{t('audit.colEntity')}</th>
                    <th>{t('audit.colDescription')}</th>
                    <th>{t('audit.colStatus')}</th>
                    <th className="activity-details-cell">{t('audit.colDetails')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((item) => (
                    <tr key={item.id}>
                      {/* Timestamp with seconds */}
                      <td className="activity-timestamp">
                        <ActivityTimestamp value={item.created_at} />
                      </td>

                      {/* User */}
                      <td>
                        <div className="activity-user-cell">
                          <span className="activity-user-avatar">
                            {(item.username || '?').substring(0, 2)}
                          </span>
                          <span className="activity-user-name">
                            {item.username || 'System'}
                          </span>
                        </div>
                      </td>

                      {/* Module */}
                      <td>
                        <span className="activity-module-badge">
                          {item.module}
                        </span>
                      </td>

                      {/* Action */}
                      <td>
                        <span className={`activity-action-badge ${getActionStyle(item.action)}`}>
                          {item.action}
                        </span>
                      </td>

                      {/* Entity */}
                      <td>
                        {item.entity_id ? (
                          <span className="activity-entity-code">
                            {item.entity_type ? `${item.entity_type} ` : ''}#{item.entity_id}
                          </span>
                        ) : (
                          <span className="activity-cell-muted">—</span>
                        )}
                      </td>

                      {/* Description */}
                      <td>
                        <div className="activity-description-text" title={item.description}>
                          {item.description || '—'}
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`activity-status-pill activity-status-pill--${item.status || 'SUCCESS'}`}>
                          <span className="activity-status-dot" />
                          {item.status}
                        </span>
                      </td>

                      {/* View Details Action */}
                      <td className="activity-details-cell">
                        <button
                          type="button"
                          className="app-button app-button--secondary activity-details-button"
                          onClick={() => setSelectedItem(item)}
                        >
                          👁️ {t('audit.viewDetails')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ──────────────────────────────────────────────── */}
            <div className="activity-pagination">
              <div className="activity-pagination-info">
                {t('audit.showingCount')
                  .replace('{from}', rangeFrom)
                  .replace('{to}', rangeTo)
                  .replace('{total}', totalCount)}
              </div>

              <div className="activity-pagination-controls">
                <button
                  type="button"
                  className="activity-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  title={t('audit.first')}
                >
                  «
                </button>
                <button
                  type="button"
                  className="activity-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('audit.prev')}
                </button>

                <span className="activity-page-current">
                  {t('audit.page')} {page} / {totalPages || 1}
                </span>

                <button
                  type="button"
                  className="activity-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('audit.next')}
                </button>
                <button
                  type="button"
                  className="activity-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                  title={t('audit.last')}
                >
                  »
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Details Modal ─────────────────────────────────────────────────── */}
      {selectedItem && (
        <ActivityDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
