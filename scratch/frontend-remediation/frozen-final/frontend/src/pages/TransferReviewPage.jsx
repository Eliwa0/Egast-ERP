import StandardDropdown from '../components/ui/StandardDropdown';
import { transferWarehouseSearch } from '../services/masterDataSearch';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { canManageTransfer } from '../utils/roles';
import { fetchDestinationSapBins, fetchPhysicalEvents } from '../modules/transfer/services/transferService';
import { useI18n } from '../contexts/I18nContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import '../styles/pages/receipt-review.css';
import '../styles/pages/transfer-review.css';

const STATUS_LABELS = {
  PENDING: 'transferReview.pending',
  POSTED: 'transferReview.posted',
  FAILED: 'transferReview.failed',
};

const STAGE_LABELS = {
  STAGE_1_TO_INTERMEDIATE: 'transferReview.stage1',
  STAGE_2_TO_FRIDGE: 'transferReview.stage2',
  STAGE_3_FROM_FRIDGE: 'transferReview.stage3',
  STAGE_4_TO_DESTINATION: 'transferReview.stage4',
  STAGE_5_TO_CONTAINER: 'transferReview.stage5',
};

const SOURCE_STATUS_LABELS = {
  SAP_AVAILABLE: 'transfer.status.sapAvailable',
  SAP_POSTED: 'transfer.status.sapPosted',
  LOCAL_PENDING_RECEIPT: 'transfer.status.localPendingReceipt',
  LOCAL_POSTED_RECEIPT: 'transfer.status.localPostedReceipt',
  PENDING_TRANSFER_CHAIN: 'transfer.status.pendingTransferChain',
  NOT_FOUND: 'transfer.status.notFound',
};

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const toLocalDateStr = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fmtQty = (value) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

const getLines = (transfer) => (Array.isArray(transfer?.lines) ? transfer.lines : []);

const getLineValue = (line, key) => {
  const fallbackKeys = {
    batch_number: 'batchNumber',
    item_code: 'itemCode',
    item_name: 'itemName',
    availability_status: 'availabilityStatus',
    source_status_label: 'sourceStatusLabel',
    source_message: 'sourceMessage',
  };
  return line?.[key] ?? line?.[fallbackKeys[key]];
};

const sourceStatusForTransfer = (transfer, t) => {
  if (transfer?.status === 'POSTED') {
    return { label: t('transfer.status.sapPosted'), tone: 'sap', message: '' };
  }
  const lines = getLines(transfer);
  if (!lines.length) return { label: '-', tone: 'missing', message: '' };
  const statuses = lines
    .map((line) => getLineValue(line, 'availability_status'))
    .filter(Boolean);
  const hasLocal = statuses.some((value) => !['SAP_AVAILABLE', 'SAP_POSTED'].includes(value));
  const firstLine = lines[0] || {};
  const label =
    (SOURCE_STATUS_LABELS[statuses[0]] ? t(SOURCE_STATUS_LABELS[statuses[0]]) : null) ||
    getLineValue(firstLine, 'source_status_label') ||
    (hasLocal ? t('transfer.status.waitingApproval') : t('transfer.status.sapAvailable'));
  const message = getLineValue(firstLine, 'source_message') || '';
  return {
    label,
    message,
    tone: hasLocal ? 'local' : 'sap',
  };
};

const makeTransferEdit = (transfer) => {
  return {
    from_warehouse: transfer?.from_warehouse || '',
    from_bin: transfer?.from_bin || '',
    to_warehouse: transfer?.to_warehouse || '',
    to_bin: transfer?.to_bin || '',
    quantity: transfer?.quantity || '',
  };
};

function StatusBadge({ status, t }) {
  return (
    <span className={`rr-status-badge rr-status-badge--${status || 'FAILED'}`}>
      {STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : status || '-'}
    </span>
  );
}

function lineValue(transfer, key) {
  const lines = getLines(transfer);
  const values = lines
    .map((line) => getLineValue(line, key))
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value));
  if (values.length) return [...new Set(values)].join(', ');
  return transfer?.[key] || '-';
}

