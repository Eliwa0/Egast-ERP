import { warehouseSearch, userSearch } from '../services/masterDataSearch';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import AppSpinner from '../components/ui/AppSpinner';
import ProductionPalletTypesPanel from '../components/ProductionPalletTypesPanel';
import { canAccessProductionRules } from '../utils/roles';
import { getProductIcon } from '../utils/productIcon';

// ── Constants ────────────────────────────────────────────────────────────────

const RULE_FIELDS = [
  { key: 'size',                label: 'Size' },
  { key: 'brand',               label: 'Brand' },
  { key: 'category',            label: 'Category' },
  { key: 'packing',             label: 'Packing' },
  { key: 'season',              label: 'Season' },
  { key: 'extra_specification', label: 'Extra Spec.' },
  { key: 'vendor',              label: 'Vendor' },
  { key: 'part',                label: 'Part' },
  { key: 'company',             label: 'Company' },
  { key: 'uom',                 label: 'UOM' },
];

// Display fields for Order/User tabs: RULE_FIELDS (value rules + visibility) + text-only fields (visibility only)
// uom is excluded from visibility since it is not part of ATTR_FIELDS in the Receipt Wizard
const ORDER_USER_DISPLAY_FIELDS = [
  ...RULE_FIELDS.map((f) => ({ ...f, hasVis: f.key !== 'uom' })),
  { key: 'number',  label: 'Number',  textOnly: true, hasVis: true },
  { key: 'details', label: 'Details', textOnly: true, hasVis: true },
];

// ── Session cache (module-level — survives tab switches and remounts) ─────────
// null = not yet loaded;  value = loaded (may be empty array/object)
const PRODUCTION_RULES_SCOPED_CSS = `
  .warehouse-rules-layout,
  .warehouse-rules-layout > *,
  .warehouse-rules-layout .rules-panel,
  .warehouse-rules-layout .rules-sidebar,
  .warehouse-rules-layout .rules-panel__form-mb,
  .warehouse-select-wrap {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .warehouse-rules-layout {
    overflow-x: hidden;
  }

  .warehouse-rules-layout .rules-panel,
  .warehouse-select-wrap {
    overflow-x: hidden;
  }

  .warehouse-select-wrap {
    position: relative;
  }

  .warehouse-select {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    min-height: 44px;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    cursor: pointer;
  }

  .warehouse-select-native {
    display: none;
  }

  .warehouse-select-menu {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    margin-top: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-muted);
    max-height: min(46vh, 260px);
    overflow-y: auto;
    overflow-x: hidden;
  }

  .warehouse-select-option {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    display: block;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .warehouse-select-option:last-child {
    border-bottom: 0;
  }

  .warehouse-select-option:hover,
  .warehouse-select-option--selected {
    background: var(--bg-primary-soft);
    color: var(--primary);
  }

  @media (max-width: 480px) {
    .warehouse-select-wrap,
    .warehouse-select,
    .warehouse-select-menu,
    .warehouse-select-option {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
  }

  .order-visibility-layout {
    overflow: visible;
  }

  .order-visibility-layout .rules-sidebar {
    position: relative;
    z-index: 20;
    overflow: visible;
  }

  .order-visibility-layout .rules-panel {
    position: relative;
    z-index: 1;
  }

  .order-visibility-layout .wh-search-wrap {
    position: relative;
    z-index: 30;
    overflow: visible;
  }

  .order-visibility-layout .wh-dropdown {
    z-index: 1000;
    max-height: min(52vh, 320px);
    overflow-y: auto;
    overflow-x: hidden;
  }
`;

const _cache = {
  uomOpts:     null,
  companyOpts: null,
  metadata:    null,
  itemAttrs:   {},    // { [itemCode]: attrs }
};

// Safe timer helpers (prevent duplicate warnings from StrictMode double-fire)
const _rt = new Set();
const rpt    = (l) => { if (!_rt.has(l)) { _rt.add(l); console.time(l); } };
const rptEnd = (l) => { if (_rt.has(l))  { _rt.delete(l); console.timeEnd(l); } };

// ── Module-level fetch helpers (all use cache) ────────────────────────────────

async function _getUomOpts() {
  if (_cache.uomOpts !== null) return _cache.uomOpts;
  rpt('rules-uoms');
  try {
    const r = await API.get('/uoms/');
    rptEnd('rules-uoms');
    _cache.uomOpts = (r.data.data?.uoms || []).map((u) => ({
      value: u.value,
      label: `${u.value} — ${u.label}`,
    }));
  } catch (e) {
    rptEnd('rules-uoms');
    console.warn('rules-uoms failed:', e?.message);
    _cache.uomOpts = [];
  }
  return _cache.uomOpts;
}

async function _getCompanyOpts() {
  if (_cache.companyOpts !== null) return _cache.companyOpts;
  rpt('rules-company');
  try {
    const r = await API.get('/company-options/');
    rptEnd('rules-company');
    const d = r.data;
    const raw = Array.isArray(d?.companies) ? d.companies
              : Array.isArray(d?.data?.companies) ? d.data.companies
              : [];
    _cache.companyOpts = raw.map((c) => ({
      value: c.value ?? c,
      label: c.label ?? c.value ?? String(c),
    }));
  } catch (e) {
    rptEnd('rules-company');
    console.warn('rules-company failed:', e?.message);
    _cache.companyOpts = [];
  }
  return _cache.companyOpts;
}

