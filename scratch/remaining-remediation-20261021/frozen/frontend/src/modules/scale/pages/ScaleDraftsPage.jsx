import StandardDropdown from '../../../components/ui/StandardDropdown';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  Box,
  Typography,
} from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import LoadingSkeleton from '../../../components/ui/LoadingSkeleton';
import EmptyState from '../../../components/ui/EmptyState';
import scaleApi from '../services/scaleApi';

const INITIAL_FILTERS = {
  search: '',
  date_from: '',
  date_to: '',
  status: 'ALL',
  draft_number: '',
  vehicle_number: '',
  driver: '',
  vendor: '',
  item: '',
  truck_type: '',
  trailer_number: '',
  container_number: '',
  batch_number: '',
  farm_origin: '',
  contractor_name: '',
  raw_material_type: '',
  created_by: '',
  updated_from: '',
  updated_to: '',
  net_weight_loaded_min: '',
  net_weight_loaded_max: '',
  net_weight_empty_min: '',
  net_weight_empty_max: '',
  product_weight_min: '',
  product_weight_max: '',
};

const STATUS_OPTIONS = [
  'ALL',
  'SECOND_WEIGHT_PENDING',
  'COMPLETED',
  'SENT_TO_QUALITY',
  'CANCELLED',
];

function buildQueryParams(filters) {
  return Object.entries(filters).reduce((params, [key, value]) => {
    const cleanValue = String(value ?? '').trim();
    if (!cleanValue || (key === 'status' && cleanValue === 'ALL')) return params;
    params[key] = cleanValue;
    return params;
  }, {});
}

