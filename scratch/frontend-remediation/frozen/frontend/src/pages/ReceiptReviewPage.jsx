import StandardDropdown from '../components/ui/StandardDropdown';
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { canManageProduction } from '../utils/roles';
import { PrintActionButton } from '../components/ui/ActionIconButton';
import AppSpinner from '../components/ui/AppSpinner';
import {
  getUomEntry, getUomLabel, isWeightBasedUom,
  calculateReceiptQuantity,
} from '../utils/uomUtils';
import {
  getCleanProductName, getUomMeasurement, printBatchLabels,
} from '../utils/printBatchLabels';
import { getProductIcon } from '../utils/productIcon';

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtShortDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString();
};
const fmtQty = (n) =>
  n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const STATUS_STYLE = {
  PENDING_REVIEW: { bg: 'var(--bg-warning-soft)', color: 'var(--warning)',     border: 'rgba(183,121,31,.3)' },
  POSTED:         { bg: 'var(--bg-success-soft)', color: 'var(--success)',     border: 'rgba(22,128,60,.3)'  },
  REJECTED:       { bg: 'var(--bg-muted)',         color: 'var(--text-muted)', border: 'var(--border)'       },
  FAILED:         { bg: 'var(--bg-danger-soft)',   color: 'var(--danger)',     border: 'rgba(194,65,12,.3)'  },
};

// ── constants ─────────────────────────────────────────────────────────────────

const BULK_FIELDS = [
  { key: 'unit_count',   label: 'Units',    labelKey: 'review.fieldUnits'    },
  { key: 'uom',          label: 'UOM',      labelKey: 'review.fieldUom'      },
  { key: 'brand',        label: 'Brand',    labelKey: 'review.fieldBrand'    },
  { key: 'size',         label: 'Size',     labelKey: 'review.fieldSize'     },
  { key: 'category',     label: 'Category', labelKey: 'review.fieldCategory' },
  { key: 'packing',      label: 'Packing',  labelKey: 'review.fieldPacking'  },
  { key: 'season',       label: 'Season',   labelKey: 'review.fieldSeason'   },
  { key: 'company',      label: 'Company',  labelKey: 'review.fieldCompany'  },
  { key: 'vendor',       label: 'Vendor',   labelKey: 'review.fieldVendor'   },
  { key: 'part',         label: 'Part',     labelKey: 'review.fieldPart'     },
  { key: 'number',       label: 'Number',   labelKey: 'review.fieldNumber'   },
  { key: 'details',      label: 'Details',  labelKey: 'review.fieldDetails'  },
  { key: 'bin_location', label: 'Bin',      labelKey: 'review.fieldBin'      },
];

const COLS = [
  { key: 'select',     label: '',             w: 44,  fk: null,                   labelKey: null              },
  { key: 'id',         label: '#',            w: 56,  fk: null,                   labelKey: null              },
  { key: 'status',     label: 'Status',       w: 110, fk: 'status',               labelKey: 'review.colStatus'     },
  { key: 'order',      label: 'Order',        w: 136, fk: 'order_num',            labelKey: 'review.colOrder'      },
  { key: 'item_code',  label: 'Item',         w: 120, fk: 'item_code',            labelKey: 'review.colItem'       },
  { key: 'item_name',  label: 'Product',      w: 280, fk: 'product',              labelKey: 'review.colProduct'    },
  { key: 'warehouse',  label: 'WH',           w: 72,  fk: 'warehouse',            labelKey: 'review.colWh'         },
  { key: 'unit_count', label: 'Units',        w: 92,  fk: null,                   labelKey: 'review.colUnits'      },
  { key: 'uom',        label: 'UOM',          w: 110, fk: 'uom',                  labelKey: 'review.colUom'        },
  { key: 'qty',        label: 'Qty',          w: 100, fk: null,                   labelKey: 'review.colQty'        },
  { key: 'batch',      label: 'Batch #',      w: 170, fk: null,                   labelKey: 'review.colBatch'      },
  { key: 'brand',      label: 'Brand',        w: 118, fk: 'brand',                labelKey: 'review.colBrand'      },
  { key: 'size',       label: 'Size',         w: 96,  fk: 'size',                 labelKey: 'review.colSize'       },
  { key: 'category',   label: 'Category',     w: 132, fk: 'category',             labelKey: 'review.colCategory'   },
  { key: 'packing',    label: 'Packing',      w: 128, fk: 'packing',              labelKey: 'review.colPacking'    },
  { key: 'season',     label: 'Season',       w: 110, fk: 'season',               labelKey: 'review.colSeason'     },
  { key: 'company',    label: 'Company',      w: 132, fk: 'company',              labelKey: 'review.colCompany'    },
  { key: 'vendor',     label: 'Vendor',       w: 132, fk: 'vendor',               labelKey: 'review.colVendor'     },
  { key: 'part',       label: 'Part',         w: 96,  fk: 'part',                 labelKey: 'review.colPart'       },
  { key: 'number',     label: 'Number',       w: 110, fk: null,                   labelKey: 'review.colNumber'     },
  { key: 'details',    label: 'Details',      w: 220, fk: null,                   labelKey: 'review.colDetails'    },
  { key: 'bin',        label: 'Bin',          w: 130, fk: 'bin_location',         labelKey: 'review.colBin'        },
  { key: 'created_by', label: 'By',           w: 110, fk: 'created_by',           labelKey: 'review.colBy'         },
  { key: 'created_at', label: 'Date',         w: 105, fk: 'created_at_display',   labelKey: 'review.colDate'       },
  { key: 'sap_err',    label: 'SAP / Reason', w: 240, fk: null,                   labelKey: 'review.colSapErr'     },
  { key: 'add_units',  label: 'Add Units',    w: 110, fk: null,                   labelKey: 'review.colAddUnits'   },
  { key: 'actions',    label: 'Actions',      w: 230, fk: null,                   labelKey: 'review.colActions'    },
];
const TABLE_MIN_WIDTH = COLS.reduce((s, c) => s + c.w, 0);

const STATUS_OPTIONS = [
  { value: 'all',            label: 'All statuses' },
  { value: 'PENDING_REVIEW', label: 'Pending'      },
  { value: 'POSTED',         label: 'Posted'       },
  { value: 'FAILED',         label: 'Failed'       },
];

const POST_CHUNK_BATCH_ROW_LIMIT = 5;
const APPROVE_POST_TIMEOUT_MS = 120000;

const IMPORT_TEMPLATE_HEADERS = [
  'operation', 'batch_number', 'source_order_number', 'source_item_code', 'product',
  'warehouse', 'units', 'uom', 'bin', 'mfr_date', 'brand', 'size', 'category',
  'packing', 'company', 'vendor', 'part', 'number', 'details', 'season',
];

const EXPORT_HEADERS = [
  'batch_number', 'order_number', 'item_code', 'product', 'warehouse', 'units', 'uom',
  'qty', 'brand', 'size', 'category', 'packing', 'company', 'vendor', 'part',
  'number', 'details', 'bin', 'mfr_date', 'season', 'receipt_id', 'batch_id',
];

const EXCEL_HEADERS = [...new Set([...IMPORT_TEMPLATE_HEADERS, ...EXPORT_HEADERS])];

const IMPORT_FIELD_MAP = {
  units: 'unit_count',
  uom: 'uom_entry',
  brand: 'brand',
  size: 'size',
  category: 'category',
  packing: 'packing',
  company: 'company',
  vendor: 'vendor',
  part: 'part',
  number: 'number',
  details: 'details',
  bin: 'bin_location',
  mfr_date: 'mfr_date',
  date: 'mfr_date',
  season: 'season',
};

const CREATE_REQUIRED_FIELDS = [
  'source_order_number', 'source_item_code', 'warehouse', 'units', 'uom', 'bin', 'mfr_date',
];

const PROTECTED_IMPORT_COLUMNS = [
  'batch_number', 'status', 'order_number', 'order', 'item_code', 'item',
  'product', 'warehouse', 'created_by', 'sap_doc', 'receipt_id', 'batch_id',
];

