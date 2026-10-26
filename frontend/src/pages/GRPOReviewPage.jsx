import StandardDropdown from '../components/ui/StandardDropdown';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Paper,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import CloseIcon from '@mui/icons-material/Close';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import EmptyState from '../components/ui/EmptyState';
import PrintDocumentBarcode from '../components/print/PrintDocumentBarcode';
import { loadCompletedGrpoReviews } from '../services/purchaseGrpoService';
import { openBlankPrintWindow, writePrintDocument } from '../utils/printDocument';
import { prepareShippingReceivingPrintRecord } from '../utils/shippingReceivingPrintIdentifiers';
import egastLogo from '../assets/logos/egast-logo.png';
import { ViewActionButton, PrintActionButton } from '../components/ui/ActionIconButton';
import '../styles/pages/receipt-review.css';
import '../styles/pages/quality-inspection.css';
import { getProductIcon } from '../utils/productIcon';

function GRPOReviewPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const toast = useToast();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Top-level filters matching ReceiptReviewPage
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fItem, setFItem] = useState('');
  const [fVehicle, setFVehicle] = useState('');
  const [fStatus, setFStatus] = useState('all');

  // Search input
  const [search, setSearch] = useState('');

  // Row selection & printing
  const [selectedIds, setSelectedIds] = useState([]);
  const [printingRecordsList, setPrintingRecordsList] = useState([]);
  const [printRequest, setPrintRequest] = useState(null);
  const printContainerRef = useRef(null);

  const fetchCompletedGrpos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadCompletedGrpoReviews();
      setRecords(data);
    } catch (err) {
      console.error('Failed to load completed GRPO reviews:', err);
      const msg = err.response?.data?.error || t('grpo.errorLoading');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    fetchCompletedGrpos();
  }, [fetchCompletedGrpos]);

  const filtersActive = Boolean(
    fDateFrom ||
    fDateTo ||
    fSupplier.trim() ||
    fItem.trim() ||
    fVehicle.trim() ||
    (fStatus !== 'all' && fStatus !== '')
  );

  const handleClearFilters = () => {
    setFDateFrom('');
    setFDateTo('');
    setFSupplier('');
    setFItem('');
    setFVehicle('');
    setFStatus('all');
  };

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // 1. From Date & 2. To Date
      const dateVal = (r.posted_at ? r.posted_at.slice(0, 10) : r.posting_date) || '';
      if (fDateFrom && dateVal && dateVal < fDateFrom) return false;
      if (fDateTo && dateVal && dateVal > fDateTo) return false;
      if ((fDateFrom || fDateTo) && !dateVal) return false;

      // 3. Supplier
      if (fSupplier.trim()) {
        const sTerm = fSupplier.trim().toLowerCase();
        const vName = String(r.vendor_name || '').toLowerCase();
        const sName = String(r.supplier_name || '').toLowerCase();
        const vCode = String(r.vendor_card_code || '').toLowerCase();
        if (!vName.includes(sTerm) && !sName.includes(sTerm) && !vCode.includes(sTerm)) {
          return false;
        }
      }

      // 4. Product / Item
      if (fItem.trim()) {
        const iTerm = fItem.trim().toLowerCase();
        const iName = String(r.item_name || '').toLowerCase();
        const iCode = String(r.item_code || '').toLowerCase();
        if (!iName.includes(iTerm) && !iCode.includes(iTerm)) {
          return false;
        }
      }

      // 5. Vehicle / Truck
      if (fVehicle.trim()) {
        const vTerm = fVehicle.trim().toLowerCase();
        const cNum = String(r.car_number || '').toLowerCase();
        if (!cNum.includes(vTerm)) {
          return false;
        }
      }

      // 6. Status
      if (fStatus !== 'all' && fStatus !== '') {
        if (r.status !== fStatus) return false;
      }

      // Search query across relevant fields
      const q = search.trim().toLowerCase();
      if (q) {
        const idStr = String(r.id || '').toLowerCase();
        const batch = String(r.batch_number || '').toLowerCase();
        const car = String(r.car_number || '').toLowerCase();
        const vendor = String(r.vendor_name || r.supplier_name || r.vendor_card_code || '').toLowerCase();
        const item = String(r.item_name || r.item_code || '').toLowerCase();
        const wh = String(r.warehouse_code || '').toLowerCase();
        const sapEntry = String(r.sap_doc_entry || '').toLowerCase();
        const sapNum = String(r.sap_doc_num || '').toLowerCase();
        const matchesSearch = (
          idStr.includes(q) ||
          batch.includes(q) ||
          car.includes(q) ||
          vendor.includes(q) ||
          item.includes(q) ||
          wh.includes(q) ||
          sapEntry.includes(q) ||
          sapNum.includes(q)
        );
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [records, fDateFrom, fDateTo, fSupplier, fItem, fVehicle, fStatus, search]);

  const visibleIds = useMemo(() => filteredRecords.map((r) => r.id), [filteredRecords]);

  const isAllVisibleSelected = useMemo(
    () => visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id)),
    [visibleIds, selectedIds],
  );

  const isSomeVisibleSelected = useMemo(
    () => !isAllVisibleSelected && visibleIds.some((id) => selectedIds.includes(id)),
    [isAllVisibleSelected, visibleIds, selectedIds],
  );

  const handleSelectAllClick = () => {
    if (isAllVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleSelectRow = (e, id) => {
    e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleOpenDocument = (record) => {
    navigate(`/grpo/documents/${record.id}`, { state: { from: '/grpo/review' } });
  };

  const handleSinglePrint = async (record) => {
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      return;
    }
    try {
      const preparedRecord = await prepareShippingReceivingPrintRecord(record);
      setPrintingRecordsList([preparedRecord]);
      setPrintRequest({ mode: 'single', printWindow });
    } catch (printError) {
      printWindow.close();
      console.error('Failed to prepare receiving document identifiers:', printError);
      toast.error('Unable to prepare document barcode.');
    }
  };

  const handleBulkPrint = async () => {
    const listToPrint = records.filter((r) => selectedIds.includes(r.id));
    if (listToPrint.length === 0) {
      toast.error('No records selected to print.');
      return;
    }
    const printWindow = openBlankPrintWindow();
    if (!printWindow) {
      toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      return;
    }
    try {
      const preparedRecords = await Promise.all(
        listToPrint.map((record) => prepareShippingReceivingPrintRecord(record)),
      );
      setPrintingRecordsList(preparedRecords);
      setPrintRequest({ mode: 'bulk', count: preparedRecords.length, printWindow });
    } catch (printError) {
      printWindow.close();
      console.error('Failed to prepare receiving document identifiers:', printError);
      toast.error('Unable to prepare document barcodes.');
    }
  };

  useEffect(() => {
    if (!printRequest) return undefined;

    const timer = window.setTimeout(() => {
      const sheets = Array.from(printContainerRef.current?.querySelectorAll('.a4-print-sheet') || []);
      const opened = writePrintDocument({
        printWindow: printRequest.printWindow,
        title: 'EGAST Goods Receiving Document',
        elements: sheets,
      });

      if (!opened) {
        printRequest.printWindow?.close?.();
        toast.error(t('quality.printWindowBlocked') || 'Unable to open print window. Please allow popups.');
      } else if (printRequest.mode === 'bulk') {
        toast.success(`Bulk Print Complete!\nPrinted: ${printRequest.count} receiving document(s).`);
      }

      setPrintRequest(null);
      setPrintingRecordsList([]);
    }, 100);

    return () => window.clearTimeout(timer);
  }, [printRequest, toast, t]);

  return (
    <div className="rr-page-shell grpo-review-page">
      <div className="rr-page-col">
        {/* Scoped CSS for the structured review table matching Receipt Review dimensions */}
        <style>{`
          .grpo-review-page .rr-grid-wrap {
            border: 1px solid var(--border);
            border-radius: 12px;
            background: var(--bg-elevated);
            overflow: clip;
            display: flex;
            flex-direction: column;
            min-height: calc(100vh - 340px);
          }
          .grpo-review-page .rr-grid-scroll {
            overflow-x: auto;
            overflow-y: auto;
            flex: 1 1 auto;
            min-height: calc(100vh - 340px);
            max-height: calc(100vh - 280px);
          }
          .grpo-review-page .grpo-table {
            width: 100%;
            min-width: 1500px;
            border-collapse: collapse;
            font-size: 12px;
            table-layout: auto;
          }
          .grpo-review-page .grpo-table th,
          .grpo-review-page .grpo-table td {
            padding: 11px 12px;
            border-bottom: 1px solid var(--border);
            text-align: start;
            vertical-align: middle;
            line-height: 1.35;
          }
          .grpo-review-page .grpo-table th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: var(--bg-muted);
            color: var(--text-muted);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            white-space: nowrap;
            border-bottom: 2px solid var(--border);
          }
          .grpo-review-page .grpo-table td {
            color: var(--text);
            background: var(--bg-elevated);
          }
          .grpo-review-page .grpo-table tbody tr:nth-child(even) td {
            background: var(--bg-soft);
          }
          .grpo-review-page .grpo-table tbody tr:hover td {
            background: var(--surface-elevated, rgba(37, 99, 235, 0.04));
          }
        `}</style>

        {/* 1. Page Header */}
        <header className="rr-page-header">
          <div>
            <span className="rr-page-header__kicker">{t('grpo.kicker')}</span>
            <h1 className="rr-page-header__title">{t('grpo.reviewTitle')}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
              {t('grpo.reviewSubtitle')}
            </div>
          </div>
          <button
            type="button"
            className="app-button app-button--secondary rr-header-first-btn"
            onClick={fetchCompletedGrpos}
            disabled={loading}
          >
            <span aria-hidden="true" style={{ marginInlineEnd: '4px' }}>↻</span>
            <span>{loading ? t('common.loading') : t('grpo.refresh')}</span>
          </button>
        </header>

        {/* 2. Stats Summary Strip */}
        <div className="rr-stats-row">
          <div className="rr-stat-chip">
            <span className="rr-stat-chip__value" style={{ color: 'var(--success)' }}>
              {records.length}
            </span>
            <span className="rr-stat-chip__label">
              {t('grpo.statusPosted')}
            </span>
          </div>
          <div className="rr-stat-chip">
            <span className="rr-stat-chip__value" style={{ color: 'var(--text)' }}>
              {filteredRecords.length}
            </span>
            <span className="rr-stat-chip__label">
              {t('common.total')}
            </span>
          </div>
          {selectedIds.length > 0 && (
            <div className="rr-stat-chip" style={{ border: '1px solid var(--primary, #1976d2)', background: 'var(--bg-primary-soft)' }}>
              <span className="rr-stat-chip__value" style={{ color: 'var(--primary, #1976d2)' }}>
                {selectedIds.length}
              </span>
              <span className="rr-stat-chip__label" style={{ color: 'var(--primary, #1976d2)', fontWeight: 600 }}>
                {t('review.selected') || 'Selected'}
              </span>
            </div>
          )}
        </div>

        {/* 3. Filter Bar (matching ReceiptReviewPage pattern) */}
        <div className="rr-filter-bar">
          <div>
            <label className="rr-filter-label">{t('review.filterDateFrom')}</label>
            <input
              type="date"
              className="app-input rr-filter-input"
              value={fDateFrom}
              onChange={(e) => setFDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="rr-filter-label">{t('review.filterDateTo')}</label>
            <input
              type="date"
              className="app-input rr-filter-input"
              value={fDateTo}
              onChange={(e) => setFDateTo(e.target.value)}
            />
          </div>
          <div>
            <label className="rr-filter-label">{t('grpo.supplier')}</label>
            <input
              className="app-input rr-filter-input"
              value={fSupplier}
              onChange={(e) => setFSupplier(e.target.value)}
              placeholder={t('common.filter') + '…'}
              style={{ width: '130px' }}
            />
          </div>
          <div>
            <label className="rr-filter-label">{t('grpo.item')}</label>
            <input
              className="app-input rr-filter-input"
              value={fItem}
              onChange={(e) => setFItem(e.target.value)}
              placeholder={t('common.filter') + '…'}
              style={{ width: '130px' }}
            />
          </div>
          <div>
            <label className="rr-filter-label">{t('grpo.vehicleTruck')}</label>
            <input
              className="app-input rr-filter-input"
              value={fVehicle}
              onChange={(e) => setFVehicle(e.target.value)}
              placeholder={t('common.filter') + '…'}
              style={{ width: '110px' }}
            />
          </div>
          <div>
            <label className="rr-filter-label">{t('review.filterStatus')}</label>
            <StandardDropdown
              className="app-input rr-filter-input rr-filter-status"
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
            >
              <option value="all">{t('review.allStatuses')}</option>
              <option value="POSTED">{t('grpo.statusPosted')}</option>
            </StandardDropdown>
          </div>
          {filtersActive && (
            <button
              type="button"
              className="app-button app-button--secondary rr-filter-clear-btn"
              onClick={handleClearFilters}
            >
              {t('common.clear')}
            </button>
          )}
        </div>

        {/* 4. Search Bar (placed directly below Filters before table) */}
        <div className="rr-filter-bar">
          <div style={{ flex: '1 1 320px', minWidth: '240px' }}>
            <label className="rr-filter-label">{t('common.search')}</label>
            <input
              type="search"
              className="app-input rr-filter-input"
              placeholder={t('grpo.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading && records.length === 0}
              style={{ width: '100%' }}
            />
          </div>
          {search && (
            <button
              type="button"
              className="app-button app-button--secondary rr-filter-clear-btn"
              onClick={() => setSearch('')}
            >
              {t('common.clear')}
            </button>
          )}
        </div>

        {/* Floating Bulk Selection & Print Bar */}
        {selectedIds.length > 0 && (
          <Paper
            elevation={1}
            style={{
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'var(--bg-primary-soft, #e3f2fd)',
              borderLeft: '5px solid var(--primary, #1976d2)',
              borderRight: lang === 'ar' ? '5px solid var(--primary, #1976d2)' : undefined,
              borderRadius: '6px',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="subtitle2" style={{ color: 'var(--primary, #1976d2)', fontWeight: 700 }}>
                ✓ {selectedIds.length} {t('review.selected') || 'Selected'}
              </Typography>
            </Box>
            <Box display="flex" gap={1.5} alignItems="center">
              <PrintActionButton icon={<PrintIcon />}
                onClick={handleBulkPrint}
              />
              <Button
                variant="outlined"
                size="small"
                startIcon={<CloseIcon />}
                style={{ color: 'var(--text, #555)', borderColor: 'var(--border, #ccc)', textTransform: 'none' }}
                onClick={() => setSelectedIds([])}
              >
                {t('common.clear') || 'Clear Selection'}
              </Button>
            </Box>
          </Paper>
        )}

        {/* 5. Loading / Error / Empty / Structured Data Table */}
        {loading && records.length === 0 ? (
          <div className="rr-grid-loading" style={{ textAlign: 'center', padding: '48px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
              <CircularProgress size={22} />
              <span>{t('grpo.loading')}</span>
            </div>
          </div>
        ) : error && records.length === 0 ? (
          <div className="card-panel" style={{ textAlign: 'center', padding: '40px 16px' }}>
            <div className="feedback-message feedback-message--error" style={{ marginBottom: '16px' }}>
              {error}
            </div>
            <button
              type="button"
              className="app-button app-button--primary"
              onClick={fetchCompletedGrpos}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="rr-grid-empty" style={{ padding: '48px 24px' }}>
            <EmptyState
              icon="📦"
              title={t('grpo.noCompletedGrpos')}
              message={t('grpo.noCompletedGrposDesc')}
            />
          </div>
        ) : (
          <div className="rr-grid-wrap">
            <div className="rr-grid-scroll">
              <table className="grpo-table">
                <thead>
                  <tr>
                    {/* Checkbox Select All */}
                    <th style={{ width: '46px', textAlign: 'center' }}>
                      <Checkbox
                        size="small"
                        checked={isAllVisibleSelected}
                        indeterminate={isSomeVisibleSelected}
                        onChange={handleSelectAllClick}
                        inputProps={{ 'aria-label': 'Select all' }}
                        style={{ padding: '4px' }}
                      />
                    </th>
                    <th style={{ width: '54px', textAlign: 'center' }}>#</th>
                    <th style={{ minWidth: '110px' }}>{t('grpo.grpoNumber')}</th>
                    <th style={{ minWidth: '140px' }}>{t('grpo.batchNumber')}</th>
                    <th style={{ minWidth: '130px' }}>{t('grpo.vehicleTruck')}</th>
                    <th style={{ minWidth: '220px' }}>{t('grpo.supplier')}</th>
                    <th style={{ minWidth: '220px' }}>{t('grpo.item')}</th>
                    <th style={{ minWidth: '120px', textAlign: 'end' }}>{t('grpo.quantity')}</th>
                    <th style={{ minWidth: '90px', textAlign: 'center' }}>{t('grpo.warehouse')}</th>
                    <th style={{ minWidth: '110px', textAlign: 'center' }}>{t('grpo.postedDate')}</th>
                    <th style={{ minWidth: '100px', textAlign: 'center' }}>{lang === 'ar' ? 'رقم المرجع' : 'Reference Number'}</th>
                    <th style={{ minWidth: '100px', textAlign: 'center' }}>DocNum</th>
                    <th style={{ minWidth: '120px', textAlign: 'center' }}>{t('grpo.status')}</th>
                    <th style={{ minWidth: '90px', textAlign: 'center' }}>{t('quality.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => {
                    const isSelected = selectedIds.includes(record.id);
                    return (
                      <tr key={record.id} style={{ background: isSelected ? 'var(--bg-primary-soft)' : undefined }}>
                        {/* Row Selection Checkbox */}
                        <td style={{ textAlign: 'center' }}>
                          <Checkbox
                            size="small"
                            checked={isSelected}
                            onChange={(e) => handleSelectRow(e, record.id)}
                            inputProps={{ 'aria-label': `Select record #${record.id}` }}
                            style={{ padding: '4px' }}
                          />
                        </td>

                        {/* # / Draft ID */}
                        <td style={{ textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              background: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.10))',
                              color: 'var(--primary, #2563eb)',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                              fontSize: '0.82rem',
                              direction: 'ltr',
                            }}
                          >
                            #{record.id}
                          </span>
                        </td>

                        {/* GRPO Number / Reference */}
                        <td>
                          <strong style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {record.sap_doc_num && record.sap_doc_num !== '-'
                              ? record.sap_doc_num
                              : record.id}
                          </strong>
                        </td>

                        {/* Batch / Order */}
                        <td>
                          <span className="qrev-mono" style={{ fontWeight: 600 }}>
                            {record.batch_number || '-'}
                          </span>
                        </td>

                        {/* Vehicle / Truck */}
                        <td>
                          <span className="qrev-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span aria-hidden="true">🚛</span>
                            <span>{record.car_number || '-'}</span>
                          </span>
                        </td>

                        {/* Supplier / Vendor */}
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {record.vendor_name || record.supplier_name || '-'}
                          </div>
                          {record.vendor_card_code && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {record.vendor_card_code}
                            </div>
                          )}
                        </td>

                        {/* Product / Item */}
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            <span className="meta-label-icon" aria-hidden="true">{getProductIcon(record.item_name || record.item_code)}</span>{' '}
                            {record.item_name || '-'}
                          </div>
                          {record.item_code && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {record.item_code}
                            </div>
                          )}
                        </td>

                        {/* Quantity & UOM */}
                        <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontVariantNumeric: 'tabular-nums',
                              direction: 'ltr',
                              display: 'inline-block',
                            }}
                          >
                            {Number(record.quantity || 0).toLocaleString()}
                          </span>{' '}
                          <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {record.uom_name || record.uom_code || 'KG'}
                          </small>
                        </td>

                        {/* Warehouse */}
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className="qrev-mono"
                            style={{
                              background: 'var(--bg-muted)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {record.warehouse_code || '-'}
                          </span>
                        </td>

                        {/* Posting Date */}
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{ direction: 'ltr', display: 'inline-block', fontVariantNumeric: 'tabular-nums' }}>
                            {record.posted_at ? record.posted_at.slice(0, 10) : (record.posting_date || '-')}
                          </span>
                        </td>

                        {/* SAP DocEntry */}
                        <td style={{ textAlign: 'center' }}>
                          <span className="qrev-mono">{record.sap_doc_entry || '-'}</span>
                        </td>

                        {/* SAP DocNum */}
                        <td style={{ textAlign: 'center' }}>
                          <span className="qrev-mono">{record.sap_doc_num || '-'}</span>
                        </td>

                        {/* Status */}
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span className="rr-status-badge rr-status-badge--POSTED">
                            {t('grpo.statusPosted')}
                          </span>
                        </td>

                        {/* Actions (View & Print) */}
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div className="app-action-icon-group">
                            <ViewActionButton
                              onClick={() => handleOpenDocument(record)}
                            />
                            <PrintActionButton
                              onClick={() => handleSinglePrint(record)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Hidden printable sheets rendered for window.print() via writePrintDocument */}
      {printingRecordsList.length > 0 && (
        <div
          className="qrev-print-report"
          aria-hidden="true"
          style={{ display: 'none' }}
          ref={printContainerRef}
        >
          {printingRecordsList.map((doc, idx) => (
            <div
              key={doc.id}
              className="a4-print-sheet"
              style={{
                pageBreakAfter: idx < printingRecordsList.length - 1 ? 'always' : 'auto',
                position: 'relative',
                width: '100%',
                minHeight: '297mm',
                boxSizing: 'border-box',
                direction: 'rtl',
              }}
            >
              {/* Top Logo Section */}
              <div className="report-print-logo-row">
                <div className="report-header-brand">
                  <img
                    src={egastLogo}
                    alt="EGAST Group"
                    className="report-header-logo"
                  />
                  <div className="report-header-text">
                    <h2>الشركة المصرية للخدمات الزراعية (إيجاست)</h2>
                    <p>SHIPPING &amp; RECEIVING OPERATIONS</p>
                  </div>
                </div>
                <div className="report-doc-no">
                  <span className="report-badge">مستند استلام معتمد</span>
                  <PrintDocumentBarcode identification={doc._printIdentification} />
                </div>
              </div>

              {/* Main Title */}
              <div className="report-main-title">
                <h1>مستند استلام</h1>
                <span>GOODS RECEIVING DOCUMENT</span>
              </div>

              {/* Metadata Grid */}
              <div className="report-info-grid">
                <div className="info-cell">
                  <span className="cell-lbl">رقم المرجع الداخلي:</span>{' '}
                  <strong>#{doc.id}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم المستند:</span>{' '}
                  <strong>{doc.sap_doc_num || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم مرجع المستند:</span>{' '}
                  <strong>{doc.sap_doc_entry || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم التشغيلة / الأمر:</span>{' '}
                  <strong>{doc.batch_number || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">رقم السيارة / الشاحنة:</span>{' '}
                  <strong>{doc.car_number || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">المورد:</span>{' '}
                  <strong>{doc.vendor_name || doc.supplier_name || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">كود المورد:</span>{' '}
                  <strong>{doc.vendor_card_code || '-'}</strong>
                </div>
                {doc.vendor_ref_no && doc.vendor_ref_no !== '-' && (
                  <div className="info-cell">
                    <span className="cell-lbl">رقم مرجع المورد:</span>{' '}
                    <strong>{doc.vendor_ref_no}</strong>
                  </div>
                )}
                {doc.journal_remark && doc.journal_remark !== '-' && (
                  <div className="info-cell">
                    <span className="cell-lbl">ملاحظة تشغيلية:</span>{' '}
                    <strong>{doc.journal_remark}</strong>
                  </div>
                )}
                <div className="info-cell">
                  <span className="cell-lbl">كود الصنف:</span>{' '}
                  <strong>{doc.item_code || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">اسم الصنف / المنتج:</span>{' '}
                  <strong>{doc.item_name || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">الكمية الإجمالية:</span>{' '}
                  <strong>
                    {Number(doc.quantity || 0).toLocaleString()} {doc.uom_name || doc.uom_code || 'KG'}
                  </strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">المستودع / المخزن:</span>{' '}
                  <strong>{doc.warehouse_code || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">الموقع:</span>{' '}
                  <strong>{doc.bin_code || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">تاريخ الاستلام:</span>{' '}
                  <strong>{doc.posted_at ? doc.posted_at.slice(0, 10) : (doc.posting_date || '-')}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">تاريخ المستند:</span>{' '}
                  <strong>{doc.document_date || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">اعتمد بواسطة:</span>{' '}
                  <strong>{doc.posted_by_username || '-'}</strong>
                </div>
                <div className="info-cell">
                  <span className="cell-lbl">حالة المستند:</span>{' '}
                  <strong style={{ color: '#16a34a' }}>تم الاستلام والاعتماد</strong>
                </div>
              </div>

              {/* Line Items Table */}
              <h4 className="report-section-header" style={{ marginTop: '24px' }}>
                بيانات البنود المستلمة (Received Items)
              </h4>
              <table
                className="excel-matrix-table"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginBottom: '24px',
                  fontSize: '12px',
                }}
              >
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', width: '40px' }}>#</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start' }}>كود الصنف</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start' }}>الوصف / المنتج</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>المخزن</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>الموقع</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>رقم التشغيلة</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end' }}>الكمية</th>
                    <th style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>الوحدة</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>1</td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start', fontFamily: 'monospace' }}>
                      {doc.item_code || '-'}
                    </td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'start', fontWeight: 600 }}>
                      {doc.item_name || '-'}
                    </td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                      {doc.warehouse_code || '-'}
                    </td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                      {doc.bin_code || '-'}
                    </td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center', fontFamily: 'monospace' }}>
                      {doc.batch_number || '-'}
                    </td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'end', fontWeight: 700 }}>
                      {Number(doc.quantity || 0).toLocaleString()}
                    </td>
                    <td style={{ border: '1px solid #cbd5e1', padding: '8px', textAlign: 'center' }}>
                      {doc.uom_name || doc.uom_code || 'KG'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Signatures */}
              <div className="report-signature-row" style={{ marginTop: '48px' }}>
                <div className="sig-column">
                  <p>أمين المستودع (المستلم)</p>
                  <div className="sig-line" />
                  <span className="sig-date-placeholder">التوقيع والتاريخ</span>
                </div>
                <div className="sig-column">
                  <p>مسؤول فحص الجودة</p>
                  <div className="sig-line" />
                  <span className="sig-date-placeholder">التوقيع والتاريخ</span>
                </div>
                <div className="sig-column">
                  <p>مدير إدارة المشتريات / المخازن</p>
                  <div className="sig-line" />
                  <span className="sig-date-placeholder">الاعتماد والتاريخ</span>
                </div>
              </div>

              {/* Document Footer */}
              <div className="report-print-footer">
                <span className="report-print-footer-brand">
                  الشركة المصرية للخدمات الزراعية (إيجاست) · قسم الشحن والاستلام
                </span>
                <span className="report-print-footer-meta">
                  GOODS RECEIVING DOCUMENT · Page 1 of 1
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GRPOReviewPage;