function collectOptionValues(drafts, extractValues) {
  const values = new Set();
  drafts.forEach((draft) => {
    extractValues(draft).forEach((value) => {
      const cleanValue = String(value || '').trim();
      if (cleanValue) values.add(cleanValue);
    });
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function ScaleDraftsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  const [drafts, setDrafts] = useState([]);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isAr = lang === 'ar';
  const label = useCallback((ar, en) => (isAr ? ar : en), [isAr]);

  const statusLabels = useMemo(() => ({
    ALL: label('الكل', t('quality.statusAll') || 'All'),
    SECOND_WEIGHT_PENDING: t('scale.statusPendingSecond'),
    COMPLETED: t('scale.statusCompleted'),
    SENT_TO_QUALITY: t('scale.statusSentToQuality'),
    CANCELLED: t('scale.statusCancelled'),
  }), [label, t]);

  const filterLabels = useMemo(() => ({
    search: t('common.search'),
    date_from: label('من تاريخ', 'From date'),
    date_to: label('إلى تاريخ', 'To date'),
    status: t('common.status') || 'Status',
    draft_number: t('scale.ticketNumber'),
    vehicle_number: t('scale.vehicle'),
    driver: t('scale.driver'),
    vendor: t('scale.supplier'),
    item: t('scale.item'),
    truck_type: t('scale.truckType'),
    trailer_number: t('scale.trailerNumber'),
    container_number: t('scale.containerNumber'),
    batch_number: t('scale.batchOrPivot'),
    farm_origin: label('المنشأ / الحوشة', 'Origin / farm area'),
    contractor_name: label('المقاول / المتعهد', 'Contractor'),
    raw_material_type: label('طبيعة المادة الخام', 'Raw material type'),
    created_by: t('scale.operator'),
    updated_from: label('آخر تحديث من', 'Updated from'),
    updated_to: label('آخر تحديث إلى', 'Updated to'),
    net_weight_loaded_min: label('الوزن القائم من', 'Gross from'),
    net_weight_loaded_max: label('الوزن القائم إلى', 'Gross to'),
    net_weight_empty_min: label('الوزن الفارغ من', 'Tare from'),
    net_weight_empty_max: label('الوزن الفارغ إلى', 'Tare to'),
    product_weight_min: label('الصافي من', 'Net from'),
    product_weight_max: label('الصافي إلى', 'Net to'),
  }), [label, t]);

  const activeFilterEntries = useMemo(() => (
    Object.entries(appliedFilters)
      .filter(([key, value]) => String(value || '').trim() && !(key === 'status' && value === 'ALL'))
      .map(([key, value]) => ({
        key,
        label: filterLabels[key] || key,
        value: key === 'status' ? (statusLabels[value] || value) : value,
      }))
  ), [appliedFilters, filterLabels, statusLabels]);

  const filterOptions = useMemo(() => ({
    vendors: collectOptionValues(drafts, (draft) => [
      draft.vendor_card_code,
      draft.vendor_name,
      ...(draft.allocations || []).flatMap((alloc) => [alloc.vendor_card_code, alloc.vendor_name]),
    ]),
    items: collectOptionValues(drafts, (draft) => [
      draft.item_code,
      draft.item_name,
      ...(draft.allocations || []).flatMap((alloc) => [alloc.item_code, alloc.item_name, alloc.crop_name]),
    ]),
    drivers: collectOptionValues(drafts, (draft) => [draft.effective_driver_name]),
    vehicles: collectOptionValues(drafts, (draft) => [draft.effective_vehicle_number, draft.vehicle_number]),
  }), [drafts]);

  const fetchDrafts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await scaleApi.getDrafts(buildQueryParams(appliedFilters));
      if (res.success) {
        setDrafts(res.data || []);
      }
    } catch {
      // Keep existing quiet failure behavior for this page.
    } finally {
      setIsLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const updateFilter = (field, value) => {
    const nextFilters = { ...filters, [field]: value };
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
  };

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
  };

  const renderFilterField = (field, textLabel, width = '98px', extraProps = {}) => (
    <div>
      <label className="rr-filter-label">{textLabel}</label>
      <input
        className="app-input rr-filter-input"
        value={filters[field]}
        onChange={(e) => updateFilter(field, e.target.value)}
        placeholder={t('common.filter') + '...'}
        style={{ width }}
        {...extraProps}
      />
    </div>
  );

  const renderStatusFilter = () => (
    <div>
      <label className="rr-filter-label">{filterLabels.status}</label>
      <StandardDropdown
        className="app-input rr-filter-input rr-filter-status"
        value={filters.status}
        onChange={(e) => updateFilter('status', e.target.value)}
      >
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {statusLabels[status]}
          </option>
        ))}
      </StandardDropdown>
    </div>
  );

  const renderDateFilter = (field, textLabel) => (
    renderFilterField(field, textLabel, '128px', { type: 'date' })
  );

  const renderOptionFilter = (field, textLabel, options, width = '118px') => (
    <>
      {options.length > 0 && (
        <datalist id={`scale-drafts-${field}-options`}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
      {renderFilterField(field, textLabel, width, {
        list: options.length > 0 ? `scale-drafts-${field}-options` : undefined,
      })}
    </>
  );

  const renderTruckTypeFilter = () => (
    <div>
      <label className="rr-filter-label">{filterLabels.truck_type}</label>
      <StandardDropdown
        className="app-input rr-filter-input rr-filter-status"
        value={filters.truck_type}
        onChange={(e) => updateFilter('truck_type', e.target.value)}
        placeholder={label('الكل', 'All')}
      >
        <option value="">{label('الكل', 'All')}</option>
        <option value="normal">{t('scale.normalTruck')}</option>
        <option value="container">{t('scale.containerTruck')}</option>
      </StandardDropdown>
    </div>
  );

  const getStatusChip = (draft) => {
    const status = draft.status;
    let chipLabel = draft.status_display;
    let bg = 'var(--bg-soft, rgba(100, 116, 139, 0.1))';
    let color = 'var(--text-muted, #475569)';
    let borderColor = 'var(--border, rgba(100, 116, 139, 0.2))';

    if (status === 'SECOND_WEIGHT_PENDING') {
      chipLabel = chipLabel || t('scale.statusPendingSecond');
      bg = 'var(--bg-warning-soft, rgba(183, 121, 31, 0.12))';
      color = 'var(--warning, #b7791f)';
      borderColor = 'var(--warning-border, rgba(183, 121, 31, 0.35))';
    } else if (status === 'COMPLETED') {
      chipLabel = chipLabel || t('scale.statusCompleted');
      bg = 'var(--bg-primary-soft, rgba(37, 99, 235, 0.10))';
      color = 'var(--primary, #2563eb)';
      borderColor = 'var(--border-strong, rgba(37, 99, 235, 0.3))';
    } else if (status === 'SENT_TO_QUALITY') {
      chipLabel = chipLabel || t('scale.statusSentToQuality');
      bg = 'var(--bg-success-soft, rgba(22, 128, 60, 0.10))';
      color = 'var(--success, #16803c)';
      borderColor = 'var(--border, rgba(22, 128, 60, 0.3))';
    } else if (status === 'CANCELLED') {
      chipLabel = chipLabel || t('scale.statusCancelled');
      bg = 'var(--bg-danger-soft, rgba(194, 65, 12, 0.10))';
      color = 'var(--danger, #c2410c)';
      borderColor = 'var(--danger-border, rgba(194, 65, 12, 0.35))';
    }

    return (
      <Chip
        size="small"
        label={chipLabel || status}
        sx={{
          fontWeight: 700,
          fontSize: '0.725rem',
          height: 24,
          bgcolor: bg,
          color: color,
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-sm, 6px)',
          px: 0.5,
          whiteSpace: 'var(--scale-drafts-white-space, nowrap)',
        }}
      />
    );
  };

  const formatWeight = (val, isNet = false) => {
    if (val === null || val === undefined || val === '') {
      return (
        <Typography
          component="span"
          sx={{ color: 'var(--text-subtle, #8290a3)', fontSize: '0.85rem' }}
        >
          -
        </Typography>
      );
    }
    const num = Number(val);
    if (Number.isNaN(num)) return '-';
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          justifyContent: 'flex-end',
          gap: '3px',
          fontWeight: isNet ? 800 : 600,
          color: isNet ? 'var(--primary, #2563eb)' : 'var(--text, #172033)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'var(--scale-drafts-white-space, nowrap)',
        }}
      >
        <span style={{ fontSize: `var(--scale-draft-weight-size, ${isNet ? '0.9rem' : '0.84rem'})` }}>
          {num.toLocaleString()}
        </span>
        <Typography
          component="span"
          sx={{
            fontSize: '0.675rem',
            fontWeight: 500,
            color: 'var(--text-muted, #5d6b7c)',
            userSelect: 'none',
          }}
        >
          {isAr ? 'كجم' : 'KG'}
        </Typography>
      </Box>
    );
  };

  const formatDraftDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(isAr ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  return (
    <div className="page-shell scale-drafts-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.draftsTitle')}
        description={t('scale.draftsSubtitle')}
        actions={
          <Button
            variant="contained"
            color="primary"
            onClick={() => navigate('/scale/weighing')}
            sx={{ fontWeight: 700, px: 2.5, py: 1, borderRadius: 'var(--radius-md, 8px)' }}
          >
            + {t('scale.weighingTitle')}
          </Button>
        }
      />

      <div style={{ marginBottom: 18 }}>
        <div className="rr-filter-bar" style={{ marginBottom: showAdvancedFilters || activeFilterEntries.length ? 8 : 0 }}>
          {renderStatusFilter()}
          {renderFilterField('draft_number', filterLabels.draft_number, '112px')}
          {renderOptionFilter('vehicle_number', filterLabels.vehicle_number, filterOptions.vehicles, '118px')}
          {renderOptionFilter('driver', filterLabels.driver, filterOptions.drivers, '118px')}
          {renderOptionFilter('vendor', filterLabels.vendor, filterOptions.vendors, '126px')}
          {renderOptionFilter('item', filterLabels.item, filterOptions.items, '126px')}
          {renderDateFilter('date_from', filterLabels.date_from)}
          {renderDateFilter('date_to', filterLabels.date_to)}
          {renderFilterField('search', filterLabels.search, '148px')}
          <button
            type="button"
            className="app-button app-button--secondary rr-filter-clear-btn"
            onClick={() => setShowAdvancedFilters((prev) => !prev)}
          >
            {showAdvancedFilters ? label('إخفاء', 'Hide') : label('المزيد', 'More')}
          </button>
          {activeFilterEntries.length > 0 && (
            <button
              type="button"
              className="app-button app-button--secondary rr-filter-clear-btn"
              onClick={clearFilters}
            >
              {label('مسح الفلاتر', 'Clear filters')}
            </button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="rr-filter-bar" style={{ marginBottom: activeFilterEntries.length ? 8 : 0 }}>
            {renderTruckTypeFilter()}
            {renderFilterField('trailer_number', filterLabels.trailer_number, '106px')}
            {renderFilterField('container_number', filterLabels.container_number, '106px')}
            {renderFilterField('batch_number', filterLabels.batch_number, '106px')}
            {renderFilterField('farm_origin', filterLabels.farm_origin, '118px')}
            {renderFilterField('contractor_name', filterLabels.contractor_name, '118px')}
            {renderFilterField('raw_material_type', filterLabels.raw_material_type, '118px')}
            {renderFilterField('created_by', filterLabels.created_by, '100px')}
            {renderDateFilter('updated_from', filterLabels.updated_from)}
            {renderDateFilter('updated_to', filterLabels.updated_to)}
            {renderFilterField('net_weight_loaded_min', filterLabels.net_weight_loaded_min, '104px', { type: 'number' })}
            {renderFilterField('net_weight_loaded_max', filterLabels.net_weight_loaded_max, '104px', { type: 'number' })}
            {renderFilterField('net_weight_empty_min', filterLabels.net_weight_empty_min, '104px', { type: 'number' })}
            {renderFilterField('net_weight_empty_max', filterLabels.net_weight_empty_max, '104px', { type: 'number' })}
            {renderFilterField('product_weight_min', filterLabels.product_weight_min, '104px', { type: 'number' })}
            {renderFilterField('product_weight_max', filterLabels.product_weight_max, '104px', { type: 'number' })}
          </div>
        )}

        {activeFilterEntries.length > 0 && (
          <div className="rr-col-pills">
            <span className="rr-col-pills__text">{label('الفلاتر النشطة', 'Active filters')}</span>
            {activeFilterEntries.map((entry) => (
              <span key={entry.key} className="rr-col-pill">
                <strong>{entry.label}:</strong> {entry.value}
                <button
                  type="button"
                  className="rr-col-pill__clear"
                  onClick={() => {
                    const nextFilters = {
                      ...appliedFilters,
                      [entry.key]: entry.key === 'status' ? 'ALL' : '',
                    };
                    setFilters(nextFilters);
                    setAppliedFilters(nextFilters);
                  }}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : drafts.length === 0 ? (
        <EmptyState title={t('scale.noDraftsFound')} />
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{
            width: '100%',
            maxWidth: '100%',
            overflowX: 'auto',
            borderRadius: 'var(--radius-lg, 12px)',
            border: '1px solid var(--border, #d9e2ec)',
            bgcolor: 'var(--bg-elevated, #ffffff)',
            boxShadow: 'var(--shadow-sm, 0 4px 14px rgba(15, 23, 42, 0.06))',
          }}
        >
          <Table
            sx={{
              width: '100%',
              minWidth: 'var(--scale-drafts-min-width, 1200px)',
              tableLayout: 'auto',
              '& th': {
                fontFamily: 'var(--font-family, var(--font-body, system-ui, -apple-system, sans-serif))',
                fontWeight: 600,
                fontSize: '15px',
                lineHeight: 1.4,
                letterSpacing: 0,
                py: 1.5,
                px: { xs: 1, md: 1.25 },
                bgcolor: 'var(--bg-soft, #eef3f8)',
                borderBottom: '2px solid var(--border, #d9e2ec)',
                color: 'var(--text, #172033)',
                whiteSpace: 'var(--scale-drafts-white-space, nowrap)',
                verticalAlign: 'middle',
              },
              '& td': {
                py: 1.25,
                px: { xs: 1, md: 1.25 },
                fontSize: '0.85rem',
                color: 'var(--text, #172033)',
                borderBottom: '1px solid var(--border, #d9e2ec)',
                verticalAlign: 'middle',
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: '120px', textAlign: 'start' }}>
                  {t('scale.ticketNumber')}
                </TableCell>
                <TableCell sx={{ minWidth: '120px', textAlign: 'center' }}>
                  {label('التاريخ', 'Date')}
                </TableCell>
                <TableCell sx={{ minWidth: '130px', textAlign: 'start' }}>
                  {t('scale.vehicle')}
                </TableCell>
                <TableCell sx={{ minWidth: '150px', textAlign: 'start' }}>
                  {t('scale.driver')}
                </TableCell>
                <TableCell sx={{ minWidth: '220px', textAlign: 'start' }}>
                  {t('scale.supplier')}
                </TableCell>
                <TableCell sx={{ minWidth: '160px', textAlign: 'start' }}>
                  {t('scale.item')}
                </TableCell>
                <TableCell sx={{ minWidth: '120px', textAlign: 'end' }}>
                  {t('scale.grossWeight')}
                </TableCell>
                <TableCell sx={{ minWidth: '120px', textAlign: 'end' }}>
                  {t('scale.tareWeight')}
                </TableCell>
                <TableCell sx={{ minWidth: '120px', textAlign: 'end' }}>
                  {t('scale.netWeight')}
                </TableCell>
                <TableCell sx={{ minWidth: '130px', textAlign: 'center' }}>
                  {t('common.status') || 'Status'}
                </TableCell>
                <TableCell sx={{ minWidth: '90px', textAlign: 'center' }}>
                  {t('scale.actions') || 'Actions'}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {drafts.map((draft) => (
                <TableRow
                  key={draft.id}
                  hover
                  sx={{
                    '&:hover': {
                      bgcolor: 'var(--bg-soft, rgba(238, 243, 248, 0.5))',
                    },
                  }}
                >
                  <TableCell data-label={t('scale.ticketNumber')} sx={{ textAlign: 'start' }}>
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        px: 1,
                        py: 0.25,
                        borderRadius: 'var(--radius-sm, 6px)',
                        bgcolor: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.10))',
                        color: 'var(--primary, #2563eb)',
                        fontWeight: 800,
                        fontFamily: 'monospace',
                        fontSize: '0.82rem',
                        direction: 'ltr',
                        whiteSpace: 'var(--scale-drafts-white-space, nowrap)',
                        border: '1px solid var(--border-strong, rgba(37, 99, 235, 0.2))',
                      }}
                    >
                      #{draft.draft_number}
                    </Box>
                    {draft.shipping_manifest && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      {lang === 'ar' ? 'أمر البيع' : 'Sales order'}: <bdi>{draft.shipping_manifest.sales_order_number || '—'}</bdi>
                    </Typography>}
                  </TableCell>

                  <TableCell data-label={label('التاريخ', 'Date')} sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontSize: '0.84rem', color: 'var(--text, #172033)', whiteSpace: 'var(--scale-drafts-white-space, nowrap)', direction: 'ltr', fontVariantNumeric: 'tabular-nums' }}>
                      {formatDraftDate(draft.created_at)}
                    </Typography>
                  </TableCell>

                  <TableCell data-label={t('scale.vehicle')} sx={{ textAlign: 'start' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text, #172033)', whiteSpace: 'var(--scale-drafts-white-space, nowrap)' }}>
                      {draft.effective_vehicle_number || draft.vehicle_number || '-'}
                    </Typography>
                  </TableCell>

                  <TableCell data-label={t('scale.driver')} sx={{ textAlign: 'start' }}>
                    <Typography sx={{ fontSize: '0.84rem', color: 'var(--text, #172033)', whiteSpace: 'var(--scale-drafts-white-space, nowrap)' }}>
                      {draft.effective_driver_name || '-'}
                    </Typography>
                  </TableCell>

                  <TableCell data-label={t('scale.supplier')} sx={{ textAlign: 'start', verticalAlign: 'top' }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {draft.allocations?.length > 0 ? (
                        draft.allocations.map((alloc, idx) => (
                          <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography sx={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text, #172033)', minHeight: '20px', whiteSpace: 'var(--scale-drafts-white-space, nowrap)' }}>
                              {alloc.vendor_name || '-'}
                            </Typography>
                          </Box>
                        ))
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography sx={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text, #172033)', minHeight: '20px', whiteSpace: 'var(--scale-drafts-white-space, nowrap)' }}>
                            {draft.vendor_name || '-'}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </TableCell>

                  <TableCell data-label={t('scale.item')} sx={{ textAlign: 'start', verticalAlign: 'top' }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {draft.allocations?.length > 0 ? (
                        draft.allocations.map((alloc, idx) => (
                          <Typography key={idx} sx={{ fontSize: '0.84rem', color: 'var(--text, #172033)', minHeight: '20px', display: 'flex', alignItems: 'center', whiteSpace: 'var(--scale-drafts-white-space, nowrap)' }}>
                            {alloc.item_name || '-'}
                          </Typography>
                        ))
                      ) : (
                        <Typography sx={{ fontSize: '0.84rem', color: 'var(--text, #172033)', minHeight: '20px', display: 'flex', alignItems: 'center', whiteSpace: 'var(--scale-drafts-white-space, nowrap)' }}>
                          {draft.item_name || '-'}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>

                  <TableCell data-label={t('scale.grossWeight')} sx={{ textAlign: 'end' }}>
                    {formatWeight(draft.net_weight_loaded, false)}
                  </TableCell>

                  <TableCell data-label={t('scale.tareWeight')} sx={{ textAlign: 'end' }}>
                    {formatWeight(draft.net_weight_empty, false)}
                  </TableCell>

                  <TableCell data-label={t('scale.netWeight')} sx={{ textAlign: 'end' }}>
                    {formatWeight(draft.product_weight, true)}
                  </TableCell>

                  <TableCell data-label={t('common.status')} sx={{ textAlign: 'center' }}>
                    {getStatusChip(draft)}
                  </TableCell>

                  <TableCell data-label={t('scale.actions')} sx={{ textAlign: 'center' }}>
                    {draft.status === 'SECOND_WEIGHT_PENDING' ? (
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => navigate(`/scale/weighing?resume_draft=${draft.id}`)}
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          px: 1.25,
                          py: 0.35,
                          borderRadius: 'var(--radius-md, 8px)',
                          textTransform: 'none',
                          whiteSpace: 'var(--scale-drafts-white-space, nowrap)',
                          boxShadow: 'none',
                          bgcolor: 'var(--warning, #b7791f)',
                          color: '#ffffff',
                          '&:hover': {
                            filter: 'brightness(0.9)',
                            bgcolor: 'var(--warning, #b7791f)',
                          },
                        }}
                      >
                        {t('scale.resumeDraft')} {isAr ? '<-' : '->'}
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => navigate(`/scale/drafts/${draft.id}`)}
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          px: 1.25,
                          py: 0.35,
                          borderRadius: 'var(--radius-md, 8px)',
                          textTransform: 'none',
                          whiteSpace: 'var(--scale-drafts-white-space, nowrap)',
                          borderColor: 'var(--border-strong, #b8c7d8)',
                          color: 'var(--text, #172033)',
                          '&:hover': {
                            borderColor: 'var(--primary, #2563eb)',
                            color: 'var(--primary, #2563eb)',
                            bgcolor: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.10))',
                          },
                        }}
                      >
                        {t('common.open')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}


export default ScaleDraftsPage;