const SEASON_IMPORT_VALUES = ['شتوي', 'صيفي'];

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useI18n();
  const labels = {
    PENDING_REVIEW: t('common.pending'),
    POSTED:         t('common.posted'),
    REJECTED:       t('common.rejected'),
    FAILED:         t('common.failed'),
  };
  return (
    <span className={`rr-status-badge rr-status-badge--${status || 'FAILED'}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── RejectDialog ──────────────────────────────────────────────────────────────

function RejectDialog({ receiptId, onClose, onRejected }) {
  const { t } = useI18n();
  const [reason, setReason]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const handleConfirm = async () => {
    setLoading(true); setError('');
    try {
      await API.post(`/admin/pending-receipts/${receiptId}/reject/`, { reason });
      onRejected();
    } catch (err) {
      setError(err.response?.data?.error || t('review.rejectFailed'));
      setLoading(false);
    }
  };
  return (
    <>
      <div className="rr-dialog-backdrop" onClick={onClose} />
      <div className="rr-dialog">
        <div className="rr-dialog__title">{t('review.rejectTitle', receiptId)}</div>
        <label className="rr-dialog__field-label">{t('review.rejectReason')}</label>
        <textarea rows={3} className="app-input rr-dialog__textarea" autoFocus
          placeholder={t('review.rejectPlaceholder')} value={reason}
          onChange={(e) => setReason(e.target.value)} />
        {error && <div className="feedback-message feedback-message--error rr-dialog__error-mb">{error}</div>}
        <div className="rr-dialog__actions">
          <button type="button" className="app-button app-button--danger rr-dialog__btn-confirm"
            onClick={handleConfirm} disabled={loading}>
            {loading ? t('review.rejecting') : t('review.confirmReject')}
          </button>
          <button type="button" className="app-button app-button--secondary rr-dialog__btn-cancel"
            onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </>
  );
}

// ── ChangeOrderDialog ─────────────────────────────────────────────────────────

function ChangeOrderDialog({ receiptId, currentOrderNum, onClose, onChanged }) {
  const { t } = useI18n();
  const [orders,     setOrders]     = useState([]);
  const [loadingOrd, setLoadingOrd] = useState(true);
  const [search,     setSearch]     = useState('');
  const [selected,   setSelected]   = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    API.get('/open-production-orders/')
      .then((res) => setOrders(res.data.data?.orders || []))
      .catch(() => setError(t('review.loadProductionOrdersFailed')))
      .finally(() => setLoadingOrd(false));
  }, [t]);

  const filtered = useMemo(() => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter((o) =>
      String(o.orderNumber || '').toLowerCase().includes(q) ||
      (o.itemCode || '').toLowerCase().includes(q) ||
      (o.itemName || '').toLowerCase().includes(q),
    );
  }, [orders, search]);

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true); setError('');
    try {
      await API.post(`/admin/pending-receipts/${receiptId}/change-order/`, {
        new_doc_entry:                selected.docEntry,
        new_production_order_doc_num: String(selected.orderNumber || ''),
        new_item_code:                selected.itemCode   || '',
        new_item_name:                selected.itemName   || '',
        new_warehouse_code:           selected.warehouseCode || selected.warehouse || '',
      });
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || t('review.changeOrderFailed'));
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="rr-dialog-backdrop" onClick={onClose} />
      <div className="rr-dialog rr-dialog--wide">
        <div className="rr-dialog__title">{t('review.changeOrderTitle', receiptId)}</div>
        <div className="rr-dialog__subtitle">
          {t('review.changeOrderCurrent')} <strong>{currentOrderNum}</strong>
        </div>
        <input className="app-input rr-dialog__search-input" autoFocus
          placeholder={t('review.changeOrderSearch')}
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        {loadingOrd ? (
          <div className="rr-order-list__loading">{t('review.changeOrderLoading')}</div>
        ) : (
          <div className="rr-order-list">
            {filtered.length === 0 ? (
              <div className="rr-order-list__empty">{t('review.noOrders')}</div>
            ) : filtered.slice(0, 80).map((o) => (
              <div key={o.docEntry} onClick={() => setSelected(o)}
                className={`rr-order-list__item ${selected?.docEntry === o.docEntry ? 'rr-order-list__item--selected' : 'rr-order-list__item--default'}`}>
                <span className="rr-order-list__num">{o.orderNumber}</span>
                {' — '}
                <span className="rr-order-list__code">{o.itemCode}</span>
                {' '}
                <span className="rr-order-list__name">
                  <span className="meta-label-icon" aria-hidden="true">{getProductIcon(o.itemName || o.itemCode)}</span>{' '}
                  {o.itemName || ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="feedback-message feedback-message--error rr-dialog__error-mb">{error}</div>
        )}
        <div className="rr-dialog__actions">
          <button type="button" className="app-button app-button--primary rr-dialog__btn-confirm"
            onClick={handleConfirm} disabled={submitting || !selected}>
            {submitting ? t('review.changing') : selected ? t('review.changeTo', selected.orderNumber) : t('review.selectOrder')}
          </button>
          <button type="button" className="app-button app-button--secondary rr-dialog__btn-cancel"
            onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </>
  );
}

// ── FilterDropdown — multi-select with search + select-all ────────────────────

function FilterDropdown({ pos, options, current, onChange, onClose }) {
  const { t } = useI18n();
  const [search, setSearch] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const visible = React.useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => (o || '').toLowerCase().includes(q));
  }, [options, search]);

  const allChecked  = visible.length > 0 && visible.every((o) => current.includes(o));
  const someChecked = !allChecked && visible.some((o) => current.includes(o));

  const toggle = (val) => {
    onChange(current.includes(val)
      ? current.filter((v) => v !== val)
      : [...current, val]);
  };

  const toggleAll = () => {
    if (allChecked) {
      onChange(current.filter((v) => !visible.includes(v)));
    } else {
      const toAdd = visible.filter((v) => !current.includes(v));
      onChange([...current, ...toAdd]);
    }
  };

  return (
    /* top/left are JS-computed; width is controlled by CSS (.col-filter-dropdown) */
    <div className="col-filter-dropdown" style={{
      position: 'fixed', top: pos.top, left: pos.left, width: pos.width || 300, zIndex: 999999,
    }}>
      {/* search */}
      <div className="col-filter-dropdown__search-wrap">
        <input ref={inputRef} type="text" placeholder={t('common.search') + '…'}
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="col-filter-dropdown__search" />
      </div>

      {/* select all */}
      <div onClick={toggleAll} className="col-filter-dropdown__cb-row col-filter-dropdown__all-row">
        <input type="checkbox" readOnly
          checked={allChecked}
          ref={(el) => { if (el) el.indeterminate = someChecked; }}
          className="col-filter-dropdown__cb" />
        <span className="col-filter-dropdown__all-label">
          {allChecked ? t('review.deselectAll') : t('review.selectAll')}
          {visible.length !== options.length ? ` (${visible.length} shown)` : ` (${options.length})`}
        </span>
      </div>

      {/* options list */}
      <div className="col-filter-dropdown__options">
        {visible.length === 0 ? (
          <div className="col-filter-dropdown__no-match">{t('review.noMatch')}</div>
        ) : visible.map((opt) => {
          const checked = current.includes(opt);
          return (
            <div key={opt} onClick={() => toggle(opt)}
              className={`col-filter-dropdown__cb-row ${checked ? 'col-filter-dropdown__cb-row--checked' : 'col-filter-dropdown__cb-row--unchecked'}`}>
              <input type="checkbox" readOnly checked={checked} className="col-filter-dropdown__cb" />
              <span className="col-filter-dropdown__label">{opt || '(empty)'}</span>
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div className="col-filter-dropdown__footer">
        <span className="col-filter-dropdown__count">
          {current.length > 0 ? t('review.selected', current.length) : t('review.noneSelected')}
        </span>
        <div className="col-filter-dropdown__footer-btns">
          {current.length > 0 && (
            <button type="button" className="col-filter-dropdown__clear-btn" onClick={() => onChange([])}>
              {t('common.clear')}
            </button>
          )}
          <button type="button" className="col-filter-dropdown__done-btn" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── BulkToolbar (attribute bulk-set — for non-posted selected rows) ───────────

function BulkToolbar({ count, onClearSel, field, onField, value, onValue, fieldOptions,
  onApply, applying, error, uomOpts }) {
  const { t } = useI18n();
  const isNum = field === 'unit_count';
  const isUom = field === 'uom';
  const opts  = fieldOptions[field] || [];
  const listId = `bulk-list-${field}`;
  return (
    <div className="bulk-toolbar">
      <span className="bulk-toolbar__count">
        {t('review.editableRows', count)}
      </span>
      <button type="button" className="app-button app-button--secondary bulk-toolbar__clear-btn"
        onClick={onClearSel}>{t('common.clear')}</button>
      <div className="bulk-toolbar__divider" />
      <span className="bulk-toolbar__label">{t('review.bulkSet')}</span>
      <StandardDropdown value={field} onChange={(e) => { onField(e.target.value); onValue(''); }}
        className="app-input bulk-toolbar__field-select">
        {BULK_FIELDS.map((f) => <option key={f.key} value={f.key}>{t(f.labelKey)}</option>)}
      </StandardDropdown>
      <span className="bulk-toolbar__equals">=</span>
      {isUom ? (
        <StandardDropdown value={value} onChange={(e) => onValue(e.target.value)}
          className="app-input bulk-toolbar__uom-select">
          <option value="">{t('wizard.selectUom')}</option>
          {(uomOpts || []).map((u, i) => (
            <option key={`${getUomEntry(u)}-${i}`} value={getUomEntry(u)}>
              {getUomLabel(u)}
            </option>
          ))}
        </StandardDropdown>
      ) : (
        <>
          <input type={isNum ? 'number' : 'text'} className="app-input bulk-toolbar__input"
            value={value} onChange={(e) => onValue(e.target.value)}
            placeholder={t('common.filter') + '…'} list={listId} />
          <datalist id={listId}>
            {opts.map((o, i) => <option key={`${o}-${i}`} value={o} />)}
          </datalist>
        </>
      )}
      <button type="button" className="app-button app-button--primary bulk-toolbar__apply-btn"
        onClick={onApply} disabled={applying || value === ''}>
        {applying ? t('review.applying') : t('review.applySelected')}
      </button>
      {error && <span className="bulk-toolbar__error">{error}</span>}
    </div>
  );
}

// ── edit-buffer init ──────────────────────────────────────────────────────────

function makeBatchEdit(b) {
  return {
    unit_count:   b.unit_count   ?? 0,
    quantity:     b.quantity     ?? 0,
    uom_entry:    b.uom_entry    ?? '',
    uom_label:    b.uom_label    ?? '',
    brand:        b.brand        ?? '',
    size:         b.size         ?? '',
    category:     b.category     ?? '',
    packing:      b.packing      ?? '',
    season:       b.season       ?? '',
    company:      b.company      ?? '',
    vendor:       b.vendor       ?? '',
    part:         b.part         ?? '',
    number:       b.number       ?? '',
    details:      b.details      ?? '',
    bin_location: b.bin_location ?? '',
  };
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ReceiptReviewPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const gridScrollRef = useRef(null);
  const getReceiptId = useCallback((r) => r?.pending_receipt_id ?? r?.receipt_id ?? r?.id, []);
  const getBatchId = useCallback((b) => b?.pending_batch_id ?? b?.batch_id ?? b?.id, []);
  const getRowKey = useCallback((r, b) =>
    `${getReceiptId(r) ?? ''}::${getBatchId(b) ?? ''}::${b?.batch_number ?? ''}`,
  [getBatchId, getReceiptId]);

  // server data
  const [receipts,  setReceipts]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');

  // inline edit buffers
  const [edits,     setEdits]     = useState(() => new Map());
  const [rowSaving, setRowSaving] = useState(() => new Set());
  const [rowErrors, setRowErrors] = useState(() => new Map());
  const [rowSaved,  setRowSaved]  = useState(() => new Set());

  // row selection (batch IDs — non-POSTED only, for attribute editing)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // top-level filters
  const [fStatus,    setFStatus]    = useState('PENDING_REVIEW');
  const [fOrder,     setFOrder]     = useState('');
  const [fBatch,     setFBatch]     = useState('');
  const [fWarehouse, setFWarehouse] = useState('');
  const [fVendor,    setFVendor]    = useState('');
  const [fCreatedBy, setFCreatedBy] = useState('');
  const [fDateFrom,  setFDateFrom]  = useState('');
  const [fDateTo,    setFDateTo]    = useState('');

  // column header filters { fk → string[] }  (multi-select, OR within column, AND across)
  const [colFilters, setColFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);

  // attribute bulk-set
  const [bulkField,    setBulkField]    = useState('brand');
  const [bulkValue,    setBulkValue]    = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkError,    setBulkError]    = useState('');

  // item description lookup map  { item_code → description }
  const [itemDescMap, setItemDescMap] = useState({});

  // master options (SAP metadata)
  const [udfMetadata, setUdfMetadata] = useState({});
  const [companyOpts, setCompanyOpts] = useState([]);
  const [uomOptions,  setUomOptions]  = useState([]);
  const uomOptionsRef = useRef([]);

  // approve / reject
  const [approving,    setApproving]    = useState(() => new Set());
  const [actionErrors, setActionErrors] = useState({});
  const [rejectingId,  setRejectingId]  = useState(null);

  // delete / duplicate single batch
  const [deletingBatch,    setDeletingBatch]    = useState(() => new Set());
  const [duplicatingBatch, setDuplicatingBatch] = useState(() => new Set());

  // add-units per batch (keyed by batchId) — for POSTED rows only
  const [addUnitsMap,  setAddUnitsMap]  = useState(() => new Map());
  const [postingExtra, setPostingExtra] = useState(() => new Set());
  const [extraErrors,  setExtraErrors]  = useState({});

  // change-order dialog
  const [changeOrderId,  setChangeOrderId]  = useState(null);
  const [changeOrderNum, setChangeOrderNum] = useState('');

  // footer bulk actions
  const [bulkSaving,    setBulkSaving]    = useState(false);
  const [bulkPosting,   setBulkPosting]   = useState(false);
  const [bulkPostError, setBulkPostError] = useState('');
  const [bulkPostProgress, setBulkPostProgress] = useState(null);
  const [importModal, setImportModal] = useState(null);
  const [importApplying, setImportApplying] = useState(false);

  const selectAllRef = useRef(null);
  const importFileRef = useRef(null);
  const filterAnchorRef = useRef(null);
  const filterRafRef = useRef(null);

  // ── load ─────────────────────────────────────────────────────────────────────
  const loadReceipts = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await API.get('/admin/pending-receipts/?include_batches=true');
      const data = r.data.data?.receipts || [];
      setReceipts(data);
      const m = new Map();
      data.forEach((rc) => (rc.batches || []).forEach((b) => m.set(b.id, makeBatchEdit(b))));
      setEdits(m);
      setRowErrors(new Map()); setRowSaved(new Set()); setSelectedIds(new Set());
      setAddUnitsMap(new Map());
      return data;
    } catch {
      setLoadError('Failed to load pending receipts.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReceipts(); }, [loadReceipts]);

  // reset horizontal scroll to start when language changes (prevents RTL scroll-end issue)
  useEffect(() => {
    if (gridScrollRef.current) gridScrollRef.current.scrollLeft = 0;
  }, [lang]);

  // ── rebuild item description map whenever receipts load / refresh ────────────
  useEffect(() => {
    if (receipts.length === 0) return;

    const descMap = {};
    receipts.forEach((rc) => {
      const code = rc.item_code || '';
      const name = rc.item_description || rc.item_name || '';
      if (code && name) descMap[code] = name;
    });

    const missingCodes = [...new Set(
      receipts
        .filter((rc) => rc.item_code && !descMap[rc.item_code])
        .map((rc) => rc.item_code),
    )];

    if (missingCodes.length === 0) {
      setItemDescMap(descMap);
      return;
    }

    Promise.allSettled(
      missingCodes.map((code) =>
        API.get(`/item-name/${code}/`)
          .then((res) => {
            const name = res.data?.data?.item_name || res.data?.item_name || '';
            if (name) descMap[code] = name;
          })
          .catch(() => {}),
      ),
    ).then(() => setItemDescMap({ ...descMap }));
  }, [receipts]);

  useEffect(() => {
    API.get('/batch-udf-metadata/')
      .then((res) => { if (res.data.data?.fields) setUdfMetadata(res.data.data.fields); })
      .catch(() => {});
    API.get('/company-options/')
      .then((res) => {
        const raw = res.data;
        const list = Array.isArray(raw?.companies)       ? raw.companies
                   : Array.isArray(raw?.data?.companies) ? raw.data.companies
                   : [];
        setCompanyOpts(list.map((c) => String(c.value ?? c)).filter(Boolean).sort());
      })
      .catch(() => {});
    API.get('/uom-options/')
      .then((res) => {
        const raw = res.data;
        const list = Array.isArray(raw?.uoms)       ? raw.uoms
                   : Array.isArray(raw?.data?.uoms) ? raw.data.uoms
                   : Array.isArray(raw)             ? raw
                   : [];
        const filtered = list.filter(isWeightBasedUom);
        uomOptionsRef.current = filtered;
        setUomOptions(filtered);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!openFilter) return;
    const h = (e) => {
      if (e.target.closest('.col-filter-btn') || e.target.closest('.col-filter-dropdown')) return;
      setOpenFilter(null);
    };
    const t = setTimeout(() => document.addEventListener('click', h), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', h); };
  }, [openFilter]);

  const getFilterPosition = useCallback((anchor) => {
    if (!anchor) return null;
    const VIEWPORT_PAD = 8;
    const GAP = 6;
    const DROPDOWN_WIDTH = Math.min(300, window.innerWidth - (VIEWPORT_PAD * 2));
    const DROPDOWN_EST_HEIGHT = 330;
    const rect = anchor.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + GAP;
    if (top + DROPDOWN_EST_HEIGHT > window.innerHeight - VIEWPORT_PAD && rect.top > DROPDOWN_EST_HEIGHT) {
      top = rect.top - DROPDOWN_EST_HEIGHT - GAP;
    }
    left = Math.max(
      VIEWPORT_PAD,
      Math.min(left, window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_PAD),
    );
    const maxTop = Math.max(VIEWPORT_PAD, window.innerHeight - DROPDOWN_EST_HEIGHT - VIEWPORT_PAD);
    top = Math.max(VIEWPORT_PAD, Math.min(top, maxTop));
    return { top, left, width: DROPDOWN_WIDTH };
  }, []);

  useEffect(() => {
    if (!openFilter) return;
    const updatePosition = () => {
      if (filterRafRef.current) cancelAnimationFrame(filterRafRef.current);
      filterRafRef.current = requestAnimationFrame(() => {
        const next = getFilterPosition(filterAnchorRef.current);
        if (!next) return;
        setOpenFilter((current) => (
          current ? { ...current, ...next } : current
        ));
      });
    };
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      if (filterRafRef.current) cancelAnimationFrame(filterRafRef.current);
    };
  }, [getFilterPosition, openFilter?.fk]);

  // ── derived: top-level filtered receipts ──────────────────────────────────────
  const tlReceipts = useMemo(() => {
    const oQ = fOrder.toLowerCase(), bQ = fBatch.toLowerCase(),
          wQ = fWarehouse.toLowerCase(), cQ = fCreatedBy.toLowerCase(),
          vQ = fVendor.toLowerCase();
    return receipts.filter((r) => {
      if (fStatus !== 'all' && r.status !== fStatus)                                          return false;
      if (oQ && !r.production_order_doc_num?.toLowerCase().includes(oQ))                      return false;
      if (wQ && !r.warehouse_code?.toLowerCase().includes(wQ))                                return false;
      if (cQ && !r.created_by?.toLowerCase().includes(cQ))                                    return false;
      if (fDateFrom && r.created_at && r.created_at.slice(0, 10) < fDateFrom)                return false;
      if (fDateTo   && r.created_at && r.created_at.slice(0, 10) > fDateTo)                  return false;
      if (bQ && !(r.batches || []).some((b) => b.batch_number?.toLowerCase().includes(bQ)))  return false;
      if (vQ && !(r.batches || []).some((b) => (b.vendor || '').toLowerCase().includes(vQ))) return false;
      return true;
    });
  }, [receipts, fStatus, fOrder, fBatch, fWarehouse, fVendor, fCreatedBy, fDateFrom, fDateTo]);

  const tlRows = useMemo(() =>
    tlReceipts.flatMap((r) => {
      const batches = r.batches?.length ? r.batches : [null];
      return batches.map((b, i) => ({
        r, b, _isFirst: i === 0,
        _fv: {
          status:       r.status,
          order_num:    r.production_order_doc_num || '',
          item_code:    r.item_code  || '',
          product:      r.item_description || r.item_name || itemDescMap[r.item_code || ''] || '',
          warehouse:    r.warehouse_code || '',
          uom:          b ? (b.uom_label || b.uom_entry || '') : (r.uom_label || r.uom_entry || ''),
          brand:        b?.brand        || '',
          size:         b?.size         || '',
          category:     b?.category     || '',
          packing:      b?.packing      || '',
          season:       b?.season       || '',
          company:      b?.company      || '',
          vendor:       b?.vendor       || '',
          bin_location:       b?.bin_location || '',
          created_by:         r.created_by    || '',
          part:               b?.part         || '',
          created_at_display: fmtShortDate(b?.mfr_date || r.created_at),
        },
      }));
    }),
  [tlReceipts, itemDescMap]);

  const colOptions = useMemo(() => {
    const m = {};
    COLS.filter((c) => c.fk).forEach(({ fk }) => {
      const s = new Set();
      tlRows.forEach((row) => { const v = row._fv[fk]; if (v) s.add(v); });
      m[fk] = [...s].sort();
    });
    return m;
  }, [tlRows]);

  const filteredRows = useMemo(() => {
    const active = Object.entries(colFilters).filter(([, v]) => v?.length > 0);
    const base   = active.length
      ? tlRows.filter((row) => active.every(([fk, vals]) => vals.includes(row._fv[fk])))
      : tlRows;
    const seen = new Set();
    return base.map((row) => {
      const first = !seen.has(row.r.id);
      if (first) seen.add(row.r.id);
      return { ...row, isFirst: first };
    });
  }, [tlRows, colFilters]);

  // ── footer totals — recomputed from filteredRows ────────────────────────────
  const visibleTotals = useMemo(() => {
    let batchCount = 0, totalQty = 0;
    filteredRows.forEach(({ b }) => {
      if (b) { batchCount++; totalQty += Number(b.quantity || 0); }
    });
    return { batchCount, totalQty };
  }, [filteredRows]);

  const colorMap = useMemo(() => {
    const m = new Map(); let alt = false; const seen = new Set();
    filteredRows.forEach(({ r }) => {
      if (!seen.has(r.id)) {
        seen.add(r.id); m.set(r.id, alt ? 'var(--bg-elevated)' : 'var(--bg-soft)'); alt = !alt;
      }
    });
    return m;
  }, [filteredRows]);

  // visible non-POSTED row keys (for attribute bulk select)
  const visibleRowKeys = useMemo(
    () => new Set(filteredRows.filter(({ b, r }) => b && r.status !== 'POSTED').map(({ r, b }) => getRowKey(r, b))),
    [filteredRows, getRowKey],
  );
  const allVisible  = visibleRowKeys.size > 0 && [...visibleRowKeys].every((rowKey) => selectedIds.has(rowKey));
  const someVisible = !allVisible && [...visibleRowKeys].some((rowKey) => selectedIds.has(rowKey));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisible;
  }, [someVisible]);

  const fieldOptions = useMemo(() => {
    const fromMeta = (key) =>
      (udfMetadata[key]?.valid_values || []).map((v) => String(v.value ?? '')).filter(Boolean).sort();
    const fromRows = (key) => {
      const s = new Set();
      receipts.forEach((r) =>
        (r.batches || []).forEach((b) => { const v = b[key]; if (v != null && v !== '') s.add(String(v)); }),
      );
      return [...s].sort();
    };
    const meta = (key) => { const m = fromMeta(key); return m.length ? m : fromRows(key); };
    return {
      unit_count:   [],
      uom:          [],
      brand:        meta('brand'),
      size:         meta('size'),
      category:     meta('category'),
      packing:      meta('packing'),
      season:       meta('season'),
      company:      companyOpts.length ? companyOpts : fromRows('company'),
      vendor:       meta('vendor'),
      part:         meta('part'),
      number:       meta('number'),
      details:      fromRows('details'),
      bin_location: fromRows('bin_location'),
    };
  }, [udfMetadata, companyOpts, receipts]);

  const visibleBatchStats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let failed = 0;
    let selected = 0;

    filteredRows.forEach(({ r, b }) => {
      if (!b) return;
      total += 1;
      if (r.status === 'PENDING_REVIEW') pending += 1;
      if (r.status === 'FAILED') failed += 1;
      if (selectedIds.has(getRowKey(r, b))) selected += 1;
    });

    return { total, pending, failed, selected };
  }, [filteredRows, selectedIds, getRowKey]);

  // ── handlers ─────────────────────────────────────────────────────────────────

  const handleEditChange = useCallback((batchId, field, value, origBatch) => {
    setEdits((prev) => {
      const current = prev.get(batchId) || {};
      const next = { ...current, [field]: value };

      if (origBatch && (field === 'unit_count' || field === 'uom_entry')) {
        const uomEntry = field === 'uom_entry' ? value : (next.uom_entry ?? origBatch.uom_entry ?? '');
        const uomObj = uomOptionsRef.current.find((u) => getUomEntry(u) === String(uomEntry));
        if (field === 'uom_entry' && uomObj) {
          next.uom_label = getUomLabel(uomObj);
        }
        const units = parseFloat(field === 'unit_count' ? value : (next.unit_count ?? origBatch.unit_count)) || 0;
        if (uomObj) {
          next.quantity = calculateReceiptQuantity(units, uomObj);
        } else if (origBatch.unit_count > 0) {
          // Fallback for UOMs not in the weight-based list (use original batch factor)
          const factor = origBatch.quantity / origBatch.unit_count;
          next.quantity = parseFloat((units * factor).toFixed(6));
        }
      }

      const n = new Map(prev);
      n.set(batchId, next);
      return n;
    });
    setRowSaved((p) => { const n = new Set(p); n.delete(batchId); return n; });
  }, []);

  const handleSaveBatch = useCallback(async (batchId, receiptId) => {
    const data = edits.get(batchId); if (!data) return;
    setRowSaving((p) => new Set([...p, batchId]));
    setRowErrors((p) => { const n = new Map(p); n.delete(batchId); return n; });
    try {
      const res = await API.patch(`/admin/pending-receipts/${receiptId}/batches/${batchId}/`, data);
      const upd = res.data.data;
      setReceipts((p) => p.map((r) => r.id !== receiptId ? r : {
        ...r, batches: (r.batches || []).map((b) => b.id === batchId ? { ...b, ...upd } : b),
      }));
      setRowSaved((p) => new Set([...p, batchId]));
      setTimeout(() => setRowSaved((p) => { const n = new Set(p); n.delete(batchId); return n; }), 2500);
    } catch (err) {
      setRowErrors((p) => new Map([...p, [batchId, err.response?.data?.error || 'Save failed']]));
    } finally {
      setRowSaving((p) => { const n = new Set(p); n.delete(batchId); return n; });
    }
  }, [edits]);

  const handleApprove = useCallback(async (receipt) => {
    setApproving((p) => new Set([...p, receipt.id]));
    setActionErrors((p) => { const n = { ...p }; delete n[receipt.id]; return n; });
    try {
      await API.post(`/admin/pending-receipts/${receipt.id}/approve-post/`);
      loadReceipts();
    } catch (err) {
      setActionErrors((p) => ({ ...p, [receipt.id]: err.response?.data?.error || 'Failed to post.' }));
      setApproving((p) => { const n = new Set(p); n.delete(receipt.id); return n; });
    }
  }, [loadReceipts]);

  const handleDeleteBatch = useCallback(async (receipt, batch) => {
    const label = batch.batch_number || `batch #${batch.id}`;
    if (!window.confirm(t('review.deleteConfirm', label))) return;
    setDeletingBatch((p) => new Set([...p, batch.id]));
    try {
      const res = await API.delete(`/admin/pending-receipts/${receipt.id}/batches/${batch.id}/delete/`);
      const receiptDeleted = res.data?.data?.receipt_deleted;
      if (receiptDeleted) {
        setReceipts((p) => p.filter((r) => r.id !== receipt.id));
      } else {
        setReceipts((p) => p.map((r) => r.id !== receipt.id ? r : {
          ...r,
          batches: (r.batches || []).filter((b) => b.id !== batch.id),
        }));
        setEdits((p) => { const n = new Map(p); n.delete(batch.id); return n; });
        setSelectedIds((p) => { const n = new Set(p); n.delete(batch.id); return n; });
      }
    } catch (err) {
      alert(err.response?.data?.error || t('review.deleteBatchFailed'));
    } finally {
      setDeletingBatch((p) => { const n = new Set(p); n.delete(batch.id); return n; });
    }
  }, [t]);

  const handleDuplicateBatch = useCallback(async (receipt, batch) => {
    setDuplicatingBatch((p) => new Set([...p, batch.id]));
    try {
      const res = await API.post(`/admin/pending-receipts/${receipt.id}/batches/${batch.id}/duplicate/`);
      const newReceipt = res.data?.data;
      if (!newReceipt) return;
      // Each duplicate is its own receipt — append it to the list so that
      // Post / Delete / selection operate on it independently.
      setReceipts((p) => [...p, newReceipt]);
      (newReceipt.batches || []).forEach((b) => {
        setEdits((prev) => { const n = new Map(prev); n.set(b.id, makeBatchEdit(b)); return n; });
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to duplicate batch.');
    } finally {
      setDuplicatingBatch((p) => { const n = new Set(p); n.delete(batch.id); return n; });
    }
  }, []);

  // Post extra units on the SAME batch number — quantity computed from UOM factor
  const handlePostExtra = useCallback(async (receipt, batch) => {
    const rawVal = addUnitsMap.get(batch.id);
    const count  = parseFloat(rawVal || '');
    if (!count || count <= 0) return;
    setPostingExtra((p) => new Set([...p, batch.id]));
    setExtraErrors((p) => { const n = { ...p }; delete n[batch.id]; return n; });
    try {
      const res = await API.post(`/admin/pending-receipts/${receipt.id}/post-extra-quantity/`, {
        batch_id:         batch.id,
        extra_unit_count: count,
      });
      const upd = res.data?.data || {};

      // Update the batch row in-place with the new cumulative totals from the server
      setReceipts((prev) => prev.map((r) => {
        if (r.id !== receipt.id) return r;
        return {
          ...r,
          final_quantity: upd.new_batch_quantity ?? r.final_quantity,
          unit_count:     upd.new_batch_unit_count ?? r.unit_count,
          batches: (r.batches || []).map((b) => {
            if (b.id !== batch.id) return b;
            return {
              ...b,
              unit_count: upd.new_batch_unit_count ?? b.unit_count,
              quantity:   upd.new_batch_quantity   ?? b.quantity,
            };
          }),
        };
      }));

      setAddUnitsMap((p) => { const n = new Map(p); n.delete(batch.id); return n; });
    } catch (err) {
      setExtraErrors((p) => ({ ...p, [batch.id]: err.response?.data?.error || 'Failed to post extra.' }));
    } finally {
      setPostingExtra((p) => { const n = new Set(p); n.delete(batch.id); return n; });
    }
  }, [addUnitsMap]);

  const handleSelectRow = useCallback((rowKey) => {
    setSelectedIds((p) => { const n = new Set(p); n.has(rowKey) ? n.delete(rowKey) : n.add(rowKey); return n; });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((p) => {
      if ([...visibleRowKeys].every((rowKey) => p.has(rowKey))) {
        const n = new Set(p); visibleRowKeys.forEach((rowKey) => n.delete(rowKey)); return n;
      }
      return new Set([...p, ...visibleRowKeys]);
    });
  }, [visibleRowKeys]);

  const handleBulkApply = useCallback(async () => {
    if (!bulkValue || selectedIds.size === 0) return;
    const batchIds = filteredRows
      .filter(({ r, b }) => b && visibleRowKeys.has(getRowKey(r, b)) && selectedIds.has(getRowKey(r, b)))
      .map(({ b }) => b.id);
    if (batchIds.length === 0) return;
    setBulkApplying(true); setBulkError('');
    try {
      if (bulkField === 'uom') {
        const uomObj = uomOptionsRef.current.find((u) => getUomEntry(u) === bulkValue);
        if (!uomObj) { setBulkError(t('review.uomNotFound')); setBulkApplying(false); return; }
        const uomEntry = getUomEntry(uomObj);
        const uomLabel = getUomLabel(uomObj);

        // Build batchId → {receiptId, unit_count} from current receipts + edits
        const batchInfoMap = new Map();
        receipts.forEach((r) => {
          (r.batches || []).forEach((b) => {
            const unitCount = Number(edits.get(b.id)?.unit_count ?? b.unit_count ?? 0);
            batchInfoMap.set(b.id, { receiptId: r.id, unitCount });
          });
        });

        // Per-batch PATCH so each row gets its own computed quantity
        await Promise.allSettled(batchIds.map((batchId) => {
          const info = batchInfoMap.get(batchId);
          if (!info) return Promise.resolve();
          const qty = calculateReceiptQuantity(info.unitCount, uomObj);
          return API.patch(`/admin/pending-receipts/${info.receiptId}/batches/${batchId}/`, {
            uom_entry: uomEntry, uom_label: uomLabel, quantity: qty,
          });
        }));

        setEdits((p) => {
          const n = new Map(p);
          batchIds.forEach((id) => {
            const info = batchInfoMap.get(id);
            const qty = info ? calculateReceiptQuantity(info.unitCount, uomObj) : 0;
            n.set(id, { ...(p.get(id) || {}), uom_entry: uomEntry, uom_label: uomLabel, quantity: qty });
          });
          return n;
        });
        setReceipts((p) => p.map((r) => ({
          ...r,
          batches: (r.batches || []).map((b) => {
            if (!batchIds.includes(b.id)) return b;
            const unitCount = Number(edits.get(b.id)?.unit_count ?? b.unit_count ?? 0);
            return { ...b, uom_entry: uomEntry, uom_label: uomLabel, quantity: calculateReceiptQuantity(unitCount, uomObj) };
          }),
        })));
      } else {
        const updates = { [bulkField]: bulkField === 'unit_count' ? Number(bulkValue) : bulkValue };
        await API.patch('/admin/pending-receipt-batches/bulk-update/', { batch_ids: batchIds, updates });
        setEdits((p) => {
          const n = new Map(p);
          batchIds.forEach((id) => n.set(id, { ...(p.get(id) || {}), ...updates }));
          return n;
        });
        setReceipts((p) => p.map((r) => ({
          ...r,
          batches: (r.batches || []).map((b) => batchIds.includes(b.id) ? { ...b, ...updates } : b),
        })));
      }
      setBulkValue('');
    } catch (err) {
      setBulkError(err.response?.data?.error || t('review.bulkUpdateFailed'));
    } finally {
      setBulkApplying(false);
    }
  }, [bulkValue, bulkField, selectedIds, visibleRowKeys, filteredRows, getRowKey, receipts, edits, t]);

  // ── footer bulk: Save Selected ────────────────────────────────────────────────
  const handleSaveSelected = useCallback(async () => {
    const toSave = filteredRows
      .filter(({ b, r }) => b && r.status !== 'POSTED' && selectedIds.has(getRowKey(r, b)))
      .map(({ b, r }) => ({ batchId: b.id, receiptId: r.id }));
    if (toSave.length === 0) return;
    setBulkSaving(true);
    await Promise.allSettled(toSave.map(({ batchId, receiptId }) => handleSaveBatch(batchId, receiptId)));
    setBulkSaving(false);
  }, [filteredRows, selectedIds, getRowKey, handleSaveBatch]);

  // ── footer bulk: Post Selected ────────────────────────────────────────────────
  const handlePostSelected = useCallback(async () => {
    if (bulkPosting) return;
    setBulkPostError('');
    setBulkPostProgress(null);
    const isPostableReceipt = (receipt) =>
      receipt.status === 'PENDING_REVIEW' || receipt.status === 'FAILED';

    // Selection is batch/row based. Build the authoritative batch -> receipt map
    // from loaded receipts, then decide whether each whole receipt is safe to post.
    const rowByKey = new Map();
    receipts.forEach((receipt) => {
      (receipt.batches || []).forEach((batch) => {
        if (batch?.id == null) return;
        rowByKey.set(getRowKey(receipt, batch), { receipt, batch });
      });
    });

    const selectedRows = [...selectedIds]
      .map((rowKey) => rowByKey.get(rowKey))
      .filter(Boolean)
      .filter(({ receipt }) => isPostableReceipt(receipt));

    if (selectedRows.length === 0) {
      setBulkPostError(t('review.nothingToPost'));
      return;
    }

    const selectedRowsByReceipt = new Map();
    selectedRows.forEach(({ receipt, batch }) => {
      if (!selectedRowsByReceipt.has(receipt.id)) {
        selectedRowsByReceipt.set(receipt.id, { receipt, selectedBatchIds: new Set() });
      }
      selectedRowsByReceipt.get(receipt.id).selectedBatchIds.add(batch.id);
    });

    const postJobs = [];
    let blockedMultiBatchReceipt = false;
    selectedRowsByReceipt.forEach(({ receipt, selectedBatchIds }) => {
      const receiptBatches = (receipt.batches || [])
        .filter((batch) => batch?.id != null && batch.status !== 'POSTED');
      if (receiptBatches.length === 0) return;

      if (receiptBatches.length === 1) {
        if (selectedBatchIds.has(receiptBatches[0].id)) {
          postJobs.push({
            receipt,
            receiptId: receipt.id,
            batchCount: 1,
            rowKeys: [getRowKey(receipt, receiptBatches[0])],
          });
        }
        return;
      }

      if (receiptBatches.every((batch) => selectedBatchIds.has(batch.id))) {
        postJobs.push({
          receipt,
          receiptId: receipt.id,
          batchCount: receiptBatches.length,
          rowKeys: receiptBatches.map((batch) => getRowKey(receipt, batch)),
        });
      } else {
        blockedMultiBatchReceipt = true;
      }
    });

    if (blockedMultiBatchReceipt) {
      window.alert(t('review.multiBatchWarning'));
      if (postJobs.length === 0) {
        setBulkPostError(t('review.multiBatchWarning'));
        return;
      }
    }

    if (postJobs.length === 0) {
      setBulkPostError(t('review.nothingToPost'));
      return;
    }

    setActionErrors((prev) => {
      const next = { ...prev };
      postJobs.forEach((job) => { delete next[job.receiptId]; });
      return next;
    });

    const chunks = [];
    let currentChunk = [];
    let currentBatchRows = 0;
    postJobs.forEach((job) => {
      if (currentChunk.length > 0 && currentBatchRows + job.batchCount > POST_CHUNK_BATCH_ROW_LIMIT) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBatchRows = 0;
      }
      currentChunk.push(job);
      currentBatchRows += job.batchCount;
      if (currentBatchRows >= POST_CHUNK_BATCH_ROW_LIMIT) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBatchRows = 0;
      }
    });
    if (currentChunk.length > 0) chunks.push(currentChunk);

    const totalBatchRows = postJobs.reduce((sum, job) => sum + job.batchCount, 0);
    let postedBatchRows = 0;
    let failedBatchRows = 0;

    const markJobsPosted = (jobs) => {
      const postedReceiptIds = new Set(jobs.map((job) => job.receiptId));
      const postedRowKeys = new Set(jobs.flatMap((job) => job.rowKeys));
      setReceipts((prev) => prev.map((receipt) => (
        postedReceiptIds.has(receipt.id) ? { ...receipt, status: 'POSTED' } : receipt
      )));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        postedRowKeys.forEach((rowKey) => next.delete(rowKey));
        return next;
      });
      setActionErrors((prev) => {
        const next = { ...prev };
        postedReceiptIds.forEach((id) => { delete next[id]; });
        return next;
      });
    };

    setBulkPosting(true);
    try {
      setBulkPostProgress({
        done: 0,
        total: totalBatchRows,
        success: 0,
        failed: 0,
      });

      for (const chunk of chunks) {
        setApproving((prev) => new Set([...prev, ...chunk.map((job) => job.receiptId)]));

        const results = await Promise.all(chunk.map(async (job) => {
          try {
            await API.post(
              `/admin/pending-receipts/${job.receiptId}/approve-post/`,
              undefined,
              { timeout: APPROVE_POST_TIMEOUT_MS },
            );
            return { status: 'fulfilled', job };
          } catch (err) {
            return {
              status: 'rejected',
              job,
              error: err.response?.data?.error || err.message || t('review.bulkPostFailed'),
            };
          }
        }));

        const postedJobs = results.filter((res) => res.status === 'fulfilled').map((res) => res.job);
        const failedJobs = results.filter((res) => res.status === 'rejected');

        if (postedJobs.length > 0) {
          markJobsPosted(postedJobs);
          postedBatchRows += postedJobs.reduce((sum, job) => sum + job.batchCount, 0);
        }

        if (failedJobs.length > 0) {
          failedBatchRows += failedJobs.reduce((sum, res) => sum + res.job.batchCount, 0);
          setActionErrors((prev) => {
            const next = { ...prev };
            failedJobs.forEach((res) => { next[res.job.receiptId] = res.error; });
            return next;
          });
        }

        setApproving((prev) => {
          const next = new Set(prev);
          chunk.forEach((job) => next.delete(job.receiptId));
          return next;
        });

        setBulkPostProgress({
          done: postedBatchRows + failedBatchRows,
          total: totalBatchRows,
          success: postedBatchRows,
          failed: failedBatchRows,
        });

        if (failedJobs.length > 0) {
          const firstError = failedJobs[0]?.error || t('review.bulkPostFailed');
          setBulkPostError(`Stopped after posting ${postedBatchRows} / ${totalBatchRows}. Failed ${failedBatchRows}: ${firstError}`);
          await loadReceipts();
          return;
        }
      }

      setBulkPostError('');
      await loadReceipts();
    } catch (err) {
      setBulkPostError(err.response?.data?.error || t('review.bulkPostFailed'));
    } finally {
      setApproving((prev) => {
        const next = new Set(prev);
        postJobs.forEach((job) => next.delete(job.receiptId));
        return next;
      });
      setBulkPosting(false);
    }
  }, [bulkPosting, receipts, selectedIds, getRowKey, loadReceipts, t]);

  const handleOpenFilter = useCallback((col, e) => {
    e.stopPropagation();
    if (openFilter?.fk === col.fk) {
      filterAnchorRef.current = null;
      setOpenFilter(null);
      return;
    }
    filterAnchorRef.current = e.currentTarget;
    const pos = getFilterPosition(e.currentTarget);
    if (!pos) return;
    setOpenFilter({ fk: col.fk, ...pos });
  }, [getFilterPosition, openFilter]);

  const clearColFilter     = useCallback((fk) => setColFilters((p) => { const n = { ...p }; delete n[fk]; return n; }), []);
  const clearAllColFilters = useCallback(() => setColFilters({}), []);

  // ── print label helpers ───────────────────────────────────────────────────────
  const buildLabelSpec = useCallback((r, b) => {
    const rawProduct = r.item_description || r.item_name || itemDescMap[r.item_code || ''] || r.item_code || '';
    const cleanProduct = getCleanProductName(rawProduct);
    const brandName    = (b.brand || '').trim();
    const showBrand    = brandName && brandName.toLowerCase() !== cleanProduct.toLowerCase();
    const uomLabel     = b.uom_label || b.uom_entry || '—';
    const fakeUom      = { label: b.uom_label || '', code: b.uom_entry || '' };
    const m            = getUomMeasurement(fakeUom);
    const unitCnt      = Number(b.unit_count ?? 0);
    const netVal       = Math.round(unitCnt * m.factor * 1000) / 1000;
    const netLabel     = m.type === 'volume' ? 'Net Volume' : 'Net Weight';
    const netStr       = netVal > 0 ? `${netVal.toLocaleString()} ${m.unitLabel}` : '';
    return {
      batchNumber: b.batch_number || '—',
      topLine:     brandName || cleanProduct,
      subLine:     showBrand ? cleanProduct : null,
      infoRows: [
        { k: 'UOM',          v: uomLabel },
        { k: 'No. Packages', v: String(unitCnt) },
        netStr                ? { k: netLabel,    v: netStr           } : null,
      ].filter(Boolean),
    };
  }, [itemDescMap]);

  const handlePrintBatch = useCallback((r, b) => {
    if (!b?.batch_number) return;
    printBatchLabels([buildLabelSpec(r, b)]);
  }, [buildLabelSpec]);

  const handlePrintSelected = useCallback(() => {
    const specs = [];
    filteredRows.forEach(({ r, b }) => {
      if (b && selectedIds.has(getRowKey(r, b)) && b.batch_number) {
        specs.push(buildLabelSpec(r, b));
      }
    });
    if (specs.length > 0) printBatchLabels(specs);
  }, [filteredRows, selectedIds, getRowKey, buildLabelSpec]);

  // ── access guard ──────────────────────────────────────────────────────────────
  const getExportRows = useCallback(() => {
    const tableRowsForExport = filteredRows;
    const rowsToExport = selectedIds.size > 0
      ? tableRowsForExport.filter(({ r, b }) => b && selectedIds.has(getRowKey(r, b)))
      : tableRowsForExport.filter(({ b }) => b);
    return rowsToExport
      .map(({ r, b }) => {
        const e = edits.get(b.id) || makeBatchEdit(b);
        return {
          batch_number: b.batch_number || '',
          order_number: r.production_order_doc_num || '',
          item_code: r.item_code || '',
          product: r.item_description || r.item_name || itemDescMap[r.item_code || ''] || '',
          warehouse: r.warehouse_code || '',
          units: e.unit_count ?? b.unit_count ?? '',
          uom: e.uom_label || e.uom_entry || b.uom_label || b.uom_entry || '',
          qty: e.quantity ?? b.quantity ?? '',
          brand: e.brand ?? '',
          size: e.size ?? '',
          category: e.category ?? '',
          packing: e.packing ?? '',
          company: e.company ?? '',
          vendor: e.vendor ?? '',
          part: e.part ?? '',
          number: e.number ?? '',
          details: e.details ?? '',
          bin: e.bin_location ?? '',
          mfr_date: e.mfr_date ?? b.mfr_date ?? '',
          season: e.season ?? '',
          receipt_id: getReceiptId(r),
          batch_id: getBatchId(b),
        };
      });
  }, [filteredRows, selectedIds, getRowKey, getReceiptId, getBatchId, edits]);

  const handleExportExcel = useCallback(() => {
    const rows = getExportRows();
    if (rows.length === 0) {
      window.alert(t('review.noRowsToExport'));
      return;
    }
    const worksheet = XLSX.utils.aoa_to_sheet([
      EXPORT_HEADERS,
      ...rows.map((row) => EXPORT_HEADERS.map((header) => row[header] ?? '')),
    ]);
    worksheet['!cols'] = EXPORT_HEADERS.map((h) => ({
      hidden: h === 'receipt_id' || h === 'batch_id',
      wch: Math.max(
        h.length + 2,
        ...rows.map((row) => String(row[h] ?? '').length + 2),
      ),
    }));
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(rows.length, 1), c: EXPORT_HEADERS.length - 1 },
    }) };
    worksheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    worksheet['!view'] = { topLeftCell: 'A1', activeCell: 'A1', showGridLines: true };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ReceiptReviewExport');
    workbook.Workbook = {
      ...(workbook.Workbook || {}),
      Views: [{ activeTab: 0, firstSheet: 0 }],
      Sheets: [{ Hidden: 0 }],
    };
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `receipt-review-export-${today}.xlsx`);
  }, [getExportRows, t]);

  const handleDownloadImportTemplate = useCallback(() => {
    const worksheet = XLSX.utils.aoa_to_sheet([IMPORT_TEMPLATE_HEADERS]);
    const instructions = XLSX.utils.aoa_to_sheet([
      ['Receipt Review Import Rules'],
      ['Use CREATE to add new pending receipts from Excel.'],
      ['batch_number is optional for CREATE. Leave it blank to auto-generate.'],
      ['If batch_number is entered for CREATE, it is used exactly as typed.'],
      ['Import does not post to SAP.'],
      ['Imported rows appear as Pending in Receipt Review.'],
      ['Required fields for CREATE: source_order_number, source_item_code, warehouse, units, uom, bin, mfr_date'],
      ['Optional attributes: brand, size, category, packing, company, vendor, part, number, details, season'],
      ['UPDATE rows may use an existing batch_number and only update editable fields.'],
      ['Season values: شتوي, صيفي'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ReceiptReviewImport');
    XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
    XLSX.writeFile(workbook, 'receipt-review-import-template.xlsx');
  }, []);

  const buildImportPreview = useCallback(async (rawRows, lookupReceipts = receipts) => {
    const normalizeKey = (key) => String(key || '').trim().toLowerCase();
    const clean = (value) => (value == null ? '' : String(value).trim());
    const normalizeId = (value) => {
      const text = clean(value);
      if (!text) return '';
      return text.replace(/\.0+$/, '');
    };
    const toNumber = (value) => {
      if (value === '' || value == null) return 0;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const normalizeDate = (value) => {
      const text = clean(value);
      if (!text) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
        const [d, m, y] = text.split('/');
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      return null;
    };

    const allRows = lookupReceipts.flatMap((receipt) =>
      (receipt.batches || []).map((batch) => ({ receipt, batch }))
    );
    const batchNumberIndex = new Map();
    const orderBatchNumberIndex = new Map();
    allRows.forEach(({ receipt, batch }) => {
      const batchNumber = clean(batch.batch_number);
      const orderNumber = clean(receipt.production_order_doc_num);
      if (batchNumber) {
        const list = batchNumberIndex.get(batchNumber) || [];
        list.push({ receipt, batch });
        batchNumberIndex.set(batchNumber, list);
      }
      if (orderNumber && batchNumber) {
        orderBatchNumberIndex.set(`${orderNumber}||${batchNumber}`, { receipt, batch });
      }
    });

    const validSeasonValues = new Set((fieldOptions.season || []).length ? fieldOptions.season : SEASON_IMPORT_VALUES);
    const previewRows = [];
    let matched = 0;
    let skipped = 0;

    const orderCache = new Map();
    const binCache = new Map();

    for (const [index, raw] of rawRows.entries()) {
      const row = {};
      Object.entries(raw || {}).forEach(([k, v]) => {
        const key = normalizeKey(k);
        if (EXCEL_HEADERS.includes(key) || IMPORT_TEMPLATE_HEADERS.includes(key) || key === 'date') row[key] = v;
      });
      const rowNo = index + 2;
      const errors = [];
      const warnings = [];
      const updates = {};
      const operationText = clean(row.operation).toUpperCase();
      const batchNumber = clean(row.batch_number);
      const isCreate = operationText === 'CREATE' || (!operationText && !batchNumber);

      if (isCreate) {
        CREATE_REQUIRED_FIELDS.forEach((field) => {
          if (!clean(row[field])) errors.push(`${field} is required`);
        });

        const units = toNumber(row.units);
        if (units == null || units <= 0 || !Number.isInteger(units)) errors.push('invalid qty/units');

        const mfrDate = normalizeDate(row.mfr_date);
        if (mfrDate == null) errors.push('invalid date');

        const seasonValue = clean(row.season);
        if (seasonValue && validSeasonValues.size > 0 && !validSeasonValues.has(seasonValue)) {
          errors.push('invalid season');
        }

        if (batchNumber) {
          if (batchNumberIndex.has(batchNumber)) errors.push('Batch number already exists.');
          else warnings.push('Manual batch number will be used as entered.');
        }

        const sourceOrderNumber = clean(row.source_order_number);
        const sourceItemCode = clean(row.source_item_code);
        const warehouseCode = clean(row.warehouse);
        const uomValue = clean(row.uom);
        const binValue = clean(row.bin);

        let order = null;
        if (sourceOrderNumber && !orderCache.has(sourceOrderNumber)) {
          try {
            const orderRes = await API.get(`/production-orders/by-number/${sourceOrderNumber}/`);
            orderCache.set(sourceOrderNumber, orderRes.data.data?.order || null);
          } catch (err) {
            orderCache.set(sourceOrderNumber, null);
          }
        }
        order = orderCache.get(sourceOrderNumber) || null;
        if (!order && sourceOrderNumber) errors.push('production order not found');

        const orderItemCode = clean(order?.ItemNo || order?.ItemCode || order?.ProductNo);
        if (order && sourceItemCode && orderItemCode && sourceItemCode !== orderItemCode) {
          errors.push('source_item_code does not match production order');
        }

        const uomObj = uomOptionsRef.current.find((u) => getUomEntry(u) === uomValue || getUomLabel(u) === uomValue);
        if (!uomObj && uomValue) errors.push('invalid uom');

        let binObj = null;
        if (warehouseCode && binValue) {
          if (!binCache.has(warehouseCode)) {
            try {
              const binRes = await API.get(`/bin-locations/${warehouseCode}/`);
              binCache.set(warehouseCode, binRes.data.data?.locations || []);
            } catch (err) {
              binCache.set(warehouseCode, []);
            }
          }
          const bins = binCache.get(warehouseCode) || [];
          binObj = bins.find((bin) => clean(bin.code) === binValue || clean(bin.name) === binValue);
          if (!binObj) errors.push('invalid bin');
        }

        const docEntry = order?.AbsoluteEntry || order?.DocEntry;
        const quantity = uomObj ? calculateReceiptQuantity(units, uomObj) : 0;
        const createPayload = errors.length === 0 ? {
          ProductionOrderEntry: docEntry,
          ProductionOrderNumber: sourceOrderNumber,
          BaseType: 202,
          BaseEntry: docEntry,
          TransactionType: 'botrntComplete',
          Quantity: quantity,
          Warehouse: warehouseCode,
          PostingDate: mfrDate,
          DocumentDate: mfrDate,
          UomEntry: getUomEntry(uomObj),
          UomLabel: getUomLabel(uomObj),
          UnitCount: units,
          Batches: [{
            batchNumber,
            autoGenerated: !batchNumber,
            quantity,
            unitCount: units,
            binAbsEntry: binObj?.absEntry || '',
            binLocationCode: binObj?.code || binValue,
            binLocation: binObj?.code || binValue,
            mfrDate,
            admissionDate: mfrDate,
            details: clean(row.details),
            size: clean(row.size),
            brand: clean(row.brand),
            uom: getUomEntry(uomObj),
            vendor: clean(row.vendor),
            part: clean(row.part),
            category: clean(row.category),
            packing: clean(row.packing),
            extraSpecification: '',
            number: clean(row.number),
            company: clean(row.company),
            season: seasonValue,
          }],
          Remarks: `Receipt from Production Order ${sourceOrderNumber}`,
        } : null;

        if (errors.length === 0) matched += 1;
        else skipped += 1;
        previewRows.push({
          rowNo,
          operation: 'CREATE',
          orderNumber: sourceOrderNumber,
          itemCode: sourceItemCode,
          product: clean(row.product || row.item_name || ''),
          warehouse: warehouseCode,
          units,
          uom: uomValue,
          matchedBy: errors.length ? 'not matched' : 'production order + item',
          action: errors.length
            ? 'Error'
            : batchNumber
              ? 'Create new pending receipt with manual batch number'
              : 'Create new pending receipt with auto-generated batch number',
          createPayload,
          updates: {},
          errors,
          warnings,
        });
        continue;
      }

      const batchId = normalizeId(row.batch_id);
      const receiptId = normalizeId(row.receipt_id);
      const orderNumber = clean(row.order_number || row.order);
      const batchNumberMatches = batchNumberIndex.get(batchNumber) || [];
      const byBatchNumber = batchNumberMatches.length === 1 ? batchNumberMatches[0] : null;
      const byOrderBatch = !byBatchNumber && orderNumber && batchNumber
        ? orderBatchNumberIndex.get(`${orderNumber}||${batchNumber}`)
        : null;
      const found = byBatchNumber || byOrderBatch;
      const matchedBy = byBatchNumber
        ? 'batch_number'
        : byOrderBatch
          ? 'order_number + batch_number'
          : 'not matched';

      if (!found) {
        errors.push('Batch number not found. Please use a batch number that already exists in Receipt Review.');
        skipped += 1;
        previewRows.push({ rowNo, receiptId, batchId, batchNumber, status: '', matchedBy, updates, errors, warnings });
        return;
      }

      const { receipt, batch } = found;
      const realReceiptId = normalizeId(getReceiptId(receipt));
      const realBatchId = normalizeId(getBatchId(batch));
      const currentEdit = makeBatchEdit(batch);
      const nextEdit = { ...currentEdit };

      if (batchId && batchId !== realBatchId) warnings.push('batch_id ignored');
      if (receiptId && receiptId !== realReceiptId) warnings.push('receipt_id ignored');
      if (!byBatchNumber && batchNumberMatches.length > 1 && !byOrderBatch) {
        warnings.push('batch_number is not unique; add order_number to match safely');
      }

      const protectedExpected = {
        batch_number: batch.batch_number || '',
        status: receipt.status || '',
        order_number: receipt.production_order_doc_num || '',
        order: receipt.production_order_doc_num || '',
        item_code: receipt.item_code || '',
        item: receipt.item_code || '',
        product: receipt.item_description || receipt.item_name || itemDescMap[receipt.item_code || ''] || '',
        warehouse: receipt.warehouse_code || '',
        created_by: receipt.created_by || '',
        sap_doc: receipt.sap_document_number || '',
      };
      PROTECTED_IMPORT_COLUMNS.forEach((col) => {
        if (col === 'receipt_id' || col === 'batch_id' || row[col] == null || clean(row[col]) === '') return;
        if (clean(row[col]) !== clean(protectedExpected[col])) warnings.push(`${col} ignored`);
      });

      Object.entries(IMPORT_FIELD_MAP).forEach(([excelKey, field]) => {
        if (!(excelKey in row)) return;
        const rawValue = row[excelKey];
        if (field === 'unit_count') {
          const units = toNumber(rawValue);
          if (units == null || units < 0) errors.push('invalid qty/units');
          else nextEdit.unit_count = units;
          return;
        }
        if (field === 'uom_entry') {
          const value = clean(rawValue);
          if (!value) {
            nextEdit.uom_entry = '';
            nextEdit.uom_label = '';
            return;
          }
          const uomObj = uomOptionsRef.current.find((u) => getUomEntry(u) === value || getUomLabel(u) === value);
          if (!uomObj) {
            if (value !== batch.uom_entry && value !== batch.uom_label) errors.push('invalid uom');
            return;
          }
          nextEdit.uom_entry = getUomEntry(uomObj);
          nextEdit.uom_label = getUomLabel(uomObj);
          return;
        }
        if (field === 'mfr_date') {
          const date = normalizeDate(rawValue);
          if (date == null) errors.push('invalid date');
          else nextEdit.mfr_date = date;
          return;
        }
        if (field === 'season') {
          const value = clean(rawValue);
          if (value && validSeasonValues.size > 0 && !validSeasonValues.has(value)) errors.push('invalid season');
          else nextEdit.season = value;
          return;
        }
        nextEdit[field] = clean(rawValue);
      });

      const uomObj = uomOptionsRef.current.find((u) => getUomEntry(u) === String(nextEdit.uom_entry || ''));
      if (uomObj) {
        nextEdit.quantity = calculateReceiptQuantity(Number(nextEdit.unit_count || 0), uomObj);
      } else if (batch.unit_count > 0 && nextEdit.unit_count !== currentEdit.unit_count) {
        nextEdit.quantity = parseFloat((Number(nextEdit.unit_count || 0) * (batch.quantity / batch.unit_count)).toFixed(6));
      }

      Object.keys(nextEdit).forEach((field) => {
        if (String(nextEdit[field] ?? '') !== String(currentEdit[field] ?? '')) updates[field] = nextEdit[field];
      });

      if (receipt.status === 'POSTED' && Object.keys(updates).length > 0) errors.push('row is posted and field not editable');
      if (Object.keys(updates).length === 0 && errors.length === 0) warnings.push('no editable changes found');

      if (errors.length === 0) matched += 1;
      else skipped += 1;
      previewRows.push({
        rowNo,
        operation: 'UPDATE',
        receiptId: realReceiptId,
        batchId: realBatchId,
        status: receipt.status,
        matchedBy,
        batchNumber: batch.batch_number,
        orderNumber: receipt.production_order_doc_num,
        itemCode: receipt.item_code,
        product: receipt.item_description || receipt.item_name || itemDescMap[receipt.item_code || ''] || '',
        warehouse: receipt.warehouse_code,
        units: nextEdit.unit_count,
        uom: nextEdit.uom_label || nextEdit.uom_entry,
        action: errors.length ? 'Error' : 'Update existing batch',
        updates,
        errors,
        warnings,
      });
    }

    return {
      rowsFound: rawRows.length,
      matched,
      skipped,
      errors: previewRows.filter((r) => r.errors.length).length,
      warnings: previewRows.filter((r) => r.warnings.length).length,
      rows: previewRows,
    };
  }, [receipts, fieldOptions.season, itemDescMap, getReceiptId, getBatchId]);

  const handleImportFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames.includes('ReceiptReviewImport')
        ? 'ReceiptReviewImport'
        : workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      const lookupRes = await API.get('/admin/pending-receipts/?include_batches=true&status=all');
      const lookupReceipts = lookupRes.data.data?.receipts || [];
      const preview = await buildImportPreview(rows, lookupReceipts);
      setImportModal({ fileName: file.name, preview, error: '' });
    } catch (err) {
      setImportModal({ fileName: file.name, preview: null, error: 'Could not read Excel file.' });
    }
  }, [buildImportPreview]);

  const handleConfirmImport = useCallback(async () => {
    const rows = importModal?.preview?.rows || [];
    const toApply = rows.filter((r) =>
      r.errors.length === 0 && (r.createPayload || Object.keys(r.updates).length > 0)
    );
    if (toApply.length === 0) return;
    setImportApplying(true);
    try {
      for (const row of toApply) {
        if (row.createPayload) {
          await API.post('/pending-receipts/', row.createPayload);
        } else {
          await API.patch(`/admin/pending-receipts/${row.receiptId}/batches/${row.batchId}/`, row.updates);
        }
      }
      setImportModal(null);
      loadReceipts();
    } catch (err) {
      setImportModal((prev) => ({ ...prev, error: err.response?.data?.error || 'Import failed while saving updates.' }));
    } finally {
      setImportApplying(false);
    }
  }, [importModal, loadReceipts]);

  if (!user) {
    return (
      <div className="page-shell page-shell--center">
        <div className="feedback-message feedback-message--error">{t('common.accessDenied')}</div>
      </div>
    );
  }

  const isAdmin = canManageProduction(user);

  const tlFiltersActive    = fStatus !== 'PENDING_REVIEW' || fOrder || fBatch || fWarehouse || fVendor || fCreatedBy || fDateFrom || fDateTo;
  const colFiltersActive   = Object.values(colFilters).some((v) => v?.length > 0);
  const editableSelCount   = [...selectedIds].filter((rowKey) => visibleRowKeys.has(rowKey)).length;

  // compact action-button helper: ACT_BTN(bg, color) → style object
  const ACT_BTN = (bg, color) => ({
    fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap',
    height: '22px', padding: '0 7px', borderRadius: '5px',
    border: 'none', cursor: 'pointer', flexShrink: 0,
    background: bg, color,
  });
  // icon-only ghost button (no background)
  const ACT_ICON = {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '14px', lineHeight: 1, padding: '1px 3px',
    borderRadius: '4px', color: 'var(--text-muted)', flexShrink: 0,
  };

  return (
    <div className="rr-page-shell">

      {BULK_FIELDS.map(({ key }) => (
        <datalist key={key} id={`dl-${key}`}>
          {(fieldOptions[key] || []).map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}

      <div className="rr-page-col">

        {/* header */}
        <div className="rr-page-header">
          <div>
            <span className="rr-page-header__kicker">
              {isAdmin ? t('common.admin') : t('review.myReceipts')}
            </span>
            <h1 className="rr-page-header__title">{t('review.title')}</h1>
          </div>
          <button type="button" className="app-button app-button--secondary rr-header-first-btn"
            onClick={handleExportExcel} disabled={loading || getExportRows().length === 0}>
            {t('review.exportExcel')}
          </button>
          <button type="button" className="app-button app-button--secondary rr-header-btn"
            onClick={handleDownloadImportTemplate}>
            {t('review.downloadTemplate')}
          </button>
          <button type="button" className="app-button app-button--secondary rr-header-btn"
            onClick={() => importFileRef.current?.click()} disabled={loading}>
            {t('review.importExcel')}
          </button>
          <input ref={importFileRef} type="file" accept=".xlsx,.xls"
            className="rr-hidden-file-input" onChange={handleImportFile} />
          <button type="button" className="app-button app-button--secondary rr-header-btn"
            onClick={loadReceipts} disabled={loading}>
            {t('review.refresh')}
          </button>
        </div>

        {/* user info banner */}
        {!isAdmin && (
          <div className="rr-user-banner">
            {t('review.userBanner')}
          </div>
        )}

        {/* stats */}
        <div className="rr-stats-row">
          {[
            { label: `${t('review.pending')} ${t('review.totalBatches')}`, value: visibleBatchStats.pending,  color: 'var(--warning)' },
            { label: `${t('common.failed')} ${t('review.totalBatches')}`,  value: visibleBatchStats.failed,   color: 'var(--danger)'  },
            { label: `${t('common.total')} ${t('review.totalBatches')}`,   value: visibleBatchStats.total,    color: 'var(--text)'    },
            { label: t('review.selected', '').trim() || 'Selected',        value: visibleBatchStats.selected, color: 'var(--primary)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rr-stat-chip">
              <span className="rr-stat-chip__value" style={{ color }}>{value}</span>
              <span className="rr-stat-chip__label">{label}</span>
            </div>
          ))}
        </div>

        {/* top-level filters */}
        <div className="rr-filter-bar">
          <div>
            <label className="rr-filter-label">{t('review.filterStatus')}</label>
            <StandardDropdown className="app-input rr-filter-input rr-filter-status" value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => {
                const lbl = { all: t('review.allStatuses'), PENDING_REVIEW: t('review.pending'), POSTED: t('review.posted'), FAILED: t('review.failed') }[o.value] ?? o.label;
                return <option key={o.value} value={o.value}>{lbl}</option>;
              })}
            </StandardDropdown>
          </div>
          {[
            [t('review.filterOrder'),     fOrder,     setFOrder,     '92px'],
            [t('review.filterBatch'),     fBatch,     setFBatch,     '92px'],
            [t('review.filterWarehouse'), fWarehouse, setFWarehouse, '84px'],
            [t('review.filterVendor'),    fVendor,    setFVendor,    '84px'],
            [t('review.filterCreatedBy'), fCreatedBy, setFCreatedBy, '84px'],
          ].map(([lbl, val, set, w]) => (
            <div key={lbl}>
              <label className="rr-filter-label">{lbl}</label>
              <input className="app-input rr-filter-input" value={val}
                onChange={(e) => set(e.target.value)} placeholder={t('common.filter') + '…'} style={{ width: w }} />
            </div>
          ))}
          <div>
            <label className="rr-filter-label">{t('review.filterDateFrom')}</label>
            <input type="date" className="app-input rr-filter-input" value={fDateFrom}
              onChange={(e) => setFDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="rr-filter-label">{t('review.filterDateTo')}</label>
            <input type="date" className="app-input rr-filter-input" value={fDateTo}
              onChange={(e) => setFDateTo(e.target.value)} />
          </div>
          {tlFiltersActive && (
            <button type="button" className="app-button app-button--secondary rr-filter-clear-btn"
              onClick={() => {
                setFStatus('PENDING_REVIEW'); setFOrder(''); setFBatch('');
                setFWarehouse(''); setFVendor(''); setFCreatedBy(''); setFDateFrom(''); setFDateTo('');
              }}>
              {t('common.clear')}
            </button>
          )}
        </div>

        {/* column filter pills */}
        {colFiltersActive && (
          <div className="rr-col-pills">
            <span className="rr-col-pills__text">{t('review.colFiltersLabel')}</span>
            {Object.entries(colFilters).filter(([, v]) => v?.length > 0).map(([fk, vals]) => {
              const col = COLS.find((c) => c.fk === fk);
              const label = col?.label ?? fk;
              const summary = vals.length === 1 ? vals[0] : `${vals.length} selected`;
              return (
                <span key={fk} className="rr-col-pill">
                  <strong>{label}:</strong> {summary}
                  <button className="rr-col-pill__clear" onClick={() => clearColFilter(fk)}>✕</button>
                </span>
              );
            })}
            <button type="button" className="app-button app-button--secondary rr-col-pills__clear-all"
              onClick={clearAllColFilters}>
              {t('common.clear')}
            </button>
          </div>
        )}

        {loadError && <div className="feedback-message feedback-message--error">{t('review.loadError')}</div>}

        {importModal && (
          <>
            <div className="rr-import-backdrop"
              onClick={() => !importApplying && setImportModal(null)} />
            <div className="rr-import-modal">
              <div className="rr-import-modal__header">
                <div>
                  <div className="rr-import-modal__title">{t('review.importModalTitle')}</div>
                  <div className="rr-import-modal__subtitle">{importModal.fileName}</div>
                </div>
                <button type="button" className="app-button app-button--secondary rr-import-modal__close-btn"
                  onClick={() => setImportModal(null)} disabled={importApplying}>
                  {t('common.cancel')}
                </button>
              </div>

              {importModal.error && (
                <div className="feedback-message feedback-message--error rr-import-modal__error-mb">
                  {importModal.error}
                </div>
              )}

              {importModal.preview && (
                <>
                  <div className="rr-import-modal__stats">
                    {[
                      [t('common.total') + ' rows', importModal.preview.rowsFound],
                      ['Matched', importModal.preview.matched],
                      ['Skipped', importModal.preview.skipped],
                      ['Errors', importModal.preview.errors],
                      ['Warnings', importModal.preview.warnings],
                    ].map(([label, value]) => (
                      <div key={label} className="rr-import-modal__stat">
                        <strong>{value}</strong> {label}
                      </div>
                    ))}
                  </div>

                  <div className="rr-import-table-wrap">
                    <table className="rr-import-table">
                      <thead>
                        <tr>
                          {['Row', 'Operation', 'Order', 'Item', 'Product', 'Warehouse', 'Units', 'UOM', 'Action', 'Warnings', 'Errors'].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importModal.preview.rows.slice(0, 80).map((row) => (
                          <tr key={`${row.rowNo}-${row.batchId || 'missing'}`}>
                            <td>{row.rowNo}</td>
                            <td>{row.operation || 'UPDATE'}</td>
                            <td>{row.orderNumber || row.batchNumber || '-'}</td>
                            <td>{row.itemCode || '-'}</td>
                            <td>
                              <span className="meta-label-icon" aria-hidden="true">{getProductIcon(row.product || row.itemCode)}</span>{' '}
                              {row.product || '-'}
                            </td>
                            <td>{row.warehouse || '-'}</td>
                            <td>{row.units ?? '-'}</td>
                            <td>{row.uom || '-'}</td>
                            <td>{row.action || (row.errors.length ? 'Error' : 'Update existing batch')}</td>
                            <td>
                              {row.warnings.map((w) => <div key={w} className="rr-import-table__warning">{w}</div>)}
                              {row.warnings.length === 0 ? '-' : null}
                            </td>
                            <td>
                              {row.errors.map((e) => <div key={e} className="rr-import-table__error">{e}</div>)}
                              {row.errors.length === 0 ? '-' : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {importModal.preview.rows.length > 80 && (
                    <div className="rr-import-modal__note">
                      {t('review.importNote', 80)}
                    </div>
                  )}

                  <div className="rr-import-modal__actions">
                    <button type="button" className="app-button app-button--secondary rr-import-modal__action-btn"
                      onClick={() => setImportModal(null)} disabled={importApplying}>
                      {t('common.cancel')}
                    </button>
                    <button type="button" className="app-button app-button--primary rr-import-modal__action-btn"
                      onClick={handleConfirmImport}
                      disabled={importApplying || importModal.preview.matched === 0}>
                      {importApplying ? t('review.importing') : t('review.importConfirm')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* attribute bulk-set toolbar */}
        {editableSelCount > 0 && (
          <BulkToolbar
            count={editableSelCount}
            onClearSel={() => setSelectedIds(new Set())}
            field={bulkField}   onField={setBulkField}
            value={bulkValue}   onValue={setBulkValue}
            fieldOptions={fieldOptions}
            uomOpts={uomOptions}
            onApply={handleBulkApply}
            applying={bulkApplying}
            error={bulkError}
          />
        )}

        {/* grid */}
        {loading ? (
          <div className="rr-grid-loading">{t('common.loading')}</div>
        ) : filteredRows.length === 0 ? (
          <div className="rr-grid-empty">
            {t('review.noReceipts')}
          </div>
        ) : (
          <div className="rr-grid-wrap">
            <div className="rr-grid-scroll" ref={gridScrollRef}>
              <table className="receipt-review-table" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: `${TABLE_MIN_WIDTH}px`, minWidth: `${TABLE_MIN_WIDTH}px`, direction: 'ltr' }}>
                <colgroup>{COLS.map((c) => <col key={c.key} style={{ width: `${c.w}px` }} />)}</colgroup>

                <thead>
                  <tr>
                    {COLS.map((col) => {
                      const selCount  = col.fk ? (colFilters[col.fk]?.length ?? 0) : 0;
                      const hasFilter = selCount > 0;
                      const TH_BASE = {
                        padding: '0', textAlign: 'center',
                        background: 'var(--bg-elevated)', borderBottom: '2px solid var(--border)',
                        position: 'sticky', top: 0, zIndex: 2,
                      };
                      if (col.key === 'select') return (
                        <th key="select" style={TH_BASE}>
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px' }}>
                            <input type="checkbox" ref={selectAllRef}
                              checked={allVisible} onChange={handleSelectAll}
                              style={{ cursor: 'pointer', width: 14, height: 14 }} />
                          </div>
                        </th>
                      );
                      if (!col.fk) return (
                        <th key={col.key} style={{ ...TH_BASE, padding: '10px 8px' }}>
                          <span style={{ fontSize: '10px', textTransform: 'uppercase',
                            letterSpacing: '.05em', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {col.labelKey ? t(col.labelKey) : col.label}
                          </span>
                        </th>
                      );
                      return (
                        <th key={col.key} style={{ ...TH_BASE, padding: '8px 6px' }}>
                          <button type="button"
                            className={`col-filter-btn${hasFilter ? ' active' : ''}`}
                            style={{ color: hasFilter ? 'var(--primary)' : 'var(--text-muted)' }}
                            onClick={(e) => handleOpenFilter(col, e)}>
                            {col.labelKey ? t(col.labelKey) : col.label}{selCount > 0 ? ` (${selCount})` : ''}
                            <span style={{ fontSize: '9px', opacity: .7 }}>{hasFilter ? '●' : '▾'}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map(({ r, b, isFirst }) => {
                    const bg           = colorMap.get(r.id) || 'var(--bg-elevated)';
                    const rowKey       = b ? getRowKey(r, b) : '';
                    const isSelected   = b && r.status !== 'POSTED' ? selectedIds.has(rowKey) : false;
                    const isPending    = r.status === 'PENDING_REVIEW';
                    const isPosted     = r.status === 'POSTED';
                    const canEdit         = b !== null && !isPosted;
                    const isApproving       = approving.has(r.id);
                    const isDeletingBatch   = b ? deletingBatch.has(b.id) : false;
                    const isDuplicatingBatch = b ? duplicatingBatch.has(b.id) : false;
                    const isExtraPost       = b ? postingExtra.has(b.id) : false;
                    const bEdit        = b ? (edits.get(b.id) || makeBatchEdit(b)) : null;
                    const isSaving     = b ? rowSaving.has(b.id) : false;
                    const isSaved      = b ? rowSaved.has(b.id) : false;
                    const saveErr      = b ? (rowErrors.get(b.id) || null) : null;
                    const rowErr       = actionErrors[r.id] || null;
                    const extraErr     = b ? (extraErrors[b.id] || null) : null;
                    const canChangeOrd = isPending || r.status === 'FAILED';

                    const TD  = { padding: '5px 8px', borderBottom: '1px solid var(--border)', background: bg, color: 'var(--text)', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                    const TDS = { ...TD, color: 'var(--text-subtle)' };
                    const TDC = { ...TD, textAlign: 'center' };

                    // Editable cell: full input for non-POSTED rows; read-only for POSTED
                    const ec = (field) => canEdit
                      ? (
                        <input type={field === 'unit_count' ? 'number' : 'text'}
                          className="cell-input"
                          value={bEdit?.[field] ?? ''}
                          onChange={(e) => handleEditChange(b.id, field, e.target.value, b)}
                          disabled={isSaving}
                          list={`dl-${field}`}
                          {...(field === 'unit_count' ? { min: 0 } : {})} />
                      )
                      : <span style={{ color: 'var(--text-subtle)', fontSize: '11px' }}>{b?.[field] ?? '—'}</span>;

                    return (
                      <tr key={`${r.id}-${b?.id ?? 'null'}`}
                        className={`rr-row${isSelected ? ' rr-selected' : ''}`}>

                        {/* select — non-POSTED only */}
                        <td style={{ ...TDC, padding: '5px' }}>
                          {b && !isPosted && (
                            <input type="checkbox" checked={isSelected}
                              onChange={() => handleSelectRow(rowKey)}
                              style={{ cursor: 'pointer', width: 14, height: 14 }} />
                          )}
                        </td>

                        {/* # — show batch id when available so duplicates are visually distinct */}
                        <td style={{ ...TDS, fontSize: '11px', fontWeight: 700, textAlign: 'center' }}>
                          {b ? `#${b.id}` : `#${r.id}`}
                        </td>

                        {/* status */}
                        <td style={TDC}><StatusBadge status={r.status} /></td>

                        {/* order */}
                        <td style={{ ...TD, fontWeight: 600, fontSize: '11px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {r.production_order_doc_num}
                            </span>
                            {canChangeOrd && (
                              <button type="button" className="order-change-btn"
                                title="Change production order"
                                onClick={() => { setChangeOrderId(r.id); setChangeOrderNum(r.production_order_doc_num); }}>
                                ✎
                              </button>
                            )}
                          </div>
                        </td>

                        {/* item code */}
                        <td style={{ ...TD, fontSize: '11px' }}>{r.item_code}</td>

                        {/* product */}
                        {(() => {
                          const productName = r.item_description || r.item_name ||
                            itemDescMap[r.item_code || ''] || '';
                          return (
                            <td className="rr-table-cell--long-text" style={{ ...TDS, fontSize: '11px', whiteSpace: 'normal', wordBreak: 'break-word' }}
                              title={productName}>
                              {productName ? (
                                <>
                                  <span className="meta-label-icon" aria-hidden="true">{getProductIcon(productName || r.item_code)}</span>{' '}
                                  {productName}
                                </>
                              ) : '—'}
                            </td>
                          );
                        })()}

                        {/* wh */}
                        <td style={{ ...TDC, fontSize: '11px' }}>{r.warehouse_code}</td>

                        {/* units */}
                        <td style={TD}>{ec('unit_count')}</td>

                        {/* uom */}
                        <td style={{ ...TD, padding: '4px 6px' }}>
                          {canEdit && b ? (
                            <StandardDropdown dense className="cell-input"
                              value={bEdit?.uom_entry ?? ''}
                              onChange={(e) => handleEditChange(b.id, 'uom_entry', e.target.value, b)}
                              disabled={isSaving}
                              placeholder="—">
                              <option value="">—</option>
                              {uomOptions.map((u, i) => (
                                <option key={`${getUomEntry(u)}-${i}`} value={getUomEntry(u)}>
                                  {getUomLabel(u)}
                                </option>
                              ))}
                            </StandardDropdown>
                          ) : (
                            <span style={{ color: 'var(--text-subtle)', fontSize: '11px' }}>
                              {b ? (b.uom_label || b.uom_entry || '—') : (r.uom_label || r.uom_entry || '—')}
                            </span>
                          )}
                        </td>

                        {/* qty */}
                        <td style={{ ...TD, fontWeight: 600, textAlign: 'right' }}>
                          {canEdit && b
                            ? fmtQty(bEdit?.quantity ?? b.quantity)
                            : fmtQty(b ? b.quantity : r.final_quantity)}
                        </td>

                        {/* batch # */}
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                          {b?.batch_number || '—'}
                          <div style={{ fontFamily: 'inherit', color: 'var(--text-muted)', marginTop: 4 }}>
                            {lang === 'ar' ? 'نوع البالتة' : 'Pallet type'}: {b?.without_pallet ? (lang === 'ar' ? 'بدون بالتات' : 'No pallets') : b?.production_pallet_type_name || '—'}
                          </div>
                        </td>

                        {/* editable attributes — read-only for POSTED */}
                        <td style={TD}>{ec('brand')}</td>
                        <td style={TD}>{ec('size')}</td>
                        <td style={TD}>{ec('category')}</td>
                        <td style={TD}>{ec('packing')}</td>
                        <td style={TD}>{ec('season')}</td>
                        <td style={TD}>{ec('company')}</td>
                        <td style={TD}>{ec('vendor')}</td>
                        <td style={TD}>{ec('part')}</td>
                        <td style={TD}>{ec('number')}</td>
                        <td className="rr-table-cell--long-text" style={{ ...TD, whiteSpace: 'normal', wordBreak: 'break-word' }}>{ec('details')}</td>
                        <td style={TD}>{ec('bin_location')}</td>

                        {/* by */}
                        <td style={{ ...TDS, fontSize: '11px', whiteSpace: 'nowrap' }}>
                          {r.created_by || '—'}
                        </td>

                        {/* date — shows mfr_date; falls back to receipt created_at */}
                        <td style={{ ...TDS, fontSize: '11px', whiteSpace: 'nowrap' }}>
                          {fmtShortDate(b?.mfr_date || r.created_at)}
                        </td>

                        {/* sap/reason */}
                        <td className="rr-table-cell--long-text" style={{
                          ...TDS, fontSize: '10px',
                          color: r.sap_error ? 'var(--danger)' : 'var(--text-subtle)',
                          whiteSpace: 'normal', wordBreak: 'break-word',
                        }} title={r.sap_error || r.rejection_reason || ''}>
                          {r.sap_error
                            ? `⚠ ${r.sap_error.slice(0, 55)}`
                            : r.rejection_reason
                              ? `✕ ${r.rejection_reason.slice(0, 55)}`
                              : r.sap_document_number ? `Doc #${r.sap_document_number}` : ''}
                        </td>

                        {/* add units + extra-post button — admin only, POSTED batch rows */}
                        <td style={{ ...TD, padding: '4px 6px' }}>
                          {isAdmin && isPosted && b && (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <input
                                type="number" min="0" step="any"
                                className="add-units-input"
                                placeholder="0"
                                value={addUnitsMap.get(b.id) ?? ''}
                                onChange={(e) => setAddUnitsMap((p) => { const n = new Map(p); n.set(b.id, e.target.value); return n; })}
                                disabled={isExtraPost}
                                style={{ flex: 1, minWidth: 0 }}
                              />
                              <button type="button"
                                title="Post extra units to SAP"
                                onClick={() => handlePostExtra(r, b)}
                                disabled={isExtraPost || !addUnitsMap.get(b.id) || parseFloat(addUnitsMap.get(b.id) || '0') <= 0}
                                style={{
                                  background: 'none', border: '1px solid var(--warning)',
                                  color: 'var(--warning)', borderRadius: '4px',
                                  fontSize: '11px', fontWeight: 700, padding: '1px 5px',
                                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                                  opacity: (isExtraPost || !addUnitsMap.get(b.id)) ? .4 : 1,
                                }}>
                                {isExtraPost ? '…' : '+'}
                              </button>
                            </div>
                          )}
                        </td>

                        {/* actions */}
                        <td style={{ ...TD, padding: '3px 6px' }}>
                          <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'nowrap' }}>

                            {/* Save */}
                            {canEdit && (
                              <button type="button"
                                title="Save batch edits"
                                onClick={() => handleSaveBatch(b.id, r.id)}
                                disabled={isSaving}
                                style={ACT_BTN(isSaved ? 'var(--success)' : 'var(--bg-muted)', isSaved ? '#fff' : 'var(--text)')}>
                                {isSaving ? '…' : isSaved ? '✓' : 'Save'}
                              </button>
                            )}

                            {/* ✓ Post */}
                            {isAdmin && b && isPending && (
                              <button type="button"
                                title="Post receipt to SAP"
                                onClick={() => handleApprove(r)}
                                disabled={isApproving || bulkPosting}
                                aria-busy={isApproving ? 'true' : 'false'}
                                style={ACT_BTN('var(--success)', '#fff')}>
                                {isApproving ? <AppSpinner size="xs" label={t('common.posting')} /> : '✓ Post'}
                              </button>
                            )}

                            {/* 🖨️ Print */}
                            {b && b.batch_number && (
                              <PrintActionButton

                                ariaLabel={lang === 'ar' ? `طباعة الملصق — ${b.batch_number}` : `Print label — ${b.batch_number}`}
                                onClick={() => handlePrintBatch(r, b)}
                              />
                            )}

                            {/* ⧉ Duplicate */}
                            {canEdit && b && (
                              <button type="button"
                                title={`Duplicate batch ${b.batch_number || b.id}`}
                                onClick={() => handleDuplicateBatch(r, b)}
                                disabled={isDuplicatingBatch || isSaving}
                                style={{ ...ACT_ICON, fontSize: '13px', opacity: (isDuplicatingBatch || isSaving) ? .35 : 1 }}>
                                {isDuplicatingBatch ? '…' : '⧉'}
                              </button>
                            )}

                            {/* ✕ Delete */}
                            {canEdit && b && (
                              <button type="button"
                                title={`Delete batch ${b.batch_number || b.id}`}
                                onClick={() => handleDeleteBatch(r, b)}
                                disabled={isDeletingBatch || isSaving}
                                style={{ ...ACT_ICON, color: 'var(--danger)', fontWeight: 700, opacity: (isDeletingBatch || isSaving) ? .35 : 1 }}>
                                {isDeletingBatch ? '…' : '✕'}
                              </button>
                            )}

                            {/* ⚠ errors */}
                            {(saveErr || rowErr || (isAdmin && extraErr)) && (
                              <span style={{ fontSize: '11px', color: 'var(--danger)', cursor: 'help', flexShrink: 0 }}
                                title={saveErr || rowErr || extraErr}>⚠</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── footer: totals + bulk actions ── */}
            <div className="rr-grid-footer">
              {/* totals — always reflect filteredRows */}
              <div className="rr-grid-totals">
                <span className="rr-grid-total-text">
                  <strong className="rr-grid-total-val">{visibleTotals.batchCount}</strong>{' '}{t('review.batchCount', visibleTotals.batchCount).replace(/^\d+ /, '')}
                </span>
                <span className="rr-grid-total-text">
                  {t('review.totalQtyLabel')}{' '}
                  <strong className="rr-grid-total-val">{fmtQty(visibleTotals.totalQty)}</strong>
                </span>
              </div>

              {/* bulk actions — when non-posted rows are selected */}
              {(editableSelCount > 0 || bulkPostProgress || bulkPostError) && (
                <>
                  <div className="rr-grid-divider" />
                  {editableSelCount > 0 && (
                    <span className="rr-grid-sel-count">{t('review.selected', editableSelCount)}</span>
                  )}
                  {bulkPostProgress && (
                    <span className="rr-grid-sel-count">
                      {bulkPosting ? 'Posting' : 'Posted'} {bulkPostProgress.done} / {bulkPostProgress.total}
                      {' · '}success {bulkPostProgress.success}
                      {' · '}failed {bulkPostProgress.failed}
                    </span>
                  )}
                  {editableSelCount > 0 && (
                    <button type="button" className="app-button app-button--secondary rr-grid-action-btn"
                      onClick={handleSaveSelected} disabled={bulkSaving || bulkPosting} aria-busy={bulkSaving ? 'true' : 'false'}>
                      {bulkSaving ? <><AppSpinner size="xs" /><span>{t('review.savingSelected')}</span></> : t('review.saveSelected')}
                    </button>
                  )}
                  {isAdmin && editableSelCount > 0 && (
                    <button type="button" className="app-button app-button--success rr-grid-action-btn"
                      onClick={handlePostSelected} disabled={bulkPosting} aria-busy={bulkPosting ? 'true' : 'false'}>
                      {bulkPosting ? <><AppSpinner size="xs" /><span>{t('review.postingSelected')}</span></> : t('review.postSelected')}
                    </button>
                  )}
                  {bulkPostError && (
                    <span className="rr-grid-error-text">{bulkPostError}</span>
                  )}
                </>
              )}
              {/* Print selected — available whenever any batch rows are selected */}
              {(() => {
                const printableCount = filteredRows.filter(({ r, b }) =>
                  b?.batch_number && selectedIds.has(getRowKey(r, b))
                ).length;
                return printableCount > 0 ? (
                  <>
                    {editableSelCount === 0 && <div className="rr-grid-divider" />}
                    <PrintActionButton icon="🖨️"
                      onClick={handlePrintSelected}/>
                  </>
                ) : null;
              })()}
            </div>
          </div>
        )}

      </div>

      {/* reject dialog */}
      {rejectingId !== null && (
        <RejectDialog
          receiptId={rejectingId}
          onClose={() => setRejectingId(null)}
          onRejected={() => { setRejectingId(null); loadReceipts(); }}
        />
      )}

      {/* change order dialog */}
      {changeOrderId !== null && (
        <ChangeOrderDialog
          receiptId={changeOrderId}
          currentOrderNum={changeOrderNum}
          onClose={() => setChangeOrderId(null)}
          onChanged={() => { setChangeOrderId(null); loadReceipts(); }}
        />
      )}

      {/* column filter dropdown — portal to body to escape any overflow parent */}
      {openFilter && createPortal(
        <FilterDropdown
          pos={openFilter}
          options={colOptions[openFilter.fk] || []}
          current={colFilters[openFilter.fk] || []}
          onChange={(vals) => setColFilters((p) => ({ ...p, [openFilter.fk]: vals }))}
          onClose={() => setOpenFilter(null)}
        />,
        document.body,
      )}
    </div>
  );
}
