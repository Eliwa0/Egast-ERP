import React, { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import '../styles/pages/receipt-review.css';
import '../styles/pages/quality-inspection.css';

const DEFECT_CATEGORIES = {
  pests: {
    titleKey: 'quality.catPests',
    titleDefault: 'الآفات الزراعية والعيوب الحشرية (Pests)',
    items: [
      { key: 'acarus', name: 'Acarus' },
      { key: 'scale_insect', name: 'Scale Insect' },
      { key: 'spray_marks', name: 'Spray Marks' },
      { key: 'citrus_rust', name: 'Citrus Rust' },
      { key: 'thrips', name: 'Thrips' },
      { key: 'vegetable_defects', name: 'Vegetable Defects' },
      { key: 'gummosis', name: 'Gummosis' },
      { key: 'oil_spots', name: 'Oil Spots' },
      { key: 'sunburn', name: 'Sunburn' },
      { key: 'sooty_mold', name: 'Sooty Mold' },
      { key: 'mealybug', name: 'Mealybug' },
    ],
  },
  mechanical: {
    titleKey: 'quality.catMechanical',
    titleDefault: 'العيوب الميكانيكية (Mechanical)',
    items: [
      { key: 'tearing', name: 'Tearing' },
      { key: 'high_cut', name: 'High Cut' },
      { key: 'bruises', name: 'Bruises' },
      { key: 'cuts', name: 'Cuts' },
    ],
  },
  others: {
    titleKey: 'quality.catOthers',
    titleDefault: 'عيوب فسيولوجية وتصنيف الجودة (Others)',
    items: [
      { key: 'under_size', name: 'Under Size' },
      { key: 'venting', name: 'Venting' },
      { key: 'fruit_fly', name: 'Fruit Fly' },
      { key: 'creasing', name: 'Creasing' },
      { key: 'fall_drop', name: 'Fall Drop' },
      { key: 'mutations', name: 'Mutations' },
      { key: 'navel_blight', name: 'Navel Blight' },
      { key: 'softness', name: 'Softness' },
      { key: 'molds', name: 'Molds' },
      { key: 'grade_1', name: 'Grade 1' },
      { key: 'grade_2', name: 'Grade 2' },
    ],
  },
};

const AF_KEYS = [
  'acarus', 'scale_insect', 'spray_marks', 'citrus_rust', 'thrips',
  'vegetable_defects', 'gummosis', 'sunburn', 'sooty_mold', 'mealybug', 'mutations'
];

const AG_KEYS = [
  'oil_spots', 'under_size', 'tearing', 'bruises', 'cuts', 'venting',
  'fruit_fly', 'creasing', 'fall_drop', 'navel_blight', 'softness', 'molds'
];

const STATUS_OPTIONS = [
  { key: 'PENDING_REVIEW', labelKey: 'quality.statusPendingReview' },
  { key: 'POSTED', labelKey: 'quality.statusPosted' },
  { key: 'REJECTED', labelKey: 'quality.statusRejected' },
  { key: 'FAILED', labelKey: 'quality.statusFailed' },
  { key: 'ALL', labelKey: 'quality.statusAll' },
];

const STATUS_LABELS = {
  PENDING_REVIEW: 'quality.statusPendingReview',
  POSTED: 'quality.statusPosted',
  REJECTED: 'quality.statusRejected',
  FAILED: 'quality.statusFailed',
};

const fallbackText = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return '-';
  return value;
};

function StatusBadge({ status, t }) {
  const badgeCls = status === 'PENDING_REVIEW' ? 'PENDING' : status;
  return (
    <span className={`rr-status-badge rr-status-badge--${badgeCls || 'FAILED'}`}>
      {STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : fallbackText(status)}
    </span>
  );
}

function QualityReviewPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();

  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const adminUser = user?.role === 'admin' || user?.is_staff || user?.is_superuser;

  const pendingCount = useMemo(
    () => inspections.filter((inspection) => inspection.status === 'PENDING_REVIEW').length,
    [inspections],
  );
  const failedCount = useMemo(
    () => inspections.filter((inspection) => inspection.status === 'FAILED').length,
    [inspections],
  );
  const postedCount = useMemo(
    () => inspections.filter((inspection) => inspection.status === 'POSTED').length,
    [inspections],
  );

  // Load Inspections
  const loadInspections = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: statusFilter };
      if (search.trim()) params.search = search.trim();
      const res = await API.get('/quality/inspections/', { params });
      if (res.data.success) {
        setInspections(res.data.data.inspections || []);
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quality.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, toast, t]);

  useEffect(() => {
    loadInspections();
  }, [loadInspections]);

  // Load Warehouses
  useEffect(() => {
    API.get('/warehouses/')
      .then((res) => {
        const list = res.data?.warehouses || res.data?.data?.warehouses || [];
        setWarehouses(Array.isArray(list) ? list : []);
      })
      .catch((err) => console.error('Failed to load warehouses', err));
  }, []);

  // Approve & Post
  const handleApprove = async (id) => {
    if (!window.confirm(t('quality.approveConfirm'))) return;
    setIsActioning(true);
    try {
      const payload = {};
      if (selectedWarehouse) {
        payload.target_warehouse = selectedWarehouse;
      }
      const res = await API.post(`/quality/inspections/${id}/approve/`, payload);
      if (res.data.success) {
        toast.success(t('quality.approveSuccess'));
        setSelectedInspection(null);
        loadInspections();
      } else {
        toast.error(res.data.error || t('quality.approveFailed'));
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || t('quality.approveError'));
    } finally {
      setIsActioning(false);
    }
  };

  // Reject
  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.warning(t('quality.rejectReasonRequired'));
      return;
    }
    setIsActioning(true);
    try {
      const res = await API.post(`/quality/inspections/${selectedInspection.id}/reject/`, {
        reason: rejectReason,
      });
      if (res.data.success) {
        toast.success(t('quality.rejectSuccess'));
        setShowRejectModal(false);
        setRejectReason('');
        setSelectedInspection(null);
        loadInspections();
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quality.rejectFailed'));
    } finally {
      setIsActioning(false);
    }
  };

  // Delete
  const handleDelete = async (id) => {
    if (!window.confirm(t('quality.deleteConfirm'))) return;
    setIsActioning(true);
    try {
      const res = await API.post(`/quality/inspections/${id}/delete/`);
      if (res.data.success) {
        toast.success(t('quality.deleteSuccess'));
        setSelectedInspection(null);
        loadInspections();
      }
    } catch (err) {
      console.error(err);
      toast.error(t('quality.deleteFailed'));
    } finally {
      setIsActioning(false);
    }
  };

  return (
    <div className="rr-page-shell qrev-page">
      <div className="rr-page-col">
        <header className="rr-page-header">
          <div>
            <span className="rr-page-header__kicker">{t('quality.headerKicker')}</span>
            <h1 className="rr-page-header__title">{t('quality.reviewDashboardTitle')}</h1>
          </div>
          <button
            type="button"
            className="app-button app-button--secondary rr-header-first-btn"
            onClick={loadInspections}
            disabled={loading}
          >
            {loading ? t('quality.refreshing') : t('quality.refresh')}
          </button>
        </header>

        <div className="rr-stats-row">
          {[
            { label: t('quality.statusPendingReview'), value: pendingCount, color: 'var(--warning)' },
            { label: t('quality.statusFailed'), value: failedCount, color: 'var(--danger)' },
            { label: t('quality.statusPosted'), value: postedCount, color: 'var(--success)' },
            { label: t('quality.totalReports'), value: inspections.length, color: 'var(--text)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rr-stat-chip">
              <span className="rr-stat-chip__value" style={{ color }}>{value}</span>
              <span className="rr-stat-chip__label">{label}</span>
            </div>
          ))}
        </div>

        {/* Filters & Search */}
        <div className="rr-filter-bar">
          <label>
            <span className="rr-filter-label">{t('quality.filterStatus')}</span>
            <select
              className="app-select rr-filter-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{t(option.labelKey)}</option>
              ))}
            </select>
          </label>

          <label className="tr-search-field">
            <span className="rr-filter-label">{t('common.search')}</span>
            <input
              type="text"
              className="app-input rr-filter-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('quality.searchPlaceholder')}
            />
          </label>

          <button
            type="button"
            className="app-button app-button--secondary rr-filter-clear-btn"
            onClick={() => {
              setStatusFilter('PENDING_REVIEW');
              setSearch('');
            }}
          >
            {t('common.clear')}
          </button>
        </div>

        {/* Main Inspections List Grid */}
        {loading ? (
          <div className="rr-grid-loading">{t('quality.loadingReports')}</div>
        ) : inspections.length === 0 ? (
          <div className="rr-grid-empty">{t('quality.noReports')}</div>
        ) : (
          <div className="rr-grid-wrap">
            <div className="rr-grid-scroll qrev-grid-scroll">
              <table className="qrev-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center' }}>{t('quality.colInspectionId')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colBatch')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colProduct')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colDate')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colInspector')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colDecision')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colStatus')}</th>
                    <th style={{ textAlign: 'center' }}>{t('quality.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.map((ins) => (
                    <tr key={ins.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedInspection(ins)}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>#{ins.id}</td>
                      <td style={{ textAlign: 'center' }}>{ins.batch_number}</td>
                      <td style={{ textAlign: 'center' }}>{ins.item_name || ins.item_code || '—'}</td>
                      <td style={{ textAlign: 'center' }}>{ins.inspection_date}</td>
                      <td style={{ textAlign: 'center' }}>{ins.inspector_name}</td>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: ins.decision.includes('Rejected') ? 'var(--color-danger)' : ins.decision.includes('Conditional') ? 'var(--color-warning)' : 'var(--color-success)' }}>
                        {ins.decision}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <StatusBadge status={ins.status} t={t} />
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="app-button app-button--secondary app-button--compact"
                          onClick={() => setSelectedInspection(ins)}
                        >
                          {t('common.open')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Inspection Detail Modal */}
      {selectedInspection && (
        <>
          <div className="rr-dialog-backdrop" onClick={() => { setSelectedInspection(null); setSelectedWarehouse(''); }} style={{ zIndex: 100 }} />
          <div className="rr-dialog rr-dialog--wide" style={{ zIndex: 101, width: '90%', maxWidth: '1000px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="rr-dialog__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('quality.title')} — #{selectedInspection.id}</span>
              <button
                type="button"
                className="app-button app-button--secondary app-button--compact"
                onClick={() => {
                  setSelectedInspection(null);
                  setSelectedWarehouse('');
                }}
              >
                {t('common.close')}
              </button>
            </div>

            {/* Metadata info */}
            <div className="quality-form-grid" style={{ marginBottom: '20px' }}>
              <div className="form-field">
                <label>{t('quality.batchNumber')}</label>
                <input className="app-input" type="text" value={selectedInspection.batch_number} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.productName')}</label>
                <input className="app-input" type="text" value={selectedInspection.item_name || selectedInspection.item_code} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.inspectionDate')}</label>
                <input className="app-input" type="text" value={selectedInspection.inspection_date} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.inspectorName')}</label>
                <input className="app-input" type="text" value={selectedInspection.inspector_name} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.supplierName')}</label>
                <input className="app-input" type="text" value={selectedInspection.supplier_name || '—'} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.farmOrigin')}</label>
                <input className="app-input" type="text" value={selectedInspection.farm_origin || '—'} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.contractorName')}</label>
                <input className="app-input" type="text" value={selectedInspection.contractor_name || '—'} disabled />
              </div>
              <div className="form-field">
                <label>{t('quality.carNumber')}</label>
                <input className="app-input" type="text" value={selectedInspection.car_number || '—'} disabled />
              </div>
            </div>

            {/* Excel Matrix Detail */}
            <h4 style={{ fontSize: '1rem', fontWeight: 800, margin: '20px 0 10px 0' }}>{t('quality.excelMatrix')}</h4>
            <div className="excel-matrix-wrapper">
              <table className="excel-matrix-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>{t('quality.defectCodeCategory')}</th>
                    {Array.from({ length: selectedInspection.sample_size }).map((_, idx) => (
                      <th key={idx}>S{idx + 1}</th>
                    ))}
                    <th>{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(DEFECT_CATEGORIES).map(([catKey, cat]) => (
                    <React.Fragment key={catKey}>
                      <tr style={{ background: 'var(--color-surface-muted)' }}>
                        <td colSpan={selectedInspection.sample_size + 2} style={{ textAlign: 'start', fontWeight: 800 }}>
                          {t(cat.titleKey)}
                        </td>
                      </tr>
                      {cat.items.map((item) => {
                        const total = selectedInspection.samples_data.reduce((sum, sample) => {
                          const val = sample.defects?.[item.key] || 0;
                          return sum + val;
                        }, 0);

                        return (
                          <tr key={item.key}>
                            <td className="defect-row-header">{t('quality.defects.' + item.key) || item.name}</td>
                            {selectedInspection.samples_data.map((sample, idx) => (
                              <td key={idx}>{sample.defects?.[item.key] || 0}</td>
                            ))}
                            <td style={{ fontWeight: 'bold' }}>{total}</td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}

                  {/* Calculations summary */}
                  <tr className="totals-row">
                    <td className="defect-row-header">{t('quality.wasteTotal')}</td>
                    {selectedInspection.samples_data.map((sample, idx) => {
                      const sumS = AF_KEYS.reduce((acc, k) => acc + (sample.defects?.[k] || 0), 0);
                      return <td key={idx}>{sumS}</td>;
                    })}
                    <td>{selectedInspection.af_waste_total}</td>
                  </tr>
                  <tr className="totals-row">
                    <td className="defect-row-header">{t('quality.qualityTotal')}</td>
                    {selectedInspection.samples_data.map((sample, idx) => {
                      const sumS = AG_KEYS.reduce((acc, k) => acc + (sample.defects?.[k] || 0), 0);
                      return <td key={idx}>{sumS}</td>;
                    })}
                    <td>{selectedInspection.ag_quality_total}</td>
                  </tr>
                  <tr className="totals-row">
                    <td className="defect-row-header">{t('quality.grandTotal')}</td>
                    {selectedInspection.samples_data.map((sample, idx) => {
                      const sumS = Object.keys(sample.defects || {}).reduce((acc, k) => acc + (sample.defects[k] || 0), 0);
                      return <td key={idx}>{sumS}</td>;
                    })}
                    <td>{selectedInspection.ah_grand_total}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Percentages and Decision Box */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div style={{ border: '1px solid var(--color-border)', padding: '12px', borderRadius: '4px' }}>
                <div>{t('quality.averageDefects')}: <strong>{selectedInspection.average_defects_per_sample}</strong></div>
                <div>{t('quality.pctBruisesCuts')}: <strong>{selectedInspection.combined_bruises_cuts_percentage}%</strong></div>
                <div>{t('quality.pctHighCut')}: <strong>{selectedInspection.high_cut_percentage}%</strong></div>
              </div>
              <div style={{ border: '1px solid var(--color-border)', padding: '12px', borderRadius: '4px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div>{t('quality.qaDecision')}:</div>
                <strong style={{ fontSize: '1.2rem', color: selectedInspection.decision.includes('Rejected') ? 'var(--color-danger)' : 'var(--color-success)' }}>
                  {selectedInspection.decision}
                </strong>
              </div>
            </div>

            {selectedInspection.notes && (
              <div className="notes-report-box" style={{ marginBottom: '20px' }}>
                <strong>{t('quality.additionalNotes')}:</strong>
                {selectedInspection.notes}
              </div>
            )}

            {/* SAP errors */}
            {selectedInspection.status === 'FAILED' && selectedInspection.sap_error && (
              <div style={{ backgroundColor: 'var(--color-danger-soft)', borderInlineStart: '4px solid var(--color-danger)', padding: '12px', borderRadius: '4px', color: 'var(--color-danger)', marginBottom: '20px', fontSize: '0.85rem' }}>
                <strong>{t('common.error')}:</strong> {selectedInspection.sap_error}
              </div>
            )}

            {/* Rejection comments */}
            {selectedInspection.status === 'REJECTED' && selectedInspection.rejection_reason && (
              <div style={{ backgroundColor: 'var(--color-surface-muted)', borderInlineStart: '4px solid var(--color-text-muted)', padding: '12px', borderRadius: '4px', color: 'var(--color-text)', marginBottom: '20px', fontSize: '0.85rem' }}>
                <strong>{t('quality.rejectionReason')}:</strong> {selectedInspection.rejection_reason}
              </div>
            )}

            {/* Review actions for PENDING or FAILED status */}
            {adminUser && (selectedInspection.status === 'PENDING_REVIEW' || selectedInspection.status === 'FAILED') && (
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px', marginTop: '20px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: '12px' }}>{t('common.admin')}</h4>
                
                {/* Warehouse release option */}
                <div className="form-field" style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '0.85rem' }}>
                    Release Target Warehouse (Optional — performs Stock Transfer in SAP, otherwise updates Status in OBTN details)
                  </label>
                  <select
                    className="app-input"
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    disabled={isActioning}
                  >
                    <option value="">-- Maintain current warehouse & release --</option>
                    {warehouses.map((wh) => (
                      <option key={wh.WarehouseCode || wh.code} value={wh.WarehouseCode || wh.code}>
                        {wh.WarehouseCode || wh.code} - {wh.WarehouseName || wh.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="app-button app-button--danger"
                    onClick={() => setShowRejectModal(true)}
                    disabled={isActioning}
                  >
                    {t('quality.rejected')}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--danger-outline"
                    onClick={() => handleDelete(selectedInspection.id)}
                    disabled={isActioning}
                  >
                    {t('common.delete')}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--success"
                    onClick={() => handleApprove(selectedInspection.id)}
                    disabled={isActioning}
                  >
                    {t('quality.postToSap')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <>
          <div className="rr-dialog-backdrop" onClick={() => { setShowRejectModal(false); setRejectReason(''); }} style={{ zIndex: 110 }} />
          <div className="rr-dialog" style={{ zIndex: 111, width: '90%', maxWidth: '500px' }}>
            <h3 className="rr-dialog__title">
              {t('quality.rejectTitle')} #{selectedInspection?.id}
            </h3>
            <div className="form-field" style={{ marginBottom: '20px' }}>
              <label>{t('quality.rejectReason')} <span className="required">*</span></label>
              <textarea
                rows={3}
                className="app-input"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('quality.rejectPlaceholder')}
                disabled={isActioning}
              />
            </div>
            <div className="rr-dialog__actions">
              <button
                type="button"
                className="app-button app-button--secondary rr-dialog__btn-cancel"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                disabled={isActioning}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="app-button app-button--danger rr-dialog__btn-confirm"
                onClick={handleReject}
                disabled={isActioning}
              >
                {isActioning ? t('quality.rejecting') : t('quality.confirmReject')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default QualityReviewPage;