export default function TransferReviewPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const adminUser = canManageTransfer(user);
  const selectAllRef = useRef(null);

  const [transfers, setTransfers] = useState([]);
  const [physicalEvents, setPhysicalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [physicalLoading, setPhysicalLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [reservedOutbound, setReservedOutbound] = useState([]);
  const [reservedOutboundLoading, setReservedOutboundLoading] = useState(false);
  const [reservedOutboundError, setReservedOutboundError] = useState('');

  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [stageFilter, setStageFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [postingIds, setPostingIds] = useState(() => new Set());
  const [reconcilingIds, setReconcilingIds] = useState(() => new Set());
  const [actionErrors, setActionErrors] = useState({});
  const [edits, setEdits] = useState(() => new Map());
  const [savingIds, setSavingIds] = useState(() => new Set());
  const [deletingIds, setDeletingIds] = useState(() => new Set());
  const [saveErrors, setSaveErrors] = useState({});
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [destinationSap, setDestinationSap] = useState({});

  const destinationWarehouses = useMemo(() => {
    return JSON.stringify(
      [...new Set(
        transfers
          .filter((row) => row.transfer_stage === 'STAGE_3_FROM_FRIDGE' && ['PENDING', 'FAILED'].includes(row.status))
          .flatMap((row) => [row.to_warehouse, edits.get(row.id)?.to_warehouse])
          .filter(Boolean),
      )].sort(),
    );
  }, [transfers, edits]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      JSON.parse(destinationWarehouses).map(async (warehouse) => {
        try {
          return [warehouse, await fetchDestinationSapBins(warehouse)];
        } catch {
          return [warehouse, { error: true }];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setDestinationSap(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [destinationWarehouses]);

  const destinationReady = useCallback(
    (transfer) => {
      if (transfer.transfer_stage !== 'STAGE_3_FROM_FRIDGE') return true;
      const data = destinationSap[transfer.to_warehouse];
      return Boolean(
        data &&
          !data.error &&
          (!data.requires_bin || data.locations.some((bin) => bin.code === transfer.to_bin)),
      );
    },
    [destinationSap],
  );

  const warehouses = [];

  const loadTransfers = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = {};
    if (statusFilter !== 'ALL') params.status = statusFilter;
    if (search.trim()) params.search = search.trim();
    API.get('/admin/pending-transfers/', { params: { ...params, refresh_sources: 'false' } })
      .then((res) => {
        const data = res.data?.data?.transfers ?? [];
        if (!Array.isArray(data) || data.some((transfer) => !transfer || typeof transfer !== 'object')) {
          throw new Error('Invalid transfer review response');
        }
        setTransfers(data);
        setEdits(new Map(data.map((transfer) => [transfer.id, makeTransferEdit(transfer)])));
        setSelectedIds(new Set());
        setActionErrors({});
        setSaveErrors({});
      })
      .catch((err) => {
        setTransfers([]);
        setEdits(new Map());
        setSelectedIds(new Set());
        setLoadError(err.response?.data?.error || t('transferReview.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [statusFilter, search, t]);

  const loadPhysicalEvents = useCallback(() => {
    setPhysicalLoading(true);
    fetchPhysicalEvents(0)
      .then((result) => {
        const events = (result?.events || []).filter((row) => row.stage === 5);
        setPhysicalEvents(events);
      })
      .catch((err) => {
        console.error('Failed to load physical events', err);
        setPhysicalEvents([]);
      })
      .finally(() => setPhysicalLoading(false));
  }, []);

  const loadReservedOutbound = useCallback(() => {
    if (!adminUser) return;
    setReservedOutboundLoading(true);
    setReservedOutboundError('');
    API.get('/admin/reports/reserved-outbound-positions/')
      .then((res) => {
        const positions = res.data?.data?.positions ?? [];
        if (!Array.isArray(positions) || positions.some((position) => !position || typeof position !== 'object')) {
          throw new Error('Invalid reserved outbound response');
        }
        setReservedOutbound(positions);
      })
      .catch((err) => {
        setReservedOutbound([]);
        setReservedOutboundError(err.response?.data?.error || t('transferReview.reservedOutboundLoadFailed'));
      })
      .finally(() => setReservedOutboundLoading(false));
  }, [adminUser, t]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    loadPhysicalEvents();
  }, [loadPhysicalEvents]);

  useEffect(() => {
    loadReservedOutbound();
  }, [loadReservedOutbound]);

  const selectableTransfers = useMemo(
    () => transfers.filter((transfer) => transfer.status === 'PENDING' || transfer.status === 'FAILED'),
    [transfers],
  );

  const pendingCount = useMemo(
    () => transfers.filter((transfer) => transfer.status === 'PENDING').length,
    [transfers],
  );

  const failedCount = useMemo(
    () => transfers.filter((transfer) => transfer.status === 'FAILED').length,
    [transfers],
  );

  const postedCount = useMemo(
    () => transfers.filter((transfer) => transfer.status === 'POSTED').length,
    [transfers],
  );

  const loadedToContainerCount = useMemo(
    () => physicalEvents.filter((event) => event.state === 'LOADED_TO_CONTAINER').length,
    [physicalEvents],
  );

  const selectedCount = selectedIds.size;

  const selectedPostableCount = useMemo(
    () => selectableTransfers.filter((transfer) => selectedIds.has(transfer.id)).length,
    [selectableTransfers, selectedIds],
  );

  const selectableIds = useMemo(
    () => (adminUser ? selectableTransfers.map((transfer) => transfer.id) : []),
    [adminUser, selectableTransfers],
  );

  const selectedSelectableCount = useMemo(
    () => selectableIds.filter((transferId) => selectedIds.has(transferId)).length,
    [selectableIds, selectedIds],
  );

  const allSelectableChecked =
    selectableIds.length > 0 && selectedSelectableCount === selectableIds.length;
  const someSelectableChecked =
    selectedSelectableCount > 0 && selectedSelectableCount < selectableIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableChecked;
    }
  }, [someSelectableChecked]);

  const toggleSelectAll = () => {
    if (selectableIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelectableChecked) {
        selectableIds.forEach((transferId) => next.delete(transferId));
      } else {
        selectableIds.forEach((transferId) => next.add(transferId));
      }
      return next;
    });
  };

  const updateEdit = (transferId, field, value) => {
    setEdits((prev) => {
      const current = prev.get(transferId) || {};
      const next = { ...current, [field]: value };
      if (field === 'to_warehouse') next.to_bin = '';
      if (field === 'from_warehouse') next.from_bin = '';
      const map = new Map(prev);
      map.set(transferId, next);
      return map;
    });
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.delete(transferId);
      return next;
    });
  };

  const saveTransfer = useCallback(async (transfer) => {
    const edit = edits.get(transfer.id);
    if (!edit) return;

    setSavingIds((prev) => new Set([...prev, transfer.id]));
    setSaveErrors((prev) => {
      const next = { ...prev };
      delete next[transfer.id];
      return next;
    });

    try {
      const singleLine = getLines(transfer).length === 1;
      const payload = {
        from_warehouse: edit.from_warehouse,
        from_bin: edit.from_bin,
        to_warehouse: edit.to_warehouse,
        to_bin: edit.to_bin,
      };
      if (singleLine) {
        payload.quantity = edit.quantity;
      }
      const res = await API.patch(`/admin/pending-transfers/${transfer.id}/`, payload);
      const updated = res.data?.data?.transfer;
      if (updated) {
        setTransfers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setEdits((prev) => {
          const map = new Map(prev);
          map.set(updated.id, makeTransferEdit(updated));
          return map;
        });
        setSavedIds((prev) => new Set([...prev, updated.id]));
        window.setTimeout(() => {
          setSavedIds((prev) => {
            const next = new Set(prev);
            next.delete(updated.id);
            return next;
          });
        }, 2400);
      }
    } catch (err) {
      setSaveErrors((prev) => ({
        ...prev,
        [transfer.id]: err.response?.data?.error || t('transferReview.saveFailed'),
      }));
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(transfer.id);
        return next;
      });
    }
  }, [edits, t]);

  const deleteTransfer = useCallback(async (transfer) => {
    const label = lineValue(transfer, 'batch_number');
    if (!window.confirm(t('transferReview.deleteConfirm', label))) return;

    setDeletingIds((prev) => new Set([...prev, transfer.id]));
    try {
      await API.delete(`/admin/pending-transfers/${transfer.id}/`);
      setTransfers((prev) => prev.filter((item) => item.id !== transfer.id));
      setEdits((prev) => {
        const next = new Map(prev);
        next.delete(transfer.id);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(transfer.id);
        return next;
      });
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.delete(transfer.id);
        return next;
      });
      setSaveErrors((prev) => {
        const next = { ...prev };
        delete next[transfer.id];
        return next;
      });
      setActionErrors((prev) => {
        const next = { ...prev };
        delete next[transfer.id];
        return next;
      });
    } catch (err) {
      window.alert(err.response?.data?.error || t('transferReview.deleteFailed'));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(transfer.id);
        return next;
      });
    }
  }, [t]);

  const toggleSelected = (transferId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(transferId)) next.delete(transferId);
      else next.add(transferId);
      return next;
    });
  };

  const postTransfer = useCallback(async (transfer) => {
    if (!destinationReady(transfer)) return;
    setPostingIds((prev) => new Set([...prev, transfer.id]));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[transfer.id];
      return next;
    });

    try {
      await API.post(`/admin/pending-transfers/${transfer.id}/post/`);
      loadTransfers();
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [transfer.id]: err.response?.data?.error || t('transferReview.postFailed'),
      }));
      setTransfers((prev) => prev.map((item) => (
        item.id === transfer.id && err.response?.data?.data?.transfer
          ? err.response.data.data.transfer
          : item
      )));
    } finally {
      setPostingIds((prev) => {
        const next = new Set(prev);
        next.delete(transfer.id);
        return next;
      });
    }
  }, [loadTransfers, t, destinationReady]);

  const reconcilePositions = useCallback(async (transfer) => {
    setReconcilingIds((prev) => new Set([...prev, transfer.id]));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[transfer.id];
      return next;
    });
    try {
      await API.post(`/admin/pending-transfers/${transfer.id}/reconcile-positions/`);
      loadTransfers();
    } catch (err) {
      const updated = err.response?.data?.data?.transfer;
      setActionErrors((prev) => ({
        ...prev,
        [transfer.id]: err.response?.data?.error || t('transferReview.reconciliationFailed'),
      }));
      if (updated) {
        setTransfers((prev) => prev.map((item) => (item.id === transfer.id ? updated : item)));
      }
    } finally {
      setReconcilingIds((prev) => {
        const next = new Set(prev);
        next.delete(transfer.id);
        return next;
      });
    }
  }, [loadTransfers, t]);

  const postSelected = async () => {
    if (selectableTransfers.some((transfer) => selectedIds.has(transfer.id) && !destinationReady(transfer))) return;
    if (!adminUser) return;
    const selected = selectableTransfers.filter((transfer) => selectedIds.has(transfer.id));
    const transferIds = selected.map((transfer) => transfer.id);
    setPostingIds(new Set(transferIds));
    setActionErrors((prev) => {
      const next = { ...prev };
      transferIds.forEach((transferId) => delete next[transferId]);
      return next;
    });

    try {
      const response = await API.post('/admin/pending-transfers/post-selected/', {
        transfer_ids: transferIds,
      });
      const results = response.data?.data?.results || [];
      const resultErrors = {};
      results.forEach((result) => {
        if (result.status !== 'POSTED') {
          resultErrors[result.id] = result.error || t('transferReview.postFailed');
        }
      });
      const updatedById = new Map(
        results
          .filter((result) => result.transfer)
          .map((result) => [result.id, result.transfer]),
      );
      setTransfers((prev) => prev.map((transfer) => (
        updatedById.get(transfer.id) || transfer
      )));
      setActionErrors((prev) => ({ ...prev, ...resultErrors }));
      setSelectedIds(new Set(
        results
          .filter((result) => result.status !== 'POSTED')
          .map((result) => result.id),
      ));
    } catch (err) {
      const error = err.response?.data?.error || t('transferReview.postFailed');
      setActionErrors((prev) => {
        const next = { ...prev };
        transferIds.forEach((transferId) => {
          next[transferId] = error;
        });
        return next;
      });
    } finally {
      setPostingIds(new Set());
    }
  };

  // Unified rows list
  const unifiedRows = useMemo(() => {
    const rows = [];

    // 1. Internal Transfers (filtered by stageFilter, dateFrom, dateTo)
    const filteredTransfers = transfers.filter((t) => {
      if (stageFilter !== 'ALL' && t.transfer_stage !== stageFilter) return false;
      if (dateFrom) {
        const rowDate = toLocalDateStr(t.created_at);
        if (!rowDate || rowDate < dateFrom) return false;
      }
      if (dateTo) {
        const rowDate = toLocalDateStr(t.created_at);
        if (!rowDate || rowDate > dateTo) return false;
      }
      return true;
    });

    for (const transfer of filteredTransfers) {
      rows.push({
        id: `internal-${transfer.id}`,
        rawId: transfer.id,
        isPhysical: false,
        stage: transfer.transfer_stage,
        stageLabelKey: STAGE_LABELS[transfer.transfer_stage] || 'transferReview.stage',
        type: 'internal',
        batchNumber: lineValue(transfer, 'batch_number'),
        fromLocation: transfer.from_warehouse,
        fromBin: transfer.from_bin,
        toLocation: transfer.to_warehouse,
        toBin: transfer.to_bin,
        palletPositionCode: transfer.pallet_position_code,
        itemCode: lineValue(transfer, 'item_code'),
        itemName: lineValue(transfer, 'item_name'),
        quantity: transfer.quantity,
        status: transfer.status,
        user: transfer.created_by,
        createdAt: transfer.created_at,
        reference: transfer.sap_doc_num || transfer.sap_doc_entry || `#${transfer.id}`,
        rawTransfer: transfer,
      });
    }

    // 2. Physical Stage 5 Events
    const allowPhysical =
      (statusFilter === 'ALL' || statusFilter === 'POSTED') &&
      (stageFilter === 'ALL' || stageFilter === 'STAGE_5_TO_CONTAINER');

    if (allowPhysical) {
      const q = search.trim().toLowerCase();
      for (const event of physicalEvents) {
        if (dateFrom) {
          const rowDate = toLocalDateStr(event.created_at);
          if (!rowDate || rowDate < dateFrom) continue;
        }
        if (dateTo) {
          const rowDate = toLocalDateStr(event.created_at);
          if (!rowDate || rowDate > dateTo) continue;
        }
        if (q) {
          const match =
            (event.batch_number && event.batch_number.toLowerCase().includes(q)) ||
            (event.source_location && event.source_location.toLowerCase().includes(q)) ||
            (event.container_number && event.container_number.toLowerCase().includes(q)) ||
            (event.actor && event.actor.toLowerCase().includes(q)) ||
            (event.reference && String(event.reference).toLowerCase().includes(q));
          if (!match) continue;
        }

        rows.push({
          id: `physical-${event.reference || event.id}`,
          rawId: event.id,
          isPhysical: true,
          stage: 'STAGE_5_TO_CONTAINER',
          stageLabelKey: 'transferReview.stage5',
          type: 'shipping',
          batchNumber: event.batch_number,
          fromLocation: event.source_location,
          toLocation: null,
          toBin: null,
          containerNumber: event.container_number,
          itemCode: '-',
          itemName: '',
          quantity: null,
          status: event.state,
          user: event.actor,
          createdAt: event.created_at,
          reference: event.reference || event.source_operation,
          rawEvent: event,
        });
      }
    }

    // Sort descending by created_at
    rows.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    return rows;
  }, [transfers, physicalEvents, stageFilter, statusFilter, dateFrom, dateTo, search]);

  return (
    <div className="rr-page-shell tr-page">
      <div className="rr-page-col">
        <header className="rr-page-header">
          <div>
            <span className="rr-page-header__kicker">
              {adminUser ? t('transferReview.adminReview') : t('transferReview.myTransfers')}
            </span>
            <h1 className="rr-page-header__title">{t('transferReview.title')}</h1>
          </div>
          <div className="rr-page-header__actions">
            {adminUser && (
              <button
                type="button"
                className="app-button app-button--success rr-header-btn"
                onClick={postSelected}
                disabled={selectedPostableCount === 0 || postingIds.size > 0 || selectableTransfers.some((transfer) => selectedIds.has(transfer.id) && !destinationReady(transfer))}
                aria-busy={postingIds.size > 0 ? 'true' : 'false'}
              >
                {postingIds.size > 0 ? (
                  <>
                    <AppSpinner size="xs" />
                    <span>{t('common.postingToSap')}</span>
                  </>
                ) : (
                  t('transferReview.postSelected', selectedPostableCount)
                )}
              </button>
            )}
            <button
              type="button"
              className="app-button app-button--secondary rr-header-first-btn"
              onClick={() => {
                loadTransfers();
                loadPhysicalEvents();
                loadReservedOutbound();
              }}
              disabled={loading || physicalLoading || reservedOutboundLoading}
              aria-busy={loading || physicalLoading ? 'true' : 'false'}
            >
              {loading || physicalLoading ? (
                <>
                  <AppSpinner size="xs" />
                  <span>{t('transferReview.refreshing')}</span>
                </>
              ) : (
                t('transferReview.refresh')
              )}
            </button>
          </div>
        </header>

        {/* Stats Row */}
        <div className="rr-stats-row">
          {[
            { label: t('transferReview.pendingTransfers'), value: pendingCount, color: 'var(--warning)' },
            { label: t('transferReview.failedTransfers'),  value: failedCount,  color: 'var(--danger)'  },
            { label: t('transferReview.posted'),           value: postedCount,  color: 'var(--success)' },
            { label: t('transferReview.loadedToContainer'), value: loadedToContainerCount, color: 'var(--primary)' },
            { label: t('transferReview.selected'),         value: selectedCount, color: 'var(--text)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rr-stat-chip">
              <span className="rr-stat-chip__value" style={{ color }}>{value}</span>
              <span className="rr-stat-chip__label">{label}</span>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="rr-filter-bar">
          <label>
            <span className="rr-filter-label">{t('transferReview.status')}</span>
            <StandardDropdown
              className="app-select rr-filter-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="PENDING">{t('transferReview.pending')}</option>
              <option value="FAILED">{t('transferReview.failed')}</option>
              <option value="POSTED">{t('transferReview.posted')}</option>
              <option value="ALL">{t('transferReview.allStatuses')}</option>
            </StandardDropdown>
          </label>

          <label>
            <span className="rr-filter-label">{t('transferReview.stageFilter')}</span>
            <StandardDropdown
              className="app-select rr-filter-stage"
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value)}
            >
              <option value="ALL">{t('transferReview.allStages')}</option>
              <option value="STAGE_1_TO_INTERMEDIATE">{t('transferReview.stage1')}</option>
              <option value="STAGE_2_TO_FRIDGE">{t('transferReview.stage2')}</option>
              <option value="STAGE_3_FROM_FRIDGE">{t('transferReview.stage3')}</option>
              <option value="STAGE_4_TO_DESTINATION">{t('transferReview.stage4')}</option>
              <option value="STAGE_5_TO_CONTAINER">{t('transferReview.stage5')}</option>
            </StandardDropdown>
          </label>

          <label>
            <span className="rr-filter-label">{t('transferReview.fromFilter')}</span>
            <input
              type="date"
              className="app-input rr-filter-input rr-filter-date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>

          <label>
            <span className="rr-filter-label">{t('transferReview.toFilter')}</span>
            <input
              type="date"
              className="app-input rr-filter-input rr-filter-date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>

          <label className="tr-search-field">
            <span className="rr-filter-label">{t('transferReview.search')}</span>
            <input
              className="app-input rr-filter-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('transferReview.searchPlaceholder')}
            />
          </label>

          <button
            type="button"
            className="app-button app-button--secondary rr-filter-clear-btn"
            onClick={() => {
              setStatusFilter('PENDING');
              setStageFilter('ALL');
              setDateFrom('');
              setDateTo('');
              setSearch('');
            }}
          >
            {t('transferReview.clear')}
          </button>
        </div>

        {loadError && (
          <div className="feedback-message feedback-message--error" role="alert">
            {loadError}
            <button type="button" className="app-button app-button--secondary" onClick={loadTransfers} disabled={loading}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {loading && transfers.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '1.25rem' }}>
            <AppSpinner size="md" label={t('transferReview.loading')} />
            <LoadingSkeleton rows={5} style={{ width: '100%' }} />
          </div>
        ) : loadError ? null : unifiedRows.length === 0 ? (
          <div className="rr-grid-empty">{t('transferReview.empty')}</div>
        ) : (
          <div className="rr-grid-wrap">
            <div className="rr-grid-scroll tr-grid-scroll">
              <table className="tr-table">
                <thead>
                  <tr>
                    <th>
                      {adminUser && (
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          checked={allSelectableChecked}
                          onChange={toggleSelectAll}
                          disabled={selectableIds.length === 0}
                          aria-label={t('transferReview.selectAllPostable')}
                        />
                      )}
                    </th>
                    <th>{t('transferReview.batch')}</th>
                    <th>{t('transferReview.stage')}</th>
                    <th>{t('transferReview.type')}</th>
                    <th>{t('transferReview.fromWh')}</th>
                    <th>{t('transferReview.toOrContainer')}</th>
                    <th>{t('transferReview.physicalPosition')}</th>
                    <th>{t('transferReview.itemCode')}</th>
                    <th>{t('transferReview.itemName')}</th>
                    <th>{t('transferReview.qty')}</th>
                    <th>{t('transferReview.status')}</th>
                    <th>{t('transferReview.by')}</th>
                    <th>{t('transferReview.created')}</th>
                    <th>{t('transferReview.reference')}</th>
                    <th>{t('transferReview.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {unifiedRows.map((row) => {
                    if (row.isPhysical) {
                      // Stage 5 Physical Event Row
                      return (
                        <tr key={row.id}>
                          <td>-</td>
                          <td className="transfer-lines-mono">
                            <bdi>{row.batchNumber || '-'}</bdi>
                          </td>
                          <td>
                            <span className="tr-stage-pill tr-stage-pill--stage-5">
                              {t('transferReview.stage5')}
                            </span>
                          </td>
                          <td>
                            <span className="tr-type-pill tr-type-pill--shipping">
                              {t('transferReview.typeShipping')}
                            </span>
                          </td>
                          <td>
                            <span className="transfer-lines-mono">{row.fromLocation || '-'}</span>
                          </td>
                          <td>
                            <span className="tr-container-dest">
                              🚢 {t('transferReview.container')}: <bdi className="transfer-lines-mono">{row.containerNumber || '-'}</bdi>
                            </span>
                          </td>
                          <td>-</td>
                          <td>-</td>
                          <td>-</td>
                          <td className="tr-num">-</td>
                          <td>
                            <span className="rr-status-badge rr-status-badge--POSTED">
                              {t('physicalTransfer.LOADED_TO_CONTAINER')}
                            </span>
                          </td>
                          <td>{row.user || '-'}</td>
                          <td>{fmtDate(row.createdAt)}</td>
                          <td className="transfer-lines-mono">
                            <bdi>{row.reference || '-'}</bdi>
                          </td>
                          <td>
                            <span className="tr-muted">{t('transferReview.readOnly')}</span>
                          </td>
                        </tr>
                      );
                    }

                    // Internal SAP Transfer Row (Stages 1–4)
                    const transfer = row.rawTransfer;
                    const canPost = adminUser && (transfer.status === 'PENDING' || transfer.status === 'FAILED');
                    const canEdit = canPost;
                    const isPosting = postingIds.has(transfer.id);
                    const isReconciling = reconcilingIds.has(transfer.id);
                    const isSaving = savingIds.has(transfer.id);
                    const isDeleting = deletingIds.has(transfer.id);
                    const isSaved = savedIds.has(transfer.id);
                    const errorText = actionErrors[transfer.id] || transfer.error_message || '';
                    const reconciliation = transfer.position_reconciliation;
                    const needsReconciliation = adminUser && reconciliation?.status === 'PENDING';
                    const saveError = saveErrors[transfer.id] || '';
                    const edit = edits.get(transfer.id) || makeTransferEdit(transfer);
                    const sourceStatus = sourceStatusForTransfer(transfer, t);
                    const singleLine = getLines(transfer).length === 1;

                    return (
                      <tr key={row.id} className={selectedIds.has(transfer.id) ? 'rr-selected' : ''}>
                        <td>
                          {canPost ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(transfer.id)}
                              onChange={() => toggleSelected(transfer.id)}
                            />
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="transfer-lines-mono">
                          <bdi>{row.batchNumber}</bdi>
                        </td>
                        <td>
                          <span className={`tr-stage-pill tr-stage-pill--${String(transfer.transfer_stage || '').toLowerCase()}`}>
                            {STAGE_LABELS[transfer.transfer_stage] ? t(STAGE_LABELS[transfer.transfer_stage]) : transfer.transfer_stage}
                          </span>
                        </td>
                        <td>
                          <span className="tr-type-pill tr-type-pill--internal">
                            {t('transferReview.typeInternal')}
                          </span>
                        </td>
                        <td>
                          {canEdit ? (
                            <SearchableSelect
                              dense
                              className="cell-input tr-cell-select"
                              searchSource={transferWarehouseSearch}
                              value={edit.from_warehouse}
                              onChange={(event) => updateEdit(transfer.id, 'from_warehouse', event.target.value)}
                            >
                              <option value="">-</option>
                              {warehouses.map((warehouse) => (
                                <option key={warehouse.code} value={warehouse.code}>
                                  {warehouse.code} - {warehouse.name}
                                </option>
                              ))}
                            </SearchableSelect>
                          ) : (
                            <span className="transfer-lines-mono">
                              {transfer.from_warehouse || '-'}
                            </span>
                          )}
                        </td>
                        <td>
                          {canEdit ? (
                            <SearchableSelect
                              dense
                              className="cell-input tr-cell-select"
                              searchSource={transferWarehouseSearch}
                              value={edit.to_warehouse}
                              onChange={(event) => updateEdit(transfer.id, 'to_warehouse', event.target.value)}
                            >
                              <option value="">-</option>
                              {warehouses.map((warehouse) => (
                                <option key={warehouse.code} value={warehouse.code}>
                                  {warehouse.code} - {warehouse.name}
                                </option>
                              ))}
                            </SearchableSelect>
                          ) : (
                            <span className="transfer-lines-mono">
                              {transfer.to_warehouse || '-'}
                              {transfer.to_bin ? ` (${transfer.to_bin})` : ''}
                            </span>
                          )}
                        </td>
                        <td className="transfer-lines-mono">
                          {transfer.source_pallet_position_code ? (
                            <span className="tr-position-pill" title={`${t('transfer.sourcePalletPosition')}: ${transfer.source_pallet_position_code}`}>
                              📤 {transfer.source_pallet_position_code}
                            </span>
                          ) : transfer.pallet_position_code ? (
                            <span className="tr-position-pill" title={`${t('transfer.physicalPosition')}: ${transfer.pallet_position_code}`}>
                              📍 {transfer.pallet_position_code}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="transfer-lines-mono">
                          <bdi>{row.itemCode || '-'}</bdi>
                        </td>
                        <td title={row.itemName || ''} style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.itemName || '-'}
                        </td>
                        <td className="tr-num">
                          {canEdit && singleLine ? (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              className="cell-input tr-cell-input tr-cell-input--num"
                              style={{ width: '70px', padding: '2px 6px' }}
                              value={edit.quantity}
                              onChange={(event) => updateEdit(transfer.id, 'quantity', event.target.value)}
                            />
                          ) : (
                            <span>{fmtQty(transfer.quantity)}</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                            <StatusBadge status={transfer.status} t={t} />
                            {transfer.status !== 'POSTED' && sourceStatus.label && (
                              <span className={`tr-source-badge tr-source-badge--${sourceStatus.tone}`}>
                                {sourceStatus.label}
                              </span>
                            )}
                            {errorText && (
                              <span className="tr-error-badge" title={errorText} style={{ cursor: 'pointer' }}>⚠️</span>
                            )}
                          </div>
                          {saveError && <div className="tr-save-error">{saveError}</div>}
                        </td>
                        <td>{transfer.created_by || '-'}</td>
                        <td>{fmtDate(transfer.created_at)}</td>
                        <td className="transfer-lines-mono">
                          <bdi>{transfer.sap_doc_num || transfer.sap_doc_entry || `#${transfer.id}`}</bdi>
                        </td>
                        <td>
                          {canPost ? (
                            <div className="tr-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                className="app-button app-button--secondary tr-post-btn"
                                onClick={() => saveTransfer(transfer)}
                                disabled={isSaving || isPosting || isDeleting}
                                aria-busy={isSaving ? 'true' : 'false'}
                              >
                                {isSaving ? <AppSpinner size="xs" /> : isSaved ? t('transferReview.saved') : t('transferReview.save')}
                              </button>
                              <button
                                type="button"
                                className="app-button app-button--secondary tr-post-btn"
                                onClick={() => deleteTransfer(transfer)}
                                disabled={isDeleting || isSaving || isPosting}
                                aria-busy={isDeleting ? 'true' : 'false'}
                              >
                                {isDeleting ? <AppSpinner size="xs" /> : t('common.delete')}
                              </button>
                              <button
                                type="button"
                                className="app-button app-button--success tr-post-btn"
                                onClick={() => postTransfer(transfer)}
                                disabled={isPosting || isSaving || isDeleting || !destinationReady(transfer)}
                                aria-busy={isPosting ? 'true' : 'false'}
                              >
                                {isPosting ? <AppSpinner size="xs" /> : t('transferReview.post')}
                              </button>
                            </div>
                          ) : needsReconciliation ? (
                            <button
                              type="button"
                              className="app-button app-button--secondary tr-post-btn"
                              onClick={() => reconcilePositions(transfer)}
                              disabled={isReconciling}
                              aria-busy={isReconciling ? 'true' : 'false'}
                            >
                              {isReconciling ? <AppSpinner size="xs" /> : t('transferReview.retryReconciliation')}
                            </button>
                          ) : (
                            <span className="tr-muted">
                              {transfer.status === 'POSTED' ? t('transferReview.posted') : t('transferReview.readOnly')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {adminUser && (
          <section className="tr-reserved-report" aria-labelledby="reserved-outbound-title">
            <div className="tr-reserved-report__header">
              <div>
                <h2 id="reserved-outbound-title">{t('transferReview.reservedOutboundTitle')}</h2>
                <p>{t('transferReview.reservedOutboundDescription')}</p>
              </div>
              <span className="rr-stat-chip__value">{reservedOutbound.length}</span>
            </div>
            {reservedOutboundError && (
              <div className="feedback-message feedback-message--error">{reservedOutboundError}</div>
            )}
            {reservedOutboundLoading ? (
              <div className="rr-grid-loading">{t('transferReview.reservedOutboundLoading')}</div>
            ) : reservedOutbound.length === 0 ? (
              <div className="rr-grid-empty">{t('transferReview.reservedOutboundEmpty')}</div>
            ) : (
              <div className="rr-grid-wrap">
                <div className="rr-grid-scroll tr-reserved-report__scroll">
                  <table className="tr-reserved-table">
                    <thead>
                      <tr>
                        <th>{t('transferReview.physicalPosition')}</th>
                        <th>{t('transferReview.reservationReference')}</th>
                        <th>{t('transferReview.reservedBy')}</th>
                        <th>{t('transferReview.reservedAt')}</th>
                        <th>{t('transferReview.fromWh')}</th>
                        <th>{t('transferReview.sourceSapBin')}</th>
                        <th>{t('transferReview.batch')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservedOutbound.map((position) => (
                        <tr key={position.id}>
                          <td className="transfer-lines-mono">{position.position_code}</td>
                          <td className="transfer-lines-mono">{position.reservation_reference || '-'}</td>
                          <td>{position.reserved_by || '-'}</td>
                          <td>{fmtDate(position.reserved_at)}</td>
                          <td className="transfer-lines-mono">{position.source_warehouse}</td>
                          <td className="transfer-lines-mono">
                            {position.source_sap_bin} (#{position.source_sap_bin_abs_entry})
                          </td>
                          <td className="transfer-lines-mono">{position.batch_number || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