async function _getItemAttrs(itemCode) {
  if (_cache.itemAttrs[itemCode]) return _cache.itemAttrs[itemCode];
  rpt('rules-item-attrs');
  try {
    const r = await API.get(`/item-batch-attributes/${itemCode}/`);
    rptEnd('rules-item-attrs');
    _cache.itemAttrs[itemCode] = r.data.data || {};
  } catch (e) {
    rptEnd('rules-item-attrs');
    console.warn('rules-item-attrs failed:', e?.message);
    _cache.itemAttrs[itemCode] = {};
  }
  return _cache.itemAttrs[itemCode];
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildFieldOptions(fieldKey, attrs, metadata, uomOpts, companyOpts) {
  if (fieldKey === 'uom')     return uomOpts;
  if (fieldKey === 'company') return companyOpts;
  const stored = (attrs?.field_options?.[fieldKey] || []).map((i) => ({
    value: i.value,
    label: i.description && i.description !== i.value ? `${i.value} — ${i.description}` : i.value,
  }));
  const meta = (metadata?.[fieldKey]?.valid_values || []).map((i) => ({
    value: i.value,
    label: i.description && i.description !== i.value ? `${i.value} — ${i.description}` : i.value,
  }));
  const extra = fieldKey === 'vendor'
    ? (attrs?.vendors || []).map((v) => ({ value: v.code, label: `${v.code} — ${v.name}` }))
    : [];
  const seen = new Set();
  return [...stored, ...meta, ...extra].filter((i) => {
    if (!i?.value || seen.has(i.value)) return false;
    seen.add(i.value);
    return true;
  });
}

function _rebuildOpts(attrs, meta, uomOpts, companyOpts) {
  const opts = {};
  for (const f of RULE_FIELDS) {
    opts[f.key] = buildFieldOptions(f.key, attrs, meta, uomOpts, companyOpts);
  }
  return opts;
}

// ── Shared UI components ──────────────────────────────────────────────────────

function MetadataBanner({ loading, error, onRetry }) {
  const { t } = useI18n();
  if (!loading && !error) return null;
  return (
    <div className={`metadata-banner${error ? ' metadata-banner--error' : ''}`}>
      <span>{loading ? t('rules.metadataLoading') : t('rules.metadataError')}</span>
      {error && !loading && (
        <button type="button" className="metadata-banner__retry" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

function FieldRuleEditor({ fieldDef, opts, selected, onChange, metadataLoading, isVisible, onVisibilityChange }) {
  const { t } = useI18n();
  const isAllAllowed = !fieldDef.textOnly && selected.length === 0;
  const noOpts = opts.length === 0;
  const hasVisCtrl = onVisibilityChange !== undefined;
  const isHidden = hasVisCtrl && !isVisible;

  return (
    <div className={[
      'field-rule-editor',
      !fieldDef.textOnly && !isAllAllowed ? 'field-rule-editor--active' : '',
      isHidden ? 'field-rule-editor--muted' : '',
    ].filter(Boolean).join(' ')}>
      <div className="field-rule-editor__header">
        <span className="field-rule-editor__title">{fieldDef.label}</span>
        <div className="field-rule-editor__header-controls">
          {!fieldDef.textOnly && (
            <label className={`field-rule-editor__all-label ${isAllAllowed ? 'field-rule-editor__all-label--allowed' : 'field-rule-editor__all-label--restricted'}`}>
              <input type="checkbox" checked={isAllAllowed} onChange={() => onChange([])} />
              {t('rules.allAllowed')}
            </label>
          )}
          {hasVisCtrl && (
            <label className={`field-rule-editor__vis-label ${isVisible ? 'field-rule-editor__vis-label--visible' : 'field-rule-editor__vis-label--hidden'}`}>
              <input type="checkbox" checked={!!isVisible} onChange={() => onVisibilityChange(!isVisible)} />
              {isVisible ? t('rules.visible') : t('rules.hiddenLabel')}
            </label>
          )}
        </div>
      </div>

      {!fieldDef.textOnly && (
        noOpts && metadataLoading ? (
          <span className="field-rule-editor__loading">⏳ {t('common.loading')}</span>
        ) : noOpts ? (
          <span className="field-rule-editor__loading">{t('rules.noFieldOptions')}</span>
        ) : (
          <div className="field-rule-editor__chips">
            {opts.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <button key={opt.value} type="button"
                  onClick={() => onChange(checked
                    ? selected.filter((v) => v !== opt.value)
                    : [...selected, opt.value])}
                  className={`field-rule-editor__chip ${checked ? 'field-rule-editor__chip--on' : 'field-rule-editor__chip--off'}`}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        )
      )}

      {!fieldDef.textOnly && !isAllAllowed && (
        <div className="field-rule-editor__count">
          {t('rules.valuesAllowed', selected.length)}
        </div>
      )}
    </div>
  );
}

function FeedbackMsg({ error, success }) {
  if (error)   return <div className="feedback-message feedback-message--error rules-feedback">{error}</div>;
  if (success) return <div className="feedback-message feedback-message--success rules-feedback">{success}</div>;
  return null;
}

function SidebarCard({ isActive, onClick, title, subtitle, badge, onDelete, deleting }) {
  const { t } = useI18n();
  return (
    <div onClick={onClick} className={`sidebar-card${isActive ? ' sidebar-card--active' : ''}`}>
      <div className="sidebar-card__title">{title}</div>
      {subtitle && <div className="sidebar-card__subtitle">{subtitle}</div>}
      {badge && <div className="sidebar-card__badge">{badge}</div>}
      {onDelete && (
        <button type="button" className="app-button app-button--danger sidebar-card__delete-btn"
          disabled={deleting}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          {deleting ? t('rules.deleting') : t('rules.deleteAllRules')}
        </button>
      )}
    </div>
  );
}

// ── Tab 1: Production Order Rules ─────────────────────────────────────────────

function OrderRulesTab() {
  const { t } = useI18n();
  const [orderNumInput, setOrderNumInput] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [currentOrder, setCurrentOrder] = useState(null);
  const [fieldOptions, setFieldOptions] = useState({});
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [localRules, setLocalRules] = useState({});
  const [localVisibility, setLocalVisibility] = useState([]); // hidden fields for current order
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [allOrders, setAllOrders] = useState([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [deletingEntry, setDeletingEntry] = useState(null);

  // Stores latest fast-source data so metadata retry can rebuild options
  const srcRef = useRef({ attrs: {}, uomOpts: [], companyOpts: [] });

  const refreshAllOrders = useCallback(async () => {
    try {
      const [valueRes, visRes] = await Promise.allSettled([
        API.get('/admin/attribute-rules/'),
        API.get('/admin/order-attribute-visibility/'),
      ]);
      const valueOrders = valueRes.status === 'fulfilled' ? valueRes.value.data.data?.orders || [] : [];
      const visOrders   = visRes.status   === 'fulfilled' ? visRes.value.data.data?.orders  || [] : [];
      const merged = {};
      for (const o of valueOrders)
        merged[o.doc_entry] = { ...o, hidden_fields: [] };
      for (const o of visOrders) {
        if (merged[o.doc_entry]) merged[o.doc_entry].hidden_fields = o.hidden_fields;
        else merged[o.doc_entry] = { doc_entry: o.doc_entry, doc_num: o.doc_num, item_code: o.item_code, item_name: o.item_name, rules: {}, hidden_fields: o.hidden_fields };
      }
      setAllOrders(Object.values(merged));
    } catch { /* ignore */ }
    finally { setLoadingAll(false); }
  }, []);

  useEffect(() => { refreshAllOrders(); }, [refreshAllOrders]);

  // ── Load metadata in background, update fieldOptions when ready ────────────
  const loadMetadata = useCallback(() => {
    if (_cache.metadata !== null) {
      // Already cached — rebuild opts immediately
      const { attrs, uomOpts, companyOpts } = srcRef.current;
      setFieldOptions(_rebuildOpts(attrs, _cache.metadata, uomOpts, companyOpts));
      return;
    }
    setMetadataLoading(true);
    setMetadataError(false);
    rpt('rules-metadata');
    API.get('/batch-udf-metadata/')
      .then((r) => {
        rptEnd('rules-metadata');
        _cache.metadata = r.data.data?.fields || {};
        const { attrs, uomOpts, companyOpts } = srcRef.current;
        setFieldOptions(_rebuildOpts(attrs, _cache.metadata, uomOpts, companyOpts));
      })
      .catch((e) => {
        rptEnd('rules-metadata');
        console.warn('rules-metadata failed:', e?.message);
        setMetadataError(true);
      })
      .finally(() => setMetadataLoading(false));
  }, []);

  // ── Fetch options for a selected order ────────────────────────────────────
  const fetchOptionsForOrder = useCallback(async (order) => {
    setLoadingOptions(true);
    setMetadataError(false);
    setMetadataLoading(false);

    // Fire all fast sources in parallel (UOM, company, item-specific attrs)
    // Metadata fires separately in background after these finish.
    rpt('rules-fast-sources');
    const [uomOpts, companyOpts, attrs] = await Promise.all([
      _getUomOpts(),
      _getCompanyOpts(),
      _getItemAttrs(order.itemCode),
    ]);
    rptEnd('rules-fast-sources');

    // Store for metadata retry
    srcRef.current = { attrs, uomOpts, companyOpts };

    // Build and show initial options immediately (with cached metadata if available)
    setFieldOptions(_rebuildOpts(attrs, _cache.metadata || {}, uomOpts, companyOpts));
    setLoadingOptions(false);

    // Metadata loads in background — updates opts when ready
    loadMetadata();
  }, [loadMetadata]);

  const handleLookup = useCallback(async (docNumStr) => {
    const trimmed = String(docNumStr || '').trim();
    if (!trimmed) return;
    setLookingUp(true);
    setLookupError('');
    setCurrentOrder(null);
    setFieldOptions({});
    setLocalRules({});
    setLocalVisibility([]);
    setSaveSuccess('');
    setSaveError('');
    try {
      const orderRes = await API.get(`/production-orders/by-number/${trimmed}/`);
      const ord = orderRes.data.data?.order;
      if (!ord) { setLookupError(t('rules.orderNotFound')); return; }
      const docEntry = ord.AbsoluteEntry || ord.DocEntry;
      const order = {
        docEntry,
        docNum:   ord.DocumentNumber || ord.DocNum || trimmed,
        itemCode: ord.ItemNo || ord.ItemCode || '',
        itemName: ord.ItemName || ord.ItemDescription || '',
      };
      setCurrentOrder(order);
      const [, rulesRes, visRes] = await Promise.all([
        fetchOptionsForOrder(order),
        API.get(`/production-order-attribute-rules/${docEntry}/`),
        API.get(`/order-attribute-visibility/${docEntry}/`).catch(() => ({ data: { data: { hidden_fields: [] } } })),
      ]);
      const existing = rulesRes.data.data?.rules || {};
      const init = {};
      for (const f of RULE_FIELDS) init[f.key] = existing[f.key] || [];
      setLocalRules(init);
      setLocalVisibility(visRes.data.data?.hidden_fields || []);
    } catch (err) {
      setLookupError(err.response?.data?.error || err.message || 'Failed to load order.');
    } finally { setLookingUp(false); }
  }, [fetchOptionsForOrder, t]);

  const handleLoadFromSidebar = useCallback(async (entry) => {
    const order = {
      docEntry: entry.doc_entry,
      docNum:   entry.doc_num,
      itemCode: entry.item_code,
      itemName: entry.item_name,
    };
    setOrderNumInput(String(entry.doc_num || ''));
    setCurrentOrder(order);
    setSaveSuccess('');
    setSaveError('');
    setLookupError('');
    const init = {};
    for (const f of RULE_FIELDS) init[f.key] = entry.rules?.[f.key] || [];
    setLocalRules(init);
    setLocalVisibility(entry.hidden_fields || []);
    await fetchOptionsForOrder(order);
  }, [fetchOptionsForOrder]);

  

  const handleSave = async () => {
    if (!currentOrder) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      await API.post('/admin/attribute-rules/save/', {
        doc_entry: currentOrder.docEntry,
        doc_num:   currentOrder.docNum,
        item_code: currentOrder.itemCode,
        item_name: currentOrder.itemName,
        rules:     localRules,
      });
      await API.post('/admin/order-attribute-visibility/set/', {
        doc_entry: currentOrder.docEntry,
        doc_num:   currentOrder.docNum,
        item_code: currentOrder.itemCode,
        item_name: currentOrder.itemName,
        hidden_fields: localVisibility,
      });
      setSaveSuccess(t('rules.savedMsg'));
      refreshAllOrders();
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Failed to save.');
    } finally { setSaving(false); }
  };

  const handleDeleteOrder = async (docEntry) => {
    if (!window.confirm(t('rules.confirmDeleteOrder'))) return;
    setDeletingEntry(docEntry);
    try {
      try { await API.delete(`/admin/attribute-rules/order/${docEntry}/`); } catch { /* may not exist */ }
      try { await API.delete(`/admin/order-attribute-visibility/order/${docEntry}/`); } catch { /* may not exist */ }
      if (currentOrder?.docEntry === docEntry) {
        const reset = {};
        for (const f of RULE_FIELDS) reset[f.key] = [];
        setLocalRules(reset);
        setLocalVisibility([]);
        setSaveSuccess(t('rules.clearedOrder'));
      }
      refreshAllOrders();
    } catch (err) {
      alert(t('rules.deleteFailed', err.response?.data?.error || err.message));
    } finally { setDeletingEntry(null); }
  };

  const configuredCount = RULE_FIELDS.filter((f) => (localRules[f.key] || []).length > 0).length;
  localVisibility.length;

  return (
    <div className="rules-tab-layout">
      <section className="card-panel rules-sidebar">
        <h2 className="rules-sidebar__title">{t('rules.configuredOrders')}</h2>
        {loadingAll ? (
          <span className="rules-sidebar__loading">{t('rules.loadingOrders')}</span>
        ) : allOrders.length === 0 ? (
          <span className="rules-sidebar__empty">{t('rules.noOrders')}</span>
        ) : (
          <div className="rules-sidebar__list">
            {allOrders.map((o) => {
              const rCount = Object.keys(o.rules || {}).length;
              const hCount = (o.hidden_fields || []).length;
              const badge = [
                rCount > 0 ? t('rules.valueRules', rCount) : '',
                hCount > 0 ? t('rules.hidden', hCount) : '',
              ].filter(Boolean).join(' · ') || t('rules.configured');
              return (
                <SidebarCard key={o.doc_entry}
                  isActive={currentOrder?.docEntry === o.doc_entry}
                  onClick={() => handleLoadFromSidebar(o)}
                  title={t('rules.orderNum', o.doc_num)}
                  subtitle={o.item_code ? `${getProductIcon(o.item_name || o.item_code)} ${o.item_code}${o.item_name ? ` — ${o.item_name}` : ''}` : undefined}
                  badge={badge}
                  onDelete={() => handleDeleteOrder(o.doc_entry)}
                  deleting={deletingEntry === o.doc_entry}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="card-panel rules-panel">
        <form onSubmit={(e) => { e.preventDefault(); handleLookup(orderNumInput); }}
          className="rules-panel__lookup-form">
          <input className="app-input app-input--flex" type="text" placeholder={t('rules.enterOrderNum')}
            value={orderNumInput} onChange={(e) => setOrderNumInput(e.target.value)}
            autoFocus />
          <button type="submit" className="app-button app-button--primary rules-panel__lookup-btn"
            disabled={lookingUp || !orderNumInput.trim()}>
            {lookingUp ? t('rules.loading') : t('rules.load')}
          </button>
        </form>

        {lookupError && (
          <div className="feedback-message feedback-message--error rules-error-mb">{lookupError}</div>
        )}

        {!currentOrder && !lookingUp && !lookupError && (
          <div className="rules-panel__empty-hint">
            {t('rules.noRulesHint')}<br />
            <span>{t('rules.noRulesHintSub')}</span>
          </div>
        )}

        {loadingOptions && (
          <div className="rules-panel__loading">{t('rules.loadingOptions')}</div>
        )}

        {currentOrder && !loadingOptions && (
          <>
            <div className="rules-panel__info-box">
              <span className="rules-panel__info-icon">{getProductIcon(currentOrder.itemName || currentOrder.itemCode)}</span>
              <div>
                <div className="rules-panel__info-title">{t('rules.orderNum', currentOrder.docNum)}</div>
                <div className="rules-panel__info-sub">
                  {currentOrder.itemCode}{currentOrder.itemName ? ` — ${currentOrder.itemName}` : ''}
                </div>
              </div>
              {configuredCount > 0 && (
                <span className="rules-panel__restricted-badge">
                  {t('rules.fieldsRestricted', configuredCount)}
                </span>
              )}
            </div>

            <MetadataBanner
              loading={metadataLoading}
              error={metadataError}
              onRetry={loadMetadata}
            />

            <div className="rules-panel__field-list">
              {ORDER_USER_DISPLAY_FIELDS.map((f) => (
                <FieldRuleEditor key={f.key} fieldDef={f}
                  opts={f.textOnly ? [] : (fieldOptions[f.key] || [])}
                  selected={localRules[f.key] || []}
                  metadataLoading={metadataLoading}
                  onChange={(vals) => !f.textOnly && setLocalRules((prev) => ({ ...prev, [f.key]: vals }))}
                  {...(f.hasVis ? {
                    isVisible: !localVisibility.includes(f.key),
                    onVisibilityChange: (vis) => setLocalVisibility((prev) =>
                      vis ? prev.filter((k) => k !== f.key) : [...prev, f.key]
                    ),
                  } : {})}
                />
              ))}
            </div>

            <FeedbackMsg error={saveError} success={saveSuccess} />
            <button type="button" className="app-button app-button--primary app-button--block rules-save-btn"
              disabled={saving} aria-busy={saving ? 'true' : 'false'} onClick={handleSave}>
              {saving ? (
                <>
                  <AppSpinner size="xs" />
                  <span>{t('rules.saving')}</span>
                </>
              ) : (
                t('rules.saveRules')
              )}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

// ── Tab 2: User Attribute Rules ───────────────────────────────────────────────

function UserRulesTab() {
  const { t } = useI18n();
  const [users, setUsers] = useState([]);
  const loadingUsers = false;
  const [allUserRules, setAllUserRules] = useState({});
  const [allUserVisibility, setAllUserVisibility] = useState({}); // { user_id: hidden_fields[] }
  const [configuredUsers, setConfiguredUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [localRules, setLocalRules] = useState({});
  const [localVisibility, setLocalVisibility] = useState([]); // hidden fields for selected user
  const [generalOptions, setGeneralOptions] = useState({});
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  // Stores fast-source opts for metadata retry
  const srcRef = useRef({ uomOpts: [], companyOpts: [] });

  const refreshUserRules = useCallback(async () => {
    try {
      const [rulesRes, visRes] = await Promise.allSettled([
        API.get('/admin/user-attribute-rules/'),
        API.get('/admin/user-attribute-visibility/'),
      ]);
      const rulesList = rulesRes.status === 'fulfilled' ? rulesRes.value.data.data?.users || [] : [];
      const visList   = visRes.status   === 'fulfilled' ? visRes.value.data.data?.users   || [] : [];

      const rulesMap = {};
      for (const u of rulesList) rulesMap[u.user_id] = u.rules;
      setAllUserRules(rulesMap);

      const visMap = {};
      for (const u of visList) visMap[u.user_id] = u.hidden_fields;
      setAllUserVisibility(visMap);

      // Merge into configuredUsers (users with either rules or visibility)
      const merged = {};
      for (const u of rulesList)
        merged[u.user_id] = {
          user_id: u.user_id, username: u.username, rules: u.rules, hidden_fields: [],
        };
      for (const u of visList) {
        if (merged[u.user_id]) merged[u.user_id].hidden_fields = u.hidden_fields;
        else merged[u.user_id] = { user_id: u.user_id, username: u.username, rules: {}, hidden_fields: u.hidden_fields };
      }
      setConfiguredUsers(Object.values(merged));
    } catch { /* ignore */ }
  }, []);

  // Load metadata in background, rebuild generalOptions when ready
  const loadMetadataUser = useCallback(() => {
    if (_cache.metadata !== null) {
      const { uomOpts, companyOpts } = srcRef.current;
      setGeneralOptions(_rebuildOpts({}, _cache.metadata, uomOpts, companyOpts));
      return;
    }
    setMetadataLoading(true);
    setMetadataError(false);
    rpt('user-rules-metadata');
    API.get('/batch-udf-metadata/')
      .then((r) => {
        rptEnd('user-rules-metadata');
        _cache.metadata = r.data.data?.fields || {};
        const { uomOpts, companyOpts } = srcRef.current;
        setGeneralOptions(_rebuildOpts({}, _cache.metadata, uomOpts, companyOpts));
      })
      .catch((e) => {
        rptEnd('user-rules-metadata');
        console.warn('user-rules-metadata failed:', e?.message);
        setMetadataError(true);
      })
      .finally(() => setMetadataLoading(false));
  }, []);

  useEffect(() => {
    // Fire all independently: users, user rules, UOM, company (fast)
    // Metadata fires last in background.

    refreshUserRules();

    // Fast sources: UOM + company
    Promise.all([_getUomOpts(), _getCompanyOpts()])
      .then(([uomOpts, companyOpts]) => {
        srcRef.current = { uomOpts, companyOpts };
        // Show initial opts (uom + company fields work immediately)
        setGeneralOptions(_rebuildOpts({}, _cache.metadata || {}, uomOpts, companyOpts));
        setLoadingOpts(false);
        // Metadata in background
        loadMetadataUser();
      });
  }, [refreshUserRules, loadMetadataUser]);

  const handleSelectUser = (userId) => {
    setSelectedUserId(userId);
    const existing = allUserRules[Number(userId)] || {};
    const init = {};
    for (const f of RULE_FIELDS) init[f.key] = existing[f.key] || [];
    setLocalRules(init);
    setLocalVisibility(allUserVisibility[Number(userId)] || []);
    setSaveSuccess('');
    setSaveError('');
  };

  const selectedUser = users.find((u) => String(u.id) === String(selectedUserId));

  const handleLoadFromSidebar = (entry) => {
    setSelectedUserId(String(entry.user_id));
    const init = {};
    for (const f of RULE_FIELDS) init[f.key] = entry.rules?.[f.key] || [];
    setLocalRules(init);
    setLocalVisibility(entry.hidden_fields || []);
    setSaveSuccess('');
    setSaveError('');
  };

  

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      await API.post('/admin/user-attribute-rules/set/', {
        user_id: Number(selectedUserId),
        rules: localRules,
      });
      await API.post('/admin/user-attribute-visibility/set/', {
        user_id: Number(selectedUserId),
        hidden_fields: localVisibility,
      });
      setSaveSuccess(t('rules.saveUserSuccess', selectedUser?.username || 'user'));
      refreshUserRules();
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Failed to save.');
    } finally { setSaving(false); }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm(t('rules.confirmDeleteUser'))) return;
    setDeletingId(userId);
    try {
      try { await API.delete(`/admin/user-attribute-rules/${userId}/delete/`); } catch { /* may not exist */ }
      try { await API.delete(`/admin/user-attribute-visibility/${userId}/delete/`); } catch { /* may not exist */ }
      if (String(selectedUserId) === String(userId)) {
        const init = {};
        for (const f of RULE_FIELDS) init[f.key] = [];
        setLocalRules(init);
        setLocalVisibility([]);
        setSaveSuccess(t('rules.clearedUser'));
      }
      refreshUserRules();
    } catch (err) {
      alert(t('rules.deleteFailed', err.response?.data?.error || err.message));
    } finally { setDeletingId(null); }
  };

  const configuredCount = RULE_FIELDS.filter((f) => (localRules[f.key] || []).length > 0).length;
  localVisibility.length;

  return (
    <div className="rules-tab-layout">
      <section className="card-panel rules-sidebar">
        <h2 className="rules-sidebar__title">{t('rules.usersWithRules')}</h2>
        {configuredUsers.length === 0 ? (
          <span className="rules-sidebar__empty">{t('rules.noUserRules')}</span>
        ) : (
          <div className="rules-sidebar__list">
            {configuredUsers.map((u) => {
              const ruleCount = Object.keys(u.rules || {}).length;
              const hCount = (u.hidden_fields || []).length;
              const badge = [
                ruleCount > 0 ? t('rules.valueRules', ruleCount) : '',
                hCount > 0 ? t('rules.hidden', hCount) : '',
              ].filter(Boolean).join(' · ') || t('rules.configured');
              return (
                <SidebarCard key={u.user_id}
                  isActive={String(selectedUserId) === String(u.user_id)}
                  onClick={() => handleLoadFromSidebar(u)}
                  title={u.username}
                  badge={badge}
                  onDelete={() => handleDelete(u.user_id)}
                  deleting={deletingId === u.user_id}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="card-panel rules-panel">
        <div className="form-field rules-panel__form-mb">
          <label className="form-label">{t('rules.selectUser')}</label>
          <SearchableSelect className="app-select"
            searchSource={{ ...userSearch, params: { module: 'production', level: 'USER' } }}
            onSearchResults={(rows) => setUsers((previous) => [...new Map([...previous, ...rows].map((row) => [row.id, row])).values()])}
            value={selectedUserId}
            onChange={(e) => handleSelectUser(e.target.value)}
            disabled={loadingUsers}
            placeholder={t('rules.selectUserDefault')}>
            <option value="">{loadingUsers ? t('rules.loadingUsers') : t('rules.selectUserDefault')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}{u.role ? ` (${u.role})` : ''}{u.warehouse ? ` · ${u.warehouse}` : ''}
              </option>
            ))}
          </SearchableSelect>
        </div>

        {!selectedUserId && (
          <div className="rules-panel__empty-hint">
            {t('rules.noUserHint')}<br />
            <span>{t('rules.noUserHintSub')}</span>
          </div>
        )}

        {loadingOpts && selectedUserId && (
          <div className="rules-panel__loading">{t('rules.loadingOpts')}</div>
        )}

        {selectedUserId && !loadingOpts && (
          <>
            <div className="rules-panel__info-box">
              <span className="rules-panel__info-icon">👤</span>
              <div>
                <div className="rules-panel__info-title">{selectedUser?.username || `User #${selectedUserId}`}</div>
                <div className="rules-panel__info-sub">
                  {selectedUser?.role}{selectedUser?.warehouse ? ` · ${t('rules.warehouseCode', selectedUser.warehouse)}` : ''}
                </div>
              </div>
              {configuredCount > 0 && (
                <span className="rules-panel__restricted-badge">
                  {t('rules.fieldsRestricted', configuredCount)}
                </span>
              )}
            </div>

            {/* Metadata loading / error banner — non-blocking */}
            <MetadataBanner
              loading={metadataLoading}
              error={metadataError}
              onRetry={loadMetadataUser}
            />

            <div className="rules-panel__field-list">
              {ORDER_USER_DISPLAY_FIELDS.map((f) => (
                <FieldRuleEditor key={f.key} fieldDef={f}
                  opts={f.textOnly ? [] : (generalOptions[f.key] || [])}
                  selected={localRules[f.key] || []}
                  metadataLoading={metadataLoading}
                  onChange={(vals) => !f.textOnly && setLocalRules((prev) => ({ ...prev, [f.key]: vals }))}
                  {...(f.hasVis ? {
                    isVisible: !localVisibility.includes(f.key),
                    onVisibilityChange: (vis) => setLocalVisibility((prev) =>
                      vis ? prev.filter((k) => k !== f.key) : [...prev, f.key]
                    ),
                  } : {})}
                />
              ))}
            </div>

            <FeedbackMsg error={saveError} success={saveSuccess} />
            <button type="button" className="app-button app-button--primary app-button--block rules-save-btn"
              disabled={saving} aria-busy={saving ? 'true' : 'false'} onClick={handleSave}>
              {saving ? (
                <>
                  <AppSpinner size="xs" />
                  <span>{t('rules.saving')}</span>
                </>
              ) : (
                t('rules.saveUserRules')
              )}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

// ── Tab 3: Production Order Visibility Rules (Order Visibility) ───────────────

function OrderVisibilityTab() {
  const { t } = useI18n();
  const [warehouses, setWarehouses] = useState([]);
  const loadingWarehouses = false;
  const [selectedWhCode, setSelectedWhCode] = useState('');
  const [orders, setOrders] = useState([]);       // live orders from SAP for the warehouse
  const [rules, setRules] = useState({});          // { doc_num: is_hidden }
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [searchText, setSearchText] = useState('');

  // warehouse search + dropdown
  const [whSearch, setWhSearch] = useState('');
  const [whDropdownOpen, setWhDropdownOpen] = useState(false);

  useEffect(() => {

  }, []);

  const loadOrdersForWarehouse = useCallback(async (whCode) => {
    if (!whCode) return;
    setLoadingOrders(true);
    setSaveError('');
    setSaveSuccess('');
    setSearchText('');
    try {
      // Load live orders and existing rules in parallel
      const [ordersRes, rulesRes] = await Promise.all([
        API.get('/open-production-orders/'),
        API.get(`/admin/production-order-visibility-rules/?warehouse_code=${whCode}`),
      ]);
      const allOrders = ordersRes.data.data?.orders || [];
      const whOrders = allOrders.filter((o) => o.warehouse === whCode);
      setOrders(whOrders);
      // Build rules map from existing rules
      const existingRules = rulesRes.data.data?.rules || [];
      const ruleMap = {};
      for (const r of existingRules) {
        ruleMap[r.production_order_doc_num] = r.is_hidden;
      }
      setRules(ruleMap);
    } catch (err) {
      setSaveError(t('rules.loadOrdersFailed', err.response?.data?.error || err.message));
    } finally {
      setLoadingOrders(false);
    }
  }, [t]);

  const handleSelectWarehouse = (code) => {
    setSelectedWhCode(code);
    setOrders([]);
    setRules({});
    if (code) loadOrdersForWarehouse(code);
  };

  const toggleOrder = (docNum) => {
    setRules((prev) => ({ ...prev, [docNum]: !prev[docNum] }));
  };

  const handleSave = async () => {
    if (!selectedWhCode) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      const ordersPayload = orders.map((o) => ({
        doc_num:   String(o.orderNumber),
        doc_entry: o.docEntry,
        item_code: o.itemCode || '',
        item_name: o.itemName || '',
        is_hidden: !!rules[String(o.orderNumber)],
      }));
      await API.post('/admin/production-order-visibility-rules/bulk-update/', {
        warehouse_code: selectedWhCode,
        orders: ordersPayload,
      });
      setSaveSuccess(t('rules.saveVisSuccess', selectedWhCode));
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const hiddenCount = Object.values(rules).filter(Boolean).length;
  const selectedWh = warehouses.find((w) => w.code === selectedWhCode);

  warehouses.filter((w) => {
    if (!whSearch.trim()) return true;
    const q = whSearch.toLowerCase();
    return w.code.toLowerCase().includes(q) || (w.name || '').toLowerCase().includes(q);
  });

  const filteredOrders = orders.filter((o) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      String(o.orderNumber).includes(q) ||
      (o.itemCode || '').toLowerCase().includes(q) ||
      (o.itemName || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="rules-tab-col">
      <div className="rules-page-intro">
        {t('rules.orderVisDesc')}
      </div>

      <div className="rules-tab-layout order-visibility-layout">
        <section className="card-panel rules-sidebar">
          <h2 className="rules-sidebar__title">{t('rules.orderVisTitle')}</h2>

          {loadingWarehouses ? (
            <span className="rules-sidebar__loading">Loading…</span>
          ) : (
            <SearchableSelect
              className="app-select"
              searchSource={warehouseSearch}
              onSearchResults={(rows) => setWarehouses((previous) => [...new Map([...previous, ...rows].map((row) => [row.code, row])).values()])}
              value={selectedWhCode}
              onChange={(e) => {
                const nextCode = e.target.value;
                const nextWh = warehouses.find((w) => w.code === nextCode);
                handleSelectWarehouse(nextCode);
                setWhSearch(nextWh ? `${nextWh.code}${nextWh.name ? ` - ${nextWh.name}` : ''}` : '');
                setWhDropdownOpen(false);
              }}
              placeholder={t('rules.selectWarehouseDefault')}
            >
              <option value="">{t('rules.selectWarehouseDefault')}</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code}{w.name ? ` — ${w.name}` : ''}
                </option>
              ))}
            </SearchableSelect>
          )}

          {selectedWh && (
            <div className="wh-selected-badge">
              <span className="wh-selected-badge__code">{selectedWh.code}</span>
              {selectedWh.name && (
                <span className="wh-selected-badge__name">{selectedWh.name}</span>
              )}
              {hiddenCount > 0 && (
                <div className="wh-selected-badge__hidden-count">
                  {t('rules.ordersHidden', hiddenCount)}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card-panel rules-panel">
          {!selectedWhCode && !whDropdownOpen && (
            <div className="rules-panel__empty-hint">
              {t('rules.orderVisEmpty')}<br />
              <span>{t('rules.orderVisEmptySub')}</span>
            </div>
          )}

          {selectedWhCode && (
            <>
              <div className="rules-panel__info-box">
                <span className="rules-panel__info-icon">🏭</span>
                <div>
                  <div className="rules-panel__info-title">{t('rules.warehouseCode', selectedWhCode)}</div>
                  {selectedWh?.name && (
                    <div className="rules-panel__info-sub">{selectedWh.name}</div>
                  )}
                </div>
                {hiddenCount > 0 && (
                  <span className="rules-panel__danger-badge">
                    {t('rules.ordersHidden', hiddenCount)}
                  </span>
                )}
              </div>

              {loadingOrders ? (
                <div className="rules-panel__loading">{t('rules.loadingOrdersVis')}</div>
              ) : orders.length === 0 ? (
                <div className="rules-panel__loading">{t('rules.noOpenOrders')}</div>
              ) : (
                <>
                  <input
                    className="app-input rules-search-input"
                    type="text"
                    placeholder={t('rules.searchOrders')}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />

                  <div className="rules-panel__hint">
                    {t('rules.ordersShown', filteredOrders.length, searchText ? orders.length : 0)}
                  </div>

                  <div className="ov-order-list">
                    {filteredOrders.map((o) => {
                      const docNum = String(o.orderNumber);
                      const isHidden = !!rules[docNum];
                      return (
                        <div key={docNum} onClick={() => toggleOrder(docNum)}
                          className={`ov-order-item${isHidden ? ' ov-order-item--hidden' : ''}`}>
                          <div className="ov-order-item__body">
                            <div className={`ov-order-item__title${isHidden ? ' ov-order-item__title--hidden' : ''}`}>
                              {t('rules.orderNum', docNum)}
                            </div>
                            {(o.itemCode || o.itemName) && (
                              <div className="ov-order-item__subtitle">
                                {o.itemCode}{o.itemName ? ` — ${o.itemName}` : ''}
                              </div>
                            )}
                          </div>
                          <div className={`ov-order-item__status ${isHidden ? 'ov-order-item__status--hidden' : 'ov-order-item__status--visible'}`}>
                            {isHidden ? t('rules.orderHidden') : t('rules.orderVisible')}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <FeedbackMsg error={saveError} success={saveSuccess} />
                  <button type="button" className="app-button app-button--primary app-button--block rules-save-btn"
                    disabled={saving} onClick={handleSave}>
                    {saving ? t('rules.saving') : t('rules.saveVisRules')}
                  </button>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Tab 4: Warehouse Rules (value filtering + visibility, mirrors User Rules) ──

const WAREHOUSE_RULE_FIELDS = [
  { key: 'size',                label: 'Size' },
  { key: 'brand',               label: 'Brand' },
  { key: 'category',            label: 'Category' },
  { key: 'packing',             label: 'Packing' },
  { key: 'season',              label: 'Season' },
  { key: 'extra_specification', label: 'Extra Spec.' },
  { key: 'vendor',              label: 'Vendor' },
  { key: 'part',                label: 'Part' },
  { key: 'company',             label: 'Company' },
  { key: 'uom',                 label: 'UOM' },
];

// Display fields for WarehouseAttrRulesTab: value rules + visibility + text-only fields
const WAREHOUSE_DISPLAY_FIELDS = [
  ...WAREHOUSE_RULE_FIELDS.map((f) => ({ ...f, hasVis: f.key !== 'uom' })),
  { key: 'number',  label: 'Number',  textOnly: true, hasVis: true },
  { key: 'details', label: 'Details', textOnly: true, hasVis: true },
];

function WarehouseAttrRulesTab() {
  const { t } = useI18n();
  const [warehouses, setWarehouses] = useState([]);
  const loadingWarehouses = false;
  const [allWhAttrRules, setAllWhAttrRules] = useState({});
  const [configuredWarehouses, setConfiguredWarehouses] = useState([]);
  const [selectedWhCode, setSelectedWhCode] = useState('');
  const [localRules, setLocalRules] = useState({});
  const [localVisibility, setLocalVisibility] = useState([]); // hidden fields for selected warehouse
  const [generalOptions, setGeneralOptions] = useState({});
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [deletingCode, setDeletingCode] = useState(null);
  const [, setWarehouseDropdownOpen] = useState(false);

  const srcRef = useRef({ uomOpts: [], companyOpts: [] });

  const refreshWhAttrRules = useCallback(async () => {
    try {
      const [attrRes, visRes] = await Promise.allSettled([
        API.get('/admin/warehouse-attribute-rules/'),
        API.get('/admin/warehouse-visibility-rules/'),
      ]);
      const attrList = attrRes.status === 'fulfilled' ? attrRes.value.data.data?.warehouses || [] : [];
      const visList  = visRes.status  === 'fulfilled' ? visRes.value.data.data?.rules       || [] : [];

      console.log('[WH-RULES] warehouse value rules response =', attrList);
      console.log('[WH-RULES] warehouse visibility rules response =', visList);

      const map = {};
      for (const w of attrList) map[w.warehouse_code] = w.rules;
      setAllWhAttrRules(map);

      // Merge into sidebar list — exclude entries with no actual rules or hidden fields
      const merged = {};
      for (const w of attrList)
        merged[w.warehouse_code] = { warehouse_code: w.warehouse_code, rules: w.rules, hidden_fields: [] };
      for (const r of visList) {
        if (merged[r.warehouse_code]) merged[r.warehouse_code].hidden_fields = r.hidden_fields;
        else merged[r.warehouse_code] = { warehouse_code: r.warehouse_code, rules: {}, hidden_fields: r.hidden_fields };
      }
      const filtered = Object.values(merged).filter((w) => {
        const hasRules = Object.values(w.rules || {}).some((v) => Array.isArray(v) && v.length > 0);
        const hasHidden = Array.isArray(w.hidden_fields) && w.hidden_fields.length > 0;
        return hasRules || hasHidden;
      });
      console.log('[WH-RULES] merged sidebar result =', filtered);
      setConfiguredWarehouses(filtered);
    } catch { /* ignore */ }
  }, []);

  const loadMetadataWh = useCallback(() => {
    if (_cache.metadata !== null) {
      const { uomOpts, companyOpts } = srcRef.current;
      setGeneralOptions(_rebuildOpts({}, _cache.metadata, uomOpts, companyOpts));
      return;
    }
    setMetadataLoading(true);
    setMetadataError(false);
    rpt('wh-attr-rules-metadata');
    API.get('/batch-udf-metadata/')
      .then((r) => {
        rptEnd('wh-attr-rules-metadata');
        _cache.metadata = r.data.data?.fields || {};
        const { uomOpts, companyOpts } = srcRef.current;
        setGeneralOptions(_rebuildOpts({}, _cache.metadata, uomOpts, companyOpts));
      })
      .catch((e) => {
        rptEnd('wh-attr-rules-metadata');
        console.warn('wh-attr-rules-metadata failed:', e?.message);
        setMetadataError(true);
      })
      .finally(() => setMetadataLoading(false));
  }, []);

  useEffect(() => {


    refreshWhAttrRules();

    Promise.all([_getUomOpts(), _getCompanyOpts()])
      .then(([uomOpts, companyOpts]) => {
        srcRef.current = { uomOpts, companyOpts };
        setGeneralOptions(_rebuildOpts({}, _cache.metadata || {}, uomOpts, companyOpts));
        setLoadingOpts(false);
        loadMetadataWh();
      });
  }, [refreshWhAttrRules, loadMetadataWh]);

  const handleSelectWarehouse = async (code) => {
    setSelectedWhCode(code);
    const existing = allWhAttrRules[code] || {};
    const init = {};
    for (const f of WAREHOUSE_RULE_FIELDS) init[f.key] = existing[f.key] || [];
    setLocalRules(init);
    setLocalVisibility([]);
    setSaveSuccess('');
    setSaveError('');
    if (code) {
      API.get(`/warehouse-attribute-visibility-rules/${code}/`)
        .then((r) => setLocalVisibility(r.data.data?.hidden_fields || []))
        .catch(() => setLocalVisibility([]));
    }
  };

  const handleLoadFromSidebar = (entry) => {
    setSelectedWhCode(entry.warehouse_code);
    const init = {};
    for (const f of WAREHOUSE_RULE_FIELDS) init[f.key] = entry.rules?.[f.key] || [];
    setLocalRules(init);
    setLocalVisibility(entry.hidden_fields || []);
    setSaveSuccess('');
    setSaveError('');
  };

  const handleSave = async () => {
    if (!selectedWhCode) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      await API.post('/admin/warehouse-attribute-rules/set/', {
        warehouse_code: selectedWhCode,
        rules: localRules,
      });
      await API.post('/admin/warehouse-visibility-rules/set/', {
        warehouse_code: selectedWhCode,
        hidden_fields: localVisibility,
      });
      setSaveSuccess(t('rules.saveWhSuccess', selectedWhCode));
      refreshWhAttrRules();
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Failed to save.');
    } finally { setSaving(false); }
  };

  const handleDelete = async (whCode) => {
    if (!window.confirm(t('rules.confirmDeleteWh', whCode))) return;
    console.log('[WH-DELETE] whCode =', whCode, typeof whCode);
    console.log('[WH-DELETE] selectedWhCode =', selectedWhCode);
    console.log('[WH-DELETE] localRules =', localRules);
    setDeletingCode(whCode);
    try {
      const results = await Promise.allSettled([
        API.delete(`/admin/warehouse-attribute-rules/${whCode}/delete/`),
        API.delete(`/admin/warehouse-visibility-rules/by-warehouse/${whCode}/delete/`),
      ]);
      console.log('[WH-DELETE] delete results =', results.map((r) => ({
        status: r.status,
        data: r.status === 'fulfilled' ? r.value?.data : undefined,
        error: r.status === 'rejected' ? { status: r.reason?.response?.status, data: r.reason?.response?.data } : undefined,
      })));
      if (selectedWhCode === whCode) {
        const init = {};
        for (const f of WAREHOUSE_RULE_FIELDS) init[f.key] = [];
        setLocalRules(init);
        setLocalVisibility([]);
        setSaveSuccess(t('rules.clearedWh'));
      }
      refreshWhAttrRules();
    } catch (err) {
      alert(t('rules.deleteFailed', err.response?.data?.error || err.message));
    } finally { setDeletingCode(null); }
  };

  const selectedWh = warehouses.find((w) => w.code === selectedWhCode);
  selectedWh
    ? `${selectedWh.code}${selectedWh.name ? ` — ${selectedWh.name}` : ''}`
    : (loadingWarehouses ? t('rules.loadingWarehouses') : t('rules.selectWarehouseDefault'));
  const configuredCount = WAREHOUSE_RULE_FIELDS.filter((f) => (localRules[f.key] || []).length > 0).length;
  const hiddenCount = localVisibility.length;

  return (
    <div className="rules-tab-layout warehouse-rules-layout">
      <section className="card-panel rules-sidebar">
        <h2 className="rules-sidebar__title">{t('rules.warehousesWithRules')}</h2>
        {configuredWarehouses.length === 0 ? (
          <span className="rules-sidebar__empty">{t('rules.noWhRules')}</span>
        ) : (
          <div className="rules-sidebar__list">
            {configuredWarehouses.map((w) => {
              const rCount = Object.keys(w.rules || {}).length;
              const hCount = (w.hidden_fields || []).length;
              const badge = [
                rCount > 0 ? t('rules.valueRules', rCount) : '',
                hCount > 0 ? t('rules.hidden', hCount) : '',
              ].filter(Boolean).join(' · ') || t('rules.configured');
              return (
                <SidebarCard key={w.warehouse_code}
                  isActive={selectedWhCode === w.warehouse_code}
                  onClick={() => handleLoadFromSidebar(w)}
                  title={t('rules.warehouseCode', w.warehouse_code)}
                  badge={badge}
                  onDelete={() => handleDelete(w.warehouse_code)}
                  deleting={deletingCode === w.warehouse_code}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="card-panel rules-panel">
        <div
          className="form-field rules-panel__form-mb warehouse-select-wrap"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setWarehouseDropdownOpen(false);
            }
          }}>
          <label className="form-label">{t('rules.selectWarehouse')}</label>
          <SearchableSelect
            className="app-select warehouse-select"
            searchSource={warehouseSearch}
              onSearchResults={(rows) => setWarehouses((previous) => [...new Map([...previous, ...rows].map((row) => [row.code, row])).values()])}
              value={selectedWhCode}
            onChange={(e) => handleSelectWarehouse(e.target.value)}
            disabled={loadingWarehouses}
            placeholder={t('rules.selectWarehouseDefault')}
          >
            <option value="">{loadingWarehouses ? t('rules.loadingWarehouses') : t('rules.selectWarehouseDefault')}</option>
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code}{w.name ? ` — ${w.name}` : ''}
              </option>
            ))}
          </SearchableSelect>
        </div>

        {!selectedWhCode && (
          <div className="rules-panel__empty-hint">
            {t('rules.noWhHint')}<br />
            <span>{t('rules.noWhHintSub')}</span>
          </div>
        )}

        {loadingOpts && selectedWhCode && (
          <div className="rules-panel__loading">{t('rules.loadingOpts')}</div>
        )}

        {selectedWhCode && !loadingOpts && (
          <>
            <div className="rules-panel__info-box">
              <span className="rules-panel__info-icon">🏭</span>
              <div>
                <div className="rules-panel__info-title">{t('rules.warehouseCode', selectedWhCode)}</div>
                {selectedWh?.name && (
                  <div className="rules-panel__info-sub">{selectedWh.name}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {configuredCount > 0 && (
                  <span className="rules-panel__restricted-badge">
                    {t('rules.fieldsRestricted', configuredCount)}
                  </span>
                )}
                {hiddenCount > 0 && (
                  <span className="rules-panel__danger-badge">{t('rules.hidden', hiddenCount)}</span>
                )}
              </div>
            </div>

            <MetadataBanner
              loading={metadataLoading}
              error={metadataError}
              onRetry={loadMetadataWh}
            />

            <div className="rules-panel__field-list">
              {WAREHOUSE_DISPLAY_FIELDS.map((f) => (
                <FieldRuleEditor key={f.key} fieldDef={f}
                  opts={f.textOnly ? [] : (generalOptions[f.key] || [])}
                  selected={localRules[f.key] || []}
                  metadataLoading={metadataLoading}
                  onChange={(vals) => !f.textOnly && setLocalRules((prev) => ({ ...prev, [f.key]: vals }))}
                  {...(f.hasVis ? {
                    isVisible: !localVisibility.includes(f.key),
                    onVisibilityChange: (vis) => setLocalVisibility((prev) =>
                      vis ? prev.filter((k) => k !== f.key) : [...prev, f.key]
                    ),
                  } : {})}
                />
              ))}
            </div>

            <FeedbackMsg error={saveError} success={saveSuccess} />
            <button type="button" className="app-button app-button--primary app-button--block rules-save-btn"
              disabled={saving} onClick={handleSave}>
              {saving ? t('rules.saving') : t('rules.saveWhRules')}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ProductionOrderRulesPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('orders');

  const TABS = [
    { id: 'orders',     label: t('rules.tabOrders') },
    { id: 'users',      label: t('rules.tabUsers') },
    { id: 'warehouses', label: t('rules.tabWarehouses') },
    { id: 'visibility', label: t('rules.tabVisibility') },
    { id: 'pallets', label: lang === 'ar' ? '📦 أنواع البالتات' : '📦 Pallet Types' },
  ];

  if (!canAccessProductionRules(user)) {
    return (
      <div className="page-shell page-shell--center">
        <div className="feedback-message feedback-message--error">{t('common.accessDenied')}</div>
      </div>
    );
  }

  return (
    <div className="page-shell page-shell--padded-lg">
      <div className="rules-page-shell">
        <style>{PRODUCTION_RULES_SCOPED_CSS}</style>

        {/* Header */}
        <div className="rules-page__header">
          <div className="page-icon-wrap page-icon-wrap--warning">⚙️</div>
          <div>
            <span className="section-kicker">{t('common.admin')}</span>
            <h1 className="page-subheading">{t('rules.title')}</h1>
          </div>
          <button type="button" className="app-button app-button--secondary toolbar-nav-btn rules-page__back-btn"
            onClick={() => navigate('/order-rules')}>
            {t('createUser.back')}
          </button>
        </div>

        {/* Tab bar */}
        <div className="rules-page__tabs">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)}
              className={`rules-page__tab-btn${activeTab === id ? ' rules-page__tab-btn--active' : ''}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'orders'     && <OrderRulesTab />}
        {activeTab === 'users'      && <UserRulesTab />}
        {activeTab === 'warehouses' && <WarehouseAttrRulesTab />}
        {activeTab === 'visibility' && <OrderVisibilityTab />}
        {activeTab === 'pallets' && <ProductionPalletTypesPanel />}

      </div>
    </div>
  );
}

export default ProductionOrderRulesPage;
