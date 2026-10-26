import SearchableSelect from '../ui/SearchableSelect';
import RemoteAutocomplete from '../ui/RemoteAutocomplete';
import { farmSearch, contractorSearch as contractorSource, itemSearch } from '../../services/masterDataSearch';
import { ViewActionButton, PrintActionButton } from '../ui/ActionIconButton';
import AppSpinner from '../ui/AppSpinner';
import React from 'react';
import { calculateQualityMetrics } from '../../utils/qualityCalculations';
import {
  Autocomplete,
  Button,
  CircularProgress,
  TextField,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PrintIcon from '@mui/icons-material/Print';
import {
  CompleteStep,
  FarmStep,
  InspectionStep,
  OperationStep,
  ReviewStep,
  SamplesStep,
  VehicleStep,
} from './QualityWizardSteps';
import { openPrintDocument } from '../../utils/printDocument';
import QualityPrintHeader from '../print/QualityPrintHeader';
import { SCALE_RECEIVING_STEPS } from '../../config/qualityWorkflowSteps';
import { getProductIcon } from '../../utils/productIcon';
import '../../styles/pages/quality-inspection.css';

// 26 defects configurations (exact matches with backend/excel)
const DEFECT_CATEGORIES = {
  pests: {
    titleKey: 'quality.catPests',
    titleDefault: 'الآفات الزراعية والعيوب الحشرية (Pests)',
    class: 'pests',

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
    class: 'mechanical',

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
    class: 'others',

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
    ],
  },
  grades: {
    titleKey: 'quality.catGrades',
    titleDefault: 'Quality Grades',
    class: 'others',
    items: [
      { key: 'grade_1', name: 'Grade 1' },
      { key: 'grade_2', name: 'Grade 2' },
    ],
  },
};

const DEFECT_CATEGORY_META = {
  pests: { icon: '🪲', labelKey: 'quality.tabPests', fallback: 'Pests' },
  mechanical: { icon: '🔧', labelKey: 'quality.tabMechanical', fallback: 'Mechanical' },
  others: { icon: '🧪', labelKey: 'quality.tabPhysiological', fallback: 'Physiological' },
};

import ExcelSummaryMatrix from '../ExcelSummaryMatrix';

function FarmVendorSelector({
  id,
  name,
  value,
  hiddenValue,
  vendors,
  loading,
  error,
  search,
  searchPlaceholder,
  ariaLabel = 'Vendor selection',
  loadingLabel = 'Loading vendors...',
  emptyLabel = 'No vendors found',
  errorLabel = 'Unable to load vendors',
  retryLabel = 'Retry',
  pinnedLabel = 'Selected',
  onRetry,
  onSearchChange,
  onSelect,
  searchSource,
  onResults,
}) {
  const selectedVendor = vendors.find((vendor) => vendor.code === value) || null;
  const query = search.trim().toLocaleLowerCase();
  const matches = query
    ? vendors.filter((vendor) => vendor.code.toLocaleLowerCase().includes(query) || vendor.name.toLocaleLowerCase().includes(query))
    : vendors;
  const visibleVendors = selectedVendor && !matches.some((vendor) => vendor.code === selectedVendor.code)
    ? [selectedVendor, ...matches]
    : matches;

  if (searchSource) return <div className="quality-vendor-selector">
    <SearchableSelect id={id} label={ariaLabel} options={[]} value={value}
      searchSource={searchSource} placeholder={searchPlaceholder} onSearchResults={onResults}
      selectedOptions={selectedVendor ? [{ value, label: `${value} - ${selectedVendor.name}` }] : []}
      onSelectOption={(option) => onSelect(option?.value || '', option?.raw
        ? { ...option.raw, code: option.value, name: option.raw.farmName || option.raw.contractorName || option.value }
        : { code: '', name: '' })} />
    <input type="hidden" name={name} value={hiddenValue ?? value ?? ''} readOnly />
  </div>;
  return (
    <div className="quality-vendor-selector">
      <div className="quality-vendor-search">
        <span className="quality-vendor-search__icon" aria-hidden="true">⌕</span>
        <input id={id} type="search" className="app-input quality-vendor-search__input" value={search}
          onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder}
          autoComplete="off" disabled={loading || Boolean(error)} />
      </div>
      <div className="quality-vendor-grid" role="radiogroup" aria-label={ariaLabel}>
        {loading ? (
          <div className="quality-vendor-state quality-vendor-state--loading">
            <CircularProgress size={22} />
            <span>{loadingLabel}</span>
          </div>
        ) : error ? (
          <div className="quality-vendor-state quality-vendor-state--error">
            <span>{errorLabel}</span>
            {onRetry && (
              <Button type="button" variant="outlined" size="small" onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
          </div>
        ) : visibleVendors.length === 0 ? (
          <div className="quality-vendor-state">{emptyLabel}</div>
        ) : visibleVendors.map((vendor) => {
          const isSelected = vendor.code === value;
          const isPinned = isSelected && query && !matches.some((item) => item.code === vendor.code);
          const hasDistinctCode = vendor.code && vendor.code !== vendor.name;
          return (
            <button type="button" key={vendor.code}
              className={`quality-vendor-card${isSelected ? ' quality-vendor-card--selected' : ''}`}
              role="radio" aria-checked={isSelected} onClick={() => onSelect(vendor.code, vendor)} disabled={loading}>
              <span className="quality-vendor-card__check" aria-hidden="true">✓</span>
              <strong className="quality-vendor-card__name">{vendor.name}</strong>
              {hasDistinctCode && <span className="quality-vendor-card__code">{vendor.code}</span>}
              {isPinned && <span className="quality-vendor-card__pinned">{pinnedLabel}</span>}
            </button>
          );
        })}
      </div>
      <input type="hidden" name={name} value={hiddenValue ?? value ?? ''} readOnly />
    </div>
  );
}

function FarmSelectionPanel({ children, className = '', style, header, ...selectorProps }) {
  const panelClassName = ['card-panel quality-wizard-card--wide quality-farm-step', className].filter(Boolean).join(' ');
  return (
    <FarmStep className={panelClassName} style={style}>
      {header}
      <FarmVendorSelector {...selectorProps} />
      {children}
    </FarmStep>
  );
}

function QualityStepIcon({ icon }) {
  return icon;
}

function QualityStepBar({ steps, phase, maxReachedPhase, onStepClick, t }) {
  const stepbarRef = React.useRef(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const activeStep = stepbarRef.current?.querySelector('.wizard-step--active');
    activeStep?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [phase]);

  return (
    <div className="receipt-wizard quality-receiving-stepper">
      <div className="wizard-stepbar-wrap" ref={stepbarRef} role="list" aria-label={t('quality.headerKicker')}>
      {steps.map(({ id, labelKey, icon }, i) => {
        const isDone = i < phase;
        const isActive = i === phase;
        const canClick = i <= maxReachedPhase;
        const cls = [
          'wizard-step',
          isDone ? 'wizard-step--done' : '',
          isActive ? 'wizard-step--active' : '',
          canClick ? 'wizard-step--clickable' : 'wizard-step--locked',
        ].filter(Boolean).join(' ');
        return (
          <React.Fragment key={id || labelKey}>
            <div
              className={cls}
              onClick={() => canClick && onStepClick(i)}
              title={!canClick ? t('wizard.unlockHint') : undefined}
              role="listitem"
              aria-current={isActive ? 'step' : undefined}
            >
              <div className="wizard-step__circle">
                {isDone ? '✓' : <QualityStepIcon icon={icon} />}
              </div>
              <span className="wizard-step__label">{t(labelKey)}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`wizard-connector${isDone ? ' wizard-connector--done' : ''}`} aria-hidden="true" />
            )}
          </React.Fragment>
        );
      })}
      </div>
    </div>
  );
}

function QualityWizardLayout({ steps, workflowConfig, workflowState, handlers }) {
  const {
    sessionTrucks, setSessionTrucks,
    pendingScaleDrafts,
    pendingScaleDraftsLoading,
    pendingScaleDraftsError,
    vendors, setVendors,
    vendorsLoading,
    vendorSelectorTruckId, setVendorSelectorTruckId,
    vendorSearch, setVendorSearch,
    contractors, setContractors,
    contractorsLoading,
    contractorsError,
    contractorSearch, setContractorSearch,
    activeTruckId, setActiveTruckId,
    setActiveBatchNum,
    setActiveBatchId,
    inspectingBatch, setInspectingBatch,
    setBatchDrafts,
    step, setStep,
    setMaxReachedStep,
    searchQuery, setSearchQuery,
    isSearching,
    isSubmitting,
    submittedData, setSubmittedData,
    sampleCount, setSampleCount,
    samples, setSamples,
    defectCategories,
    defectCategoriesLoading,
    errors, setErrors,
    metadata, setMetadata,
    itemGroups,
    selectedItemGroupCode, setSelectedItemGroupCode,
    selectedItemCode, setSelectedItemCode,
    batchItemGroupCodes, setBatchItemGroupCodes,
    itemsByGroup, setItemsByGroup,
    loadingItemGroups,
    isLoadingItems,
  } = workflowState;
  const {
    t,
    lang,
    toast,
    tx,
    loadContractors,
    selectItemGroup,
    goToStep,
    handleMainStepClick,
    handleAddNewTruckCard,
    handleUseScaleDraft,
    loadPendingScaleDrafts,
    handleStartInspectionForBatch,
    handleCancelInspection,
    handleViewReport,
    handleNextFromInfo,
    handleBatchSearch,
    handleDefectToggle,
    handleDefectChange,
    handleDefectInputChange,
    handleSubmitReport,
    calculatedMetrics,
    mostCommonDefect,
    qualityPhase,
    maxReachedPhase,
    stats,
  } = handlers;
  const [addBatchFormsOpen, setAddBatchFormsOpen] = React.useState({});
  const [farmGroupFilter, setFarmGroupFilter] = React.useState('all');
  const completionPrintSheetRef = React.useRef(null);
  const activeDefectCategories = React.useMemo(
    () => (workflowConfig.dynamicCriteria ? (defectCategories || {}) : DEFECT_CATEGORIES),
    [defectCategories, workflowConfig.dynamicCriteria]
  );
  const activeDefectCategoryKeys = React.useMemo(
    () => Object.keys(activeDefectCategories),
    [activeDefectCategories]
  );
  const [activeSampleCategoryKey, setActiveSampleCategoryKey] = React.useState('');
  const renderedDefectCategoryEntries = React.useMemo(() => {
    const activeCategory = activeDefectCategories[activeSampleCategoryKey];
    return activeCategory ? [[activeSampleCategoryKey, activeCategory]] : [];
  }, [activeDefectCategories, activeSampleCategoryKey]);

  React.useEffect(() => {
    if (!activeDefectCategoryKeys.length) {
      setActiveSampleCategoryKey('');
      return;
    }
    if (!activeDefectCategoryKeys.includes(activeSampleCategoryKey)) {
      setActiveSampleCategoryKey(activeDefectCategoryKeys[0]);
    }
  }, [activeDefectCategoryKeys, activeSampleCategoryKey]);

  const getCategoryTitle = (category) => {
    if (category?.titleAr || category?.titleEn) {
      return lang === 'ar'
        ? (category.titleAr || category.titleEn)
        : (category.titleEn || category.titleAr);
    }
    return tx(category.titleKey, category.titleDefault).split(' (')[0];
  };

  const getDefectDisplayName = React.useCallback((item) => {
    if (item?.nameAr || item?.nameEn) {
      return lang === 'ar'
        ? (item.nameAr || item.nameEn || item.name || item.key)
        : (item.nameEn || item.nameAr || item.name || item.key);
    }
    return tx('quality.defects.' + item.key, item.name);
  }, [lang, tx]);

  const defectDisplayNameByKey = React.useMemo(() => (
    Object.values(activeDefectCategories).reduce((names, category) => {
      (category.items || []).forEach((item) => {
        names[item.key] = getDefectDisplayName(item);
      });
      return names;
    }, {})
  ), [activeDefectCategories, getDefectDisplayName]);

  const getDefectDisplayNameByKey = (key) => (
    defectDisplayNameByKey[key] || tx('quality.defects.' + key, key)
  );

  const resetToNewVehicleInspection = () => {
    const newTruck = {
      id: Date.now() + Math.random(),
      truck_number: '',
      contractor_name: '',
      contractor_code: '',
      farm_origin: '',
      isNew: true,
      batches: [],
    };

    setSessionTrucks([newTruck]);
    setActiveTruckId(null);
    setVendorSelectorTruckId(null);
    setActiveBatchNum(null);
    setActiveBatchId(null);
    setInspectingBatch(false);
    setSubmittedData(null);
    setBatchDrafts({});
    setStep(0);
    setMaxReachedStep(0);
    setSearchQuery('');
    setVendorSearch('');
    setSampleCount(5);
    setSamples([]);
    setErrors({});
    setSelectedItemGroupCode('');
    setSelectedItemCode('');
    setBatchItemGroupCodes({});
    setMetadata({
      inspection_date: new Date().toISOString().split('T')[0],
      inspector_name: metadata.inspector_name || '',
      data_clerk_name: metadata.data_clerk_name || metadata.inspector_name || '',
      supplier_name: '',
      farm_origin: '',
      contractor_name: '',
      car_number: '',
      crop_name: '',
      raw_material_type: '',
      batch_number: '',
      notes: '',
      item_code: '',
      item_name: '',
      vendor_card_code: '',
      vendor_name: '',
      uom_code: '',
      uom_name: '',
      quantity: '',
      scale_draft_id: '',
    });
  };

  const returnToCurrentVehicleDetails = () => {
    setInspectingBatch(false);
    setSubmittedData(null);
    setVendorSelectorTruckId(null);
    setActiveBatchNum(null);
    setActiveBatchId(null);
    setStep(0);
    setMaxReachedStep(0);
  };

  const resolvedSteps = workflowConfig.id === 'receiving'
    ? SCALE_RECEIVING_STEPS
    : steps;

  return (
    <div className="page-shell quality-wizard" data-quality-workflow={workflowConfig.id}>
      {/* Background search lookup loader */}
      {isSearching && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999, color: '#fff'
        }}>
          <div style={{
            background: 'var(--color-bg)', padding: '24px 40px', borderRadius: '8px',
            color: 'var(--text)', border: '1px solid var(--border)', textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            <h3 style={{ margin: '0 0 8px 0' }}>{tx('quality.searchingBatchERP', 'Searching Batch in ERP...')}</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('common.pleaseWait')}</p>
          </div>
        </div>
      )}

      <QualityStepBar
        steps={resolvedSteps}
        phase={qualityPhase}
        maxReachedPhase={maxReachedPhase}
        onStepClick={handleMainStepClick}
        t={t}
      />
      <div className="quality-step-viewport">
      {/* Truck Management Master-Detail Dashboard View */}
      {!inspectingBatch && (
        activeTruckId === null ? (
          <VehicleStep>
          {/* TRUCK DASHBOARD VIEW */}
          <div style={{ display: 'grid', gap: '24px' }}>
            <header style={{ marginBottom: '4px' }}>
              <span className="section-kicker">{t('quality.headerKicker')}</span>
              <h1 className="page-title">🚛 {tx('quality.stepTrucks', 'Truck Management')}</h1>
              <p className="page-copy">{tx('quality.dashboardDesc', 'Manage incoming transport trucks and dynamically log batch quality reports.')}</p>
            </header>

            {/* Live Status Counters */}
            <div className="rr-stats-row">
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value" style={{ color: 'var(--color-primary)' }}>{stats.totalTrucks}</span>
                <span className="rr-stat-chip__label">{tx('quality.totalTrucksLabel', 'Total Trucks')}</span>
              </div>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value" style={{ color: 'var(--text)' }}>{stats.totalBatches}</span>
                <span className="rr-stat-chip__label">{tx('quality.totalBatchesLabel', 'Total Batches')}</span>
              </div>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value" style={{ color: 'var(--success)' }}>{stats.completed}</span>
                <span className="rr-stat-chip__label">{tx('quality.completedInspections', 'Completed')}</span>
              </div>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value" style={{ color: 'var(--warning)' }}>{stats.remaining}</span>
                <span className="rr-stat-chip__label">{tx('quality.remainingInspections', 'Remaining')}</span>
              </div>
            </div>

            {workflowConfig.id === 'receiving' && (
              <section className="card-panel" style={{ display: 'grid', gap: '14px', padding: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{tx('quality.scalePendingDrafts', 'Scale drafts ready for receiving')}</h2>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {tx('quality.scalePendingDraftsDesc', 'Closed scale drafts can be started here with vehicle, supplier, item, and product weight prefilled.')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="app-button app-button--secondary app-button--compact"
                    onClick={() => loadPendingScaleDrafts()}
                    disabled={pendingScaleDraftsLoading}
                  >
                    {pendingScaleDraftsLoading ? t('common.loading') : t('common.refresh')}
                  </button>
                </div>
                {pendingScaleDraftsError ? (
                  <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{pendingScaleDraftsError}</div>
                ) : pendingScaleDraftsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                    <CircularProgress size={20} />
                    <span>{t('common.loading')}</span>
                  </div>
                ) : pendingScaleDrafts.filter((draft) => !draft.has_existing_inspections).length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {tx('quality.noPendingScaleDrafts', 'No closed scale drafts are waiting for receiving.')}
                  </p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '12px' }}>
                    {pendingScaleDrafts.filter((draft) => !draft.has_existing_inspections).map((draft) => {
                      const fields = [
                        {
                          label: tx('quality.scaleDraftNumber', 'Scale draft number'),
                          value: draft.draft_number || `#${draft.scale_draft_id}`,
                          icon: '🔢',
                        },
                        {
                          label: tx('quality.scaleVehicleTruck', 'Vehicle / Truck'),
                          value: draft.vehicle_number || '-',
                          icon: '🚚',
                        },
                        {
                          label: tx('quality.scaleSupplier', 'Supplier'),
                          value: draft.vendor_name || draft.vendor_card_code || '-',
                          icon: '🏢',
                        },
                        {
                          label: tx('quality.scaleItem', 'Item'),
                          value: draft.item_name || draft.item_code || '-',
                          icon: getProductIcon(draft.item_name || draft.item_code),
                        },
                        {
                          label: tx('quality.scaleWeight', 'Weight'),
                          value: `${Number(draft.product_weight || 0).toLocaleString()} ${tx('quality.kgUnit', 'kg')}`,
                          icon: '⚖️',
                        },
                      ];

                      return (
                        <button
                          type="button"
                          key={draft.scale_draft_id}
                          className="card-panel"
                          style={{
                            textAlign: lang === 'ar' ? 'right' : 'left',
                            direction: lang === 'ar' ? 'rtl' : 'ltr',
                            padding: '14px',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            background: 'var(--color-bg)',
                            color: 'var(--text)',
                            cursor: 'pointer',
                            display: 'grid',
                            gridTemplateColumns: '1fr',
                            gap: '14px',
                          }}
                          onClick={() => handleUseScaleDraft(draft)}
                        >
                          {fields.map((field) => (
                            <span key={field.label} style={{ display: 'grid', gap: '3px', minWidth: 0 }}>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                {field.icon && <span className="meta-label-icon" aria-hidden="true">{field.icon}</span>}
                                {field.label}
                              </span>
                              <span style={{ fontWeight: 800, overflowWrap: 'anywhere' }}>
                                {field.value}
                              </span>
                            </span>
                          ))}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Truck Cards Master Grid */}
            {sessionTrucks.length === 0 ? (
              <div className="card-panel" style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
                <p style={{ margin: 0 }}>{tx('quality.noActiveTrucks', 'No active trucks in this session. Click "+ Add Truck" below to start.')}</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))', gap: '20px' }}>
                {sessionTrucks.map((truck) => {
                  const totalB = truck.batches.length;
                  const compB = truck.batches.filter((b) => b.status === 'Completed').length;
                  const progressPct = totalB > 0 ? (compB / totalB) * 100 : 0;
                  const isEditing = truck.isNew || truck.isEditing;
                  const selectedVendor = vendors.find((vendor) => vendor.code === truck.farm_origin) || null;
                  const hasSelectedVendor = Boolean(truck.farm_origin);
                  const isVendorSelectorOpen = vendorSelectorTruckId === truck.id;
                  const hasLeftVendorCard = false;
                  const normalizedVendorSearch = vendorSearch.trim().toLocaleLowerCase();
                  const visibleVendors = normalizedVendorSearch
                    ? vendors.filter((vendor) => vendor.code.toLocaleLowerCase().includes(normalizedVendorSearch) || vendor.name.toLocaleLowerCase().includes(normalizedVendorSearch))
                    : vendors;
                  return (
                    <div key={truck.id} style={{ gridColumn: '1 / -1', width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: hasLeftVendorCard ? '20px' : 0 }}>
                        <div
                          className="card-panel"
                          aria-hidden={!hasSelectedVendor}
                          style={{
                            width: hasLeftVendorCard ? '360px' : 0,
                            maxWidth: hasLeftVendorCard ? '360px' : 0,
                            minHeight: '260px',
                            padding: hasLeftVendorCard ? '16px' : 0,
                            border: hasLeftVendorCard ? '1px solid var(--color-border)' : 0,
                            borderRadius: '8px',
                            boxShadow: hasLeftVendorCard ? 'var(--shadow-sm)' : 'none',
                            opacity: hasLeftVendorCard ? 1 : 0,
                            transform: hasLeftVendorCard ? 'translateX(0)' : 'translateX(-18px)',
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                            pointerEvents: hasLeftVendorCard ? 'auto' : 'none',
                            transition: 'width 280ms ease, max-width 280ms ease, padding 280ms ease, opacity 280ms ease, transform 280ms ease, border 280ms ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px',
                          }}
                        >
                          {isVendorSelectorOpen ? (
                            <>
                              <strong style={{ fontSize: '1.05rem', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                                Select Vendor
                              </strong>
                              <TextField
                                value={vendorSearch}
                                onChange={(event) => setVendorSearch(event.target.value)}
                                placeholder={tx('quality.farmSearchPlaceholder', 'Search by farm name or code')}
                                fullWidth
                                autoFocus
                                size="small"
                              />
                              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignContent: 'start', gap: '6px' }}>
                                {vendorsLoading ? (
                                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', padding: '24px' }}><CircularProgress size={26} /></div>
                                ) : visibleVendors.length === 0 ? (
                                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No vendors found</div>
                                ) : visibleVendors.map((vendor) => (
                                  <button
                                    type="button"
                                    key={vendor.code}
                                    onClick={() => {
                                      setSessionTrucks((prev) => prev.map((item) => item.id === truck.id ? { ...item, farm_origin: vendor.code } : item));
                                      setVendorSelectorTruckId(null);
                                      setVendorSearch('');
                                    }}
                                    style={{ padding: '8px', border: `2px solid ${vendor.code === truck.farm_origin ? 'var(--color-primary)' : 'var(--border)'}`, borderRadius: '8px', background: vendor.code === truck.farm_origin ? 'var(--bg-soft)' : 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', display: 'grid', gap: '3px' }}
                                  >
                                    <strong style={{ fontSize: '0.85rem' }}>{vendor.name}</strong>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{vendor.code}</span>
                                  </button>
                                ))}
                              </div>
                              {truck.farm_origin && (
                                <button type="button" className="app-button app-button--secondary app-button--compact" onClick={() => {
                                  setSessionTrucks((prev) => prev.map((item) => item.id === truck.id ? { ...item, farm_origin: '' } : item));
                                  setVendorSelectorTruckId(null);
                                  setVendorSearch('');
                                }}>Clear vendor</button>
                              )}
                            </>
                          ) : hasSelectedVendor ? (
                            <>
                              <strong style={{ fontSize: '1.05rem', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                                Vendor Information
                              </strong>
                              <div style={{ display: 'grid', gap: '12px' }}>
                                <div>
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Vendor Name</span>
                                  <strong style={{ display: 'block', marginTop: '3px' }}>{selectedVendor?.name || truck.farm_origin}</strong>
                                </div>
                                <div>
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Vendor Code</span>
                                  <strong style={{ display: 'block', marginTop: '3px' }}>{selectedVendor?.code || truck.farm_origin}</strong>
                                </div>
                              </div>
                            </>
                          ) : null}
                        </div>
                    <div
                      className="card-panel"
                      style={{
                        width: isEditing ? 'min(1040px, 100%)' : '360px',
                        maxWidth: '100%',
                        border: '1px solid var(--color-border)',
                        boxShadow: 'var(--shadow-sm)',
                        padding: '16px',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        minHeight: '260px',
                        transition: 'transform 280ms ease, box-shadow 0.2s ease',
                        transform: hasLeftVendorCard ? 'translateX(4px)' : 'translateX(0)'
                      }}
                    >
                      {isEditing ? (
                        /* Inline editable truck card */
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const truckNum = e.target.elements.truckNum.value.trim();
                            const contractor = e.target.elements.contractor.value.trim();
                            const contractorCode = e.target.elements.contractorCode.value.trim();

                            if (!truckNum) {
                              toast.warning(t('quality.truckNumberRequired'));
                              return;
                            }

                            setSessionTrucks((prev) =>
                              prev.map((t) =>
                                t.id === truck.id
                                  ? { ...t, truck_number: truckNum, contractor_name: contractor, contractor_code: contractorCode, isNew: false, isEditing: false }
                                  : t
                              )
                            );
                          }}
                        >
                          <div className="quality-vehicle-edit-header">
                            <div className="quality-vehicle-edit-header__title">
                              <span className="quality-vehicle-edit-header__icon" aria-hidden="true">🚛</span>
                              <strong>{truck.isNew ? t('quality.newTruck') : t('quality.editTruck')}</strong>
                            </div>
                            <div className="quality-vehicle-edit-header__actions">
                              <button type="submit" className="app-button app-button--primary app-button--compact quality-vehicle-edit-header__save" title={t('common.save')}>
                                <span aria-hidden="true">✓</span>
                                <span>{t('common.save')}</span>
                              </button>
                              <button
                                type="button"
                                className="quality-vehicle-edit-header__close"
                                title={t('common.cancel')}
                                aria-label={t('common.cancel')}
                                onClick={() => {
                                  if (truck.isNew) {
                                    setSessionTrucks((prev) => prev.filter((t) => t.id !== truck.id));
                                  } else {
                                    setSessionTrucks((prev) => prev.map((t) => (t.id === truck.id ? { ...t, isEditing: false } : t)));
                                  }
                                }}
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <div className="form-field" style={{ marginBottom: 0 }}>
                              <label htmlFor={`truckNum-${truck.id}`} style={{ fontSize: '0.8rem' }}>{t('quality.truckNumber')} *</label>
                              <input id={`truckNum-${truck.id}`} name="truckNum" type="text" className="app-input" defaultValue={truck.truck_number} required placeholder="e.g. 76348" autoFocus />
                            </div>
                            <FarmSelectionPanel
                              id={`contractor-${truck.id}`}
                              name="contractor"
                              searchSource={contractorSource}
                              onResults={(rows) => setContractors((previous) => [...new Map([...previous, ...rows.map((row) => ({ ...row, code: row.contractorCode, name: row.contractorName }))].map((row) => [row.code, row])).values()])}
                              value={truck.contractor_code || ''}
                              hiddenValue={truck.contractor_name || ''}
                              vendors={contractors}
                              loading={contractorsLoading}
                              error={contractorsError}
                              search={contractorSearch}
                              searchPlaceholder={tx('quality.contractorSearchPlaceholder', 'Search by contractor name or code')}
                              loadingLabel={tx('quality.contractorsLoading', 'Loading contractors...')}
                              emptyLabel={tx('quality.contractorsEmpty', 'No contractors available')}
                              errorLabel={tx('quality.contractorsLoadFailed', 'Unable to load contractors')}
                              retryLabel={t('common.retry')}
                              ariaLabel={t('quality.contractor')}
                              onRetry={() => loadContractors({ force: true })}
                              onSearchChange={setContractorSearch}
                              onSelect={(contractorCode, contractorVendor) => setSessionTrucks((prev) => prev.map((item) => (
                                item.id === truck.id ? { ...item, contractor_code: contractorCode, contractor_name: contractorVendor.name } : item
                              )))}
                              style={{ marginBottom: 0 }}
                              header={<label htmlFor={`contractor-${truck.id}`} style={{ fontSize: '0.8rem' }}>{t('quality.contractor')}</label>}
                            >
                              <input type="hidden" name="contractorCode" value={truck.contractor_code || ''} readOnly />
                            </FarmSelectionPanel>
                          </div>
                        </form>
                      ) : (
                        /* Saved Static Truck Card View (Dashboard) */
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                            <strong style={{ fontSize: '1.15rem' }}>🚛 {truck.truck_number}</strong>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: 0 }}
                                title={t('quality.editTruckDetails')}
                                onClick={() => setSessionTrucks((prev) => prev.map((t) => (t.id === truck.id ? { ...t, isEditing: true } : t)))}
                              >
                                ✏
                              </button>
                              <button
                                type="button"
                                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: 0 }}
                                title={t('quality.deleteTruckCard')}
                                onClick={() => {
                                  if (window.confirm(t('quality.confirmRemoveTruck'))) {
                                    setSessionTrucks((prev) => prev.filter((t) => t.id !== truck.id));
                                  }
                                }}
                              >
                                🗑
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gap: '6px', fontSize: '0.85rem' }}>
                            <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.contractor')}:</span> <strong>{truck.contractor_name || '-'}</strong></div>
                          </div>

                          {/* Visual Progress Bar */}
                          <div style={{ display: 'grid', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              <span>{compB} / {totalB} {tx('quality.batchesProgress', 'batches completed')}</span>
                              <span>{progressPct.toFixed(0)}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${progressPct}%`, height: '100%', backgroundColor: progressPct === 100 ? 'var(--success)' : 'var(--color-primary)', transition: 'width 0.3s ease' }} />
                            </div>
                          </div>

                          <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                            <button
                              type="button"
                              className="app-button app-button--primary"
                              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                              onClick={() => {
                                setActiveTruckId(truck.id);
                                setVendorSelectorTruckId(truck.id);
                                setVendorSearch('');
                              }}
                            >
                              {t('common.next')} - {t('quality.stepFarm')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {workflowConfig.id !== 'receiving' && (
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={handleAddNewTruckCard}
                >
                  ➕ {tx('quality.addTruck', 'Add Truck')}
                </button>
              </div>
            )}
          </div>
          </VehicleStep>
        ) : vendorSelectorTruckId === activeTruckId ? (
          (() => {
            const truck = sessionTrucks.find((t) => t.id === activeTruckId);
            if (!truck) {
              return (
                <div className="card-panel" style={{ textAlign: 'center', padding: '32px' }}>
                  <p>{t('quality.truckNotFound')}</p>
                  <button className="app-button app-button--primary" onClick={() => {
                    setActiveTruckId(null);
                    setVendorSelectorTruckId(null);
                  }}>{t('common.back')}</button>
                </div>
              );
            }

            const isScaleTruck = Boolean(truck.scale_draft_id);

            if (isScaleTruck) {
              const selectedContractor = contractors.find((c) => c.code === truck.contractor_code)
                || (truck.contractor_name ? { code: truck.contractor_code, name: truck.contractor_name } : null);

              return (
                <FarmSelectionPanel
                  id={`contractor-step-${truck.id}`}
                  name="contractor"
                              searchSource={contractorSource}
                              onResults={(rows) => setContractors((previous) => [...new Map([...previous, ...rows.map((row) => ({ ...row, code: row.contractorCode, name: row.contractorName }))].map((row) => [row.code, row])).values()])}
                  value={truck.contractor_code || ''}
                  hiddenValue={truck.contractor_name || ''}
                  vendors={contractors}
                  loading={contractorsLoading}
                  error={contractorsError}
                  search={contractorSearch}
                  searchPlaceholder={tx('quality.contractorSearchPlaceholder', 'Search contractor by name or code')}
                  loadingLabel={tx('quality.contractorsLoading', 'Loading contractors...')}
                  emptyLabel={tx('quality.contractorsEmpty', 'No contractors available')}
                  errorLabel={tx('quality.contractorsLoadFailed', 'Unable to load contractors')}
                  retryLabel={t('common.retry')}
                  ariaLabel={t('quality.contractor')}
                  onRetry={() => loadContractors({ force: true })}
                  onSearchChange={setContractorSearch}
                  onSelect={(contractorCode, contractorVendor) => setSessionTrucks((prev) => prev.map((item) => (
                    item.id === truck.id ? { ...item, contractor_code: contractorCode, contractor_name: contractorVendor.name } : item
                  )))}
                  header={
                    <div style={{ marginBottom: '8px' }}>
                      <span className="section-kicker">{t('quality.headerKicker')}</span>
                      <h1 className="page-title">👷 {t('quality.contractor')} ({t('quality.truckNumber')}: {truck.truck_number})</h1>
                      <p className="page-copy">{tx('quality.contractorSelectDesc', 'Select the contractor for this transport truck to continue.')}</p>
                    </div>
                  }
                >
                  <div className={`quality-selected-vendor${selectedContractor ? ' quality-selected-vendor--active' : ''}`}>
                    {selectedContractor ? (
                      <>
                        <span>{t('quality.contractor')}</span>
                        <strong>{selectedContractor.name}</strong>
                      </>
                    ) : (
                      <span>{tx('quality.selectContractorFirst', 'Select a contractor to continue.')}</span>
                    )}
                  </div>

                  <div className="wizard-nav-row quality-farm-step__actions">
                    <button
                      type="button"
                      className="app-button app-button--secondary wizard-nav-btn"
                      onClick={() => {
                        setActiveTruckId(null);
                        setVendorSelectorTruckId(null);
                        setContractorSearch('');
                      }}
                    >
                      {t('common.back')}
                    </button>
                    <button
                      type="button"
                      className="app-button app-button--primary wizard-nav-btn"
                      onClick={() => {
                        setVendorSelectorTruckId(null);
                        setContractorSearch('');
                      }}
                    >
                      {t('common.next')} - {t('quality.stepBatch')}
                    </button>
                  </div>
                </FarmSelectionPanel>
              );
            }

            const selectedVendor = vendors.find((vendor) => vendor.code === truck.farm_origin) || null;
            const selectedFilter = farmGroupFilter;
            const farms = vendors;
            const canFilterFarmGroups = workflowConfig.id === 'receiving' && farms.some((farm) => farm.groupName);
            const filteredFarmVendors = selectedFilter === 'all' || !canFilterFarmGroups
              ? vendors
              : vendors.filter((vendor) => String(vendor.groupName || '').trim() === selectedFilter);

            return (
              <FarmSelectionPanel
                id={`farm-${truck.id}`}
                name="farm"
                searchSource={workflowConfig.id === 'receiving' ? { ...farmSearch, params: { group_name: farmGroupFilter === 'all' ? '' : farmGroupFilter } } : undefined}
                onResults={(rows) => setVendors((previous) => [...new Map([...previous, ...rows.map((row) => ({ ...row, code: row.farmCode, name: row.farmName, groupName: row.GroupName }))].map((row) => [row.code, row])).values()])}
                value={truck.farm_origin}
                vendors={filteredFarmVendors}
                loading={vendorsLoading}
                search={vendorSearch}
                searchPlaceholder={tx('quality.farmSearchPlaceholder', 'Search by farm name or code')}
                onSearchChange={setVendorSearch}
                onSelect={(vendorCode) => setSessionTrucks((prev) => prev.map((item) => (
                  item.id === truck.id ? { ...item, farm_origin: vendorCode } : item
                )))}
                header={workflowConfig.id === 'receiving' ? (
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {[
                      ['all', 'الكل'],
                      ['مزارع الشركة', 'المزارع'],
                      ['موردين خام', 'موردين الخام'],
                    ].map(([value, label]) => (
                      <label key={value} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 800, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`farm-group-filter-${truck.id}`}
                          checked={farmGroupFilter === value}
                          onChange={() => setFarmGroupFilter(value)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              >
                <div className={`quality-selected-vendor${selectedVendor ? ' quality-selected-vendor--active' : ''}`}>
                  {selectedVendor ? (
                    <>
                      <span>{t('quality.stepFarm')}</span>
                      <strong>{selectedVendor.name}</strong>
                    </>
                  ) : (
                    <span>{tx('quality.selectFarmFirst', 'Select a farm to continue.')}</span>
                  )}
                </div>

                <div className="wizard-nav-row quality-farm-step__actions">
                  <button
                    type="button"
                    className="app-button app-button--primary wizard-nav-btn"
                    onClick={() => {
                      setVendorSelectorTruckId(null);
                      setVendorSearch('');
                    }}
                    disabled={!truck.farm_origin}
                  >
                    {t('common.next')} - {t('quality.stepBatch')}
                  </button>
                </div>
              </FarmSelectionPanel>
            );
          })()
        ) : (
          <OperationStep>
          {/* TRUCK DETAILS VIEW (ACTIVE TRUCK SELECTED) */}
          {(() => {
            const truck = sessionTrucks.find((t) => t.id === activeTruckId);
            if (!truck) {
              return (
                <div className="card-panel" style={{ textAlign: 'center', padding: '32px' }}>
                  <p>{t('quality.truckNotFound')}</p>
                  <button className="app-button app-button--primary" onClick={() => setActiveTruckId(null)}>{t('common.back')}</button>
                </div>
              );
            }

            const totalB = truck.batches.length;
            const compB = truck.batches.filter((b) => b.status === 'Completed').length;
            const progressPct = totalB > 0 ? (compB / totalB) * 100 : 0;
            const isEditing = truck.isNew || truck.isEditing;
            const isAddBatchFormOpen = Boolean(addBatchFormsOpen[truck.id]);
            const addBatchActionLabel = truck.batches.length === 0
              ? tx('quality.addFirstBatch', 'Add first raw inspection')
              : tx('quality.addAnotherBatch', 'Add another raw inspection');

            return (
              <div style={{ display: 'grid', gap: '20px' }}>

                <section className="card-panel quality-wizard-card--wide" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px' }}>
                  {isEditing ? (
                    /* Inline editable truck card inside Details page */
                    <form
                      onSubmit={(e) => {
                            e.preventDefault();
                            const truckNum = e.target.elements.truckNum.value.trim();
                            const contractor = e.target.elements.contractor.value.trim();
                            const contractorCode = e.target.elements.contractorCode.value.trim();

                            if (!truckNum) {
                              toast.warning(t('quality.truckNumberRequired'));
                          return;
                        }

                        setSessionTrucks((prev) =>
                            prev.map((t) =>
                              t.id === truck.id
                              ? { ...t, truck_number: truckNum, contractor_name: contractor, contractor_code: contractorCode, isNew: false, isEditing: false }
                              : t
                          )
                        );
                      }}
                    >
                      <div className="quality-vehicle-edit-header">
                        <div className="quality-vehicle-edit-header__title">
                          <span className="quality-vehicle-edit-header__icon" aria-hidden="true">🚛</span>
                          <h2>{truck.isNew ? 'سيارة جديدة' : t('quality.editTruckDetailsTitle')}</h2>
                        </div>
                        <div className="quality-vehicle-edit-header__actions">
                          <button type="submit" className="app-button app-button--primary app-button--compact quality-vehicle-edit-header__save" title={t('common.save')}>
                            <span aria-hidden="true">✓</span>
                            <span>{t('common.save')}</span>
                          </button>
                          <button
                            type="button"
                            className="quality-vehicle-edit-header__close"
                            title={t('common.cancel')}
                            aria-label={t('common.cancel')}
                            onClick={() => {
                              if (truck.isNew) {
                                setSessionTrucks((prev) => prev.filter((t) => t.id !== truck.id));
                                setActiveTruckId(null);
                              } else {
                                setSessionTrucks((prev) => prev.map((t) => (t.id === truck.id ? { ...t, isEditing: false } : t)));
                              }
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="quality-form-grid" style={{ gap: '12px' }}>
                        <div className="form-field">
                          <label htmlFor={`truckNum-${truck.id}`}>{t('quality.truckNumber')} *</label>
                          <input id={`truckNum-${truck.id}`} name="truckNum" type="text" className="app-input" defaultValue={truck.truck_number} required placeholder="e.g. 76348" autoFocus />
                        </div>
                        <FarmSelectionPanel
                          id={`contractor-${truck.id}`}
                          name="contractor"
                              searchSource={contractorSource}
                              onResults={(rows) => setContractors((previous) => [...new Map([...previous, ...rows.map((row) => ({ ...row, code: row.contractorCode, name: row.contractorName }))].map((row) => [row.code, row])).values()])}
                          value={truck.contractor_code || ''}
                          hiddenValue={truck.contractor_name || ''}
                          vendors={contractors}
                          loading={contractorsLoading}
                          error={contractorsError}
                          search={contractorSearch}
                          searchPlaceholder={tx('quality.contractorSearchPlaceholder', 'Search by contractor name or code')}
                          loadingLabel={tx('quality.contractorsLoading', 'Loading contractors...')}
                          emptyLabel={tx('quality.contractorsEmpty', 'No contractors available')}
                          errorLabel={tx('quality.contractorsLoadFailed', 'Unable to load contractors')}
                          retryLabel={t('common.retry')}
                          ariaLabel={t('quality.contractor')}
                          onRetry={() => loadContractors({ force: true })}
                          onSearchChange={setContractorSearch}
                          onSelect={(contractorCode, contractorVendor) => setSessionTrucks((prev) => prev.map((item) => (
                            item.id === truck.id ? { ...item, contractor_code: contractorCode, contractor_name: contractorVendor.name } : item
                          )))}
                          className="quality-form-field--full"
                          header={<label htmlFor={`contractor-${truck.id}`}>{t('quality.contractor')}</label>}
                        >
                          <input type="hidden" name="contractorCode" value={truck.contractor_code || ''} readOnly />
                        </FarmSelectionPanel>
                      </div>
                    </form>
                  ) : (
                    /* Static view inside Truck Details page */
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                        <h2 className="page-title" style={{ fontSize: '1.4rem', margin: 0 }}>🚛 {t('quality.truckDetailsTitle')}: {truck.truck_number}</h2>
                        <button
                          type="button"
                          className="app-button app-button--secondary app-button--compact"
                          style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '0.8rem' }}
                          title={t('quality.editTruckDetails')}
                          onClick={() => {
                            setSessionTrucks((prev) => prev.map((t) => (t.id === truck.id ? { ...t, isEditing: true } : t)));
                            setActiveTruckId(null);
                          }}
                        >
                          ✏ {t('common.edit')}
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', fontSize: '0.95rem', margin: '8px 0' }}>
                        <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.truckNumber')}:</span> <strong>{truck.truck_number}</strong></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.contractor')}:</span> <strong>{truck.contractor_name || '-'}</strong></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>{t('quality.farm')}:</span> <strong>{truck.farm_origin || '-'}</strong></div>
                      </div>

                      {/* Visual Progress Bar */}
                      <div style={{ display: 'grid', gap: '4px', margin: '8px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          <span>{compB} / {totalB} {tx('quality.batchesProgress', 'batches completed')}</span>
                          <span>{progressPct.toFixed(0)}%</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${progressPct}%`, height: '100%', backgroundColor: progressPct === 100 ? 'var(--success)' : 'var(--color-primary)', transition: 'width 0.3s ease' }} />
                        </div>
                      </div>

                      {/* Summary counters */}
                      <div className="quality-batch-stats">
                        <div className="quality-batch-stat-chip"><span>{tx('quality.totalBatchesLabel', 'Total Batches')}</span><strong>{totalB}</strong></div>
                        <div className="quality-batch-stat-chip quality-batch-stat-chip--success"><span>{t('common.done') || 'Completed'}</span><strong>{compB}</strong></div>
                        <div className="quality-batch-stat-chip quality-batch-stat-chip--warning"><span>{t('quality.statusInProgress') || 'In Progress'}</span><strong>{truck.batches.filter(b => b.status === 'In Progress').length}</strong></div>
                        <div className="quality-batch-stat-chip"><span>{t('quality.statusNotStarted') || 'Not Started'}</span><strong>{truck.batches.filter(b => b.status === 'Not Started').length}</strong></div>
                      </div>

                      <div className="quality-batch-workflow">
                        {workflowConfig.id !== 'receiving' && (
                        <div className="quality-add-batch-card" data-quality-add-batch-panel="true">
                          {!isAddBatchFormOpen ? (
                            <div className="quality-add-batch-card__cta">
                              <button
                                type="button"
                                className="app-button app-button--primary quality-add-batch-card__trigger"
                                onClick={() => setAddBatchFormsOpen((current) => ({ ...current, [truck.id]: true }))}
                              >
                                + {addBatchActionLabel}
                              </button>
                            </div>
                          ) : (
                          <div className="quality-add-batch-card__body">
                            <div className="quality-add-batch-card__fields">
                              <div className="form-field">
                                <label>Item Group</label>
                                <Autocomplete openOnFocus
                                  options={itemGroups}
                                  value={itemGroups.find((group) => String(group.ItmsGrpCod) === selectedItemGroupCode) || null}
                                  loading={isLoadingItems}
                                  autoHighlight
                                  isOptionEqualToValue={(option, selected) => String(option.ItmsGrpCod) === String(selected.ItmsGrpCod)}
                                  getOptionLabel={(option) => option.ItmsGrpNam || ''}
                                  filterOptions={(options, state) => {
                                    const search = state.inputValue.trim().toLocaleLowerCase();
                                    if (!search) return options;
                                    return options.filter((group) => String(group.ItmsGrpCod).toLocaleLowerCase().includes(search) || String(group.ItmsGrpNam || '').toLocaleLowerCase().includes(search));
                                  }}
                                  onChange={(_event, group) => selectItemGroup(group ? String(group.ItmsGrpCod) : '')}
                                  renderOption={(props, group) => (
                                    <li {...props} key={group.ItmsGrpCod}>
                                      <div style={{ display: 'grid', gap: '2px' }}><strong>{group.ItmsGrpNam}</strong><span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{group.ItmsGrpCod}</span></div>
                                    </li>
                                  )}
                                  renderInput={(params) => <TextField {...params} placeholder="Select Item Group" size="small" />}
                                />
                                <select aria-hidden="true" tabIndex={-1} style={{ display: 'none' }} className="app-input" value={selectedItemGroupCode} onChange={(event) => selectItemGroup(event.target.value)}>
                                  <option value="">— Select Item Group —</option>
                                  {itemGroups.map((group) => <option key={group.ItmsGrpCod} value={String(group.ItmsGrpCod)}>{group.ItmsGrpNam}</option>)}
                                </select>
                              </div>
                              <div className="form-field">
                                <label>Item</label>
                                <RemoteAutocomplete
                                  className="quality-item-autocomplete"
                                  searchSource={{ ...itemSearch, params: { item_group_code: selectedItemGroupCode } }}
                                  onResults={(rows) => setItemsByGroup((previous) => ({ ...previous, [selectedItemGroupCode]:
                                    [...new Map([...(previous[selectedItemGroupCode] || []).filter((row) => row.item_code === selectedItemCode), ...rows].map((row) => [row.item_code, row])).values()] }))}
                                  value={(itemsByGroup[selectedItemGroupCode] || []).find((item) => item.item_code === selectedItemCode) || null}
                                  disabled={!selectedItemGroupCode}
                                  loading={Boolean(loadingItemGroups[selectedItemGroupCode])}
                                  slotProps={{
                                    paper: { className: 'quality-item-autocomplete__paper' },
                                    listbox: { className: 'quality-item-autocomplete__listbox' },
                                    popper: { className: 'quality-item-autocomplete__popper' },
                                  }}
                                  autoHighlight
                                  isOptionEqualToValue={(option, selected) => option.item_code === selected.item_code}
                                  getOptionLabel={(option) => option.item_name || ''}
                                  filterOptions={(options, state) => {
                                    const search = state.inputValue.trim().toLocaleLowerCase();
                                    if (!search) return options;
                                    return options.filter((item) => String(item.item_code || '').toLocaleLowerCase().includes(search) || String(item.item_name || '').toLocaleLowerCase().includes(search));
                                  }}
                                  onChange={(_event, item) => setSelectedItemCode(item?.item_code || '')}
                                  renderOption={(props, item) => (
                                    <li {...props} key={item.item_code}>
                                      <div style={{ display: 'grid', gap: '2px' }}><strong>{item.item_name}</strong><span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{item.item_code}</span></div>
                                    </li>
                                  )}
                                  renderInput={(params) => <TextField {...params} placeholder={loadingItemGroups[selectedItemGroupCode] ? 'Loading Items…' : 'Select Item'} size="small" />}
                                />
                                <select aria-hidden="true" tabIndex={-1} style={{ display: 'none' }} className="app-input" value={selectedItemCode} disabled={!selectedItemGroupCode || loadingItemGroups[selectedItemGroupCode]} onChange={(event) => setSelectedItemCode(event.target.value)}>
                                  <option value="">{loadingItemGroups[selectedItemGroupCode] ? 'Loading Items…' : 'Select Item'}</option>
                                  {(itemsByGroup[selectedItemGroupCode] || []).map((item) => <option key={item.item_code} value={item.item_code}>{item.item_name}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="quality-add-batch-card__actions">
                              <button
                                type="button"
                                className="app-button app-button--primary quality-add-batch-card__button"
                                onClick={() => {
                                  const selectedItem = (itemsByGroup[selectedItemGroupCode] || []).find((item) => item.item_code === selectedItemCode);
                                  if (!selectedItem) {
                                    toast.warning(tx('quality.selectItemWarning', 'Please select an item.'));
                                    return;
                                  }
                                  const newBatchId = Date.now() + Math.random();
                                  setSessionTrucks((prev) =>
                                    prev.map((t) =>
                                      t.id === truck.id
                                        ? {
                                            ...t,
                                            batches: [
                                            ...t.batches,
                                            {
                                                id: newBatchId,
                                                batch_number: 'Pending...',
                                                item_code: selectedItem.item_code,
                                                status: 'Not Started',
                                                inspection_id: null,
                                                decision: null,
                                                item_name: selectedItem.item_name,
                                                raw_material_type: selectedItem.raw_material_type,
                                                uom_code: selectedItem.uom_code || '',
                                                uom_name: selectedItem.uom_name || selectedItem.uom_code || '',
                                                isNew: false,
                                              },
                                            ],
                                          }
                                        : t
                                    )
                                  );
                                  setSelectedItemCode('');
                                  setAddBatchFormsOpen((current) => ({ ...current, [truck.id]: false }));
                                  window.setTimeout(() => {
                                    document.querySelector(`[data-quality-batch-card-id="${newBatchId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }, 0);
                                }}
                              >
                                + {addBatchActionLabel}
                              </button>
                              <button
                                type="button"
                                className="app-button app-button--secondary quality-add-batch-card__cancel"
                                onClick={() => {
                                  setSelectedItemCode('');
                                  setAddBatchFormsOpen((current) => ({ ...current, [truck.id]: false }));
                                }}
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                          )}
                        </div>
                        )}

                        <section className="quality-batch-list-panel">
                          <div className="quality-batch-list-panel__header">
                            <strong>{tx('quality.addedOperationsTitle', 'Added operations')}</strong>
                            <span>{tx('quality.totalOperationsCount', 'Total operations')}: {totalB}</span>
                          </div>

                          {truck.batches.length === 0 ? (
                            <div className="quality-batch-empty">
                              <strong>{tx('quality.operationsEmptyTitle', 'No operations yet')}</strong>
                              <span>{tx('quality.operationsEmptyDesc', 'Start by adding the first raw inspection.')}</span>
                            </div>
                          ) : (
                            <div className="quality-batch-list">
                              {truck.batches.map((batch) => {
                                const isBatchEditing = batch.isNew || batch.isEditing;
                                let statusLabel = t('quality.statusNotStarted') || 'Not Started';
                                if (batch.status === 'Completed') statusLabel = t('quality.statusCompleted') || 'Completed';
                                else if (batch.status === 'In Progress') statusLabel = t('quality.statusInProgress') || 'In Progress';
                                const selectedGroupCode = batchItemGroupCodes[batch.id] || '';
                                const groupItems = itemsByGroup[selectedGroupCode] || [];
                                const groupItemsLoading = Boolean(loadingItemGroups[selectedGroupCode]);

                                if (isBatchEditing) {
                                  return (
                                    <div className="quality-batch-card quality-batch-card--editing" key={batch.id} data-quality-batch-edit-card="true">
                                      <div className="quality-batch-card__main">
                                        <strong className="quality-batch-card__product">
                                          <span className="meta-label-icon" aria-hidden="true" style={{ marginInlineEnd: '5px' }}>
                                            {getProductIcon(batch.item_name || batch.item_code)}
                                          </span>
                                          {batch.item_name || '—'}
                                        </strong>
                                        <select
                                          className="app-input"
                                          style={{ display: 'none' }}
                                          value={selectedGroupCode}
                                          onChange={(event) => selectItemGroup(event.target.value)}
                                        >
                                          <option value="">— Select Item Group —</option>
                                          {itemGroups.map((group) => (
                                            <option key={group.ItmsGrpCod} value={String(group.ItmsGrpCod)}>{group.ItmsGrpNam}</option>
                                          ))}
                                        </select>
                                        <select
                                          key={selectedGroupCode}
                                          data-quality-item-select="true"
                                          className="app-input"
                                          style={{ display: 'none' }}
                                          defaultValue={batch.item_code}
                                          disabled={!selectedGroupCode || groupItemsLoading}
                                        >
                                          <option value="">{t('quality.selectItem') || '— Select Item —'}</option>
                                          {groupItems.map((item) => (
                                            <option key={item.item_code} value={item.item_code}>
                                              [{item.item_code}] {item.item_name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="quality-batch-card__actions quality-batch-card__actions--edit">
                                        <button
                                          type="button"
                                          className="app-button app-button--success app-button--compact"
                                          onClick={(e) => {
                                            const card = e.target.closest('[data-quality-batch-edit-card="true"]');
                                            const selectEl = card.querySelector('[data-quality-item-select="true"]');
                                            if (!selectEl) return;
                                            const selectedCode = selectEl.value;
                                            const selectedItem = groupItems.find(item => item.item_code === selectedCode) || {
                                              item_code: batch.item_code,
                                              item_name: batch.item_name,
                                              raw_material_type: batch.raw_material_type,
                                              uom_code: batch.uom_code,
                                              uom_name: batch.uom_name,
                                            };
                                            if (!selectedItem) {
                                              toast.warning(tx('quality.selectItemWarning', 'Please select an item.'));
                                              return;
                                            }
                                            setSessionTrucks((prev) =>
                                              prev.map((t) =>
                                                t.id === truck.id
                                                  ? {
                                                      ...t,
                                                      batches: t.batches.map((b) =>
                                                        b.id === batch.id
                                                          ? {
                                                              ...b,
                                                              batch_number: 'Pending...',
                                                              item_code: selectedItem.item_code,
                                                              item_name: selectedItem.item_name,
                                                              raw_material_type: selectedItem.raw_material_type,
                                                              uom_code: selectedItem.uom_code || '',
                                                              uom_name: selectedItem.uom_name || selectedItem.uom_code || '',
                                                              isNew: false,
                                                              isEditing: false
                                                            }
                                                          : b
                                                      ),
                                                    }
                                                  : t
                                              )
                                            );
                                          }}
                                        >
                                          ✓ {t('common.save')}
                                        </button>
                                        <button
                                          type="button"
                                          className="app-button app-button--secondary app-button--compact"
                                          onClick={() => {
                                            setSessionTrucks((prev) =>
                                              prev.map((t) =>
                                                t.id === truck.id
                                                  ? {
                                                      ...t,
                                                      batches: t.batches
                                                        .map((b) => {
                                                          if (b.id === batch.id) {
                                                            if (b.isNew && !b.item_code) {
                                                              return null;
                                                            }
                                                            return { ...b, isNew: false, isEditing: false };
                                                          }
                                                          return b;
                                                        })
                                                        .filter(Boolean),
                                                    }
                                                  : t
                                              )
                                            );
                                          }}
                                        >
                                          × {t('common.cancel')}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div className="quality-batch-card" key={batch.id} data-quality-batch-card-id={batch.id}>
                                    <div className="quality-batch-card__main">
                                      <strong className="quality-batch-card__product">
                                        <span className="meta-label-icon" aria-hidden="true" style={{ marginInlineEnd: '5px' }}>
                                          {getProductIcon(batch.item_name || batch.item_code)}
                                        </span>
                                        {batch.item_name || '-'}
                                      </strong>
                                      <span className="quality-batch-card__batch">
                                        {batch.batch_number && batch.batch_number.toLowerCase().startsWith('pending') ? (
                                          <em>{t('quality.autoGenerated') || 'Auto-generated'}</em>
                                        ) : (
                                          batch.batch_number
                                        )}
                                      </span>
                                    </div>
                                    <span className={`quality-status-badge quality-status-badge--${String(batch.status || 'Not Started').toLowerCase().replace(/\s+/g, '-')}`}>
                                      {statusLabel}
                                    </span>
                                    <div className="quality-batch-card__actions">
                                      {batch.status === 'Completed' ? (
                                        <ViewActionButton icon="👁"
                                          onClick={() => handleViewReport(batch.inspection_id)}
                                        />
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            className="app-button app-button--primary quality-batch-card__start"
                                            title={batch.status === 'In Progress' ? t('quality.continueInspection') : t('quality.startInspection')}
                                            onClick={() => handleStartInspectionForBatch(truck, batch)}
                                            disabled={isSearching}
                                          >
                                            ▶ {batch.status === 'In Progress' ? t('quality.continueInspection') : tx('quality.openOperationAction', 'Start raw inspection')}
                                          </button>
                                          <button
                                            type="button"
                                            className="quality-batch-card__icon-action"
                                            title={t('quality.editBatchNumber')}
                                            onClick={() => {
                                              setSessionTrucks((prev) =>
                                                prev.map((t) =>
                                                  t.id === truck.id
                                                    ? {
                                                        ...t,
                                                        batches: t.batches.map((b) =>
                                                          b.id === batch.id ? { ...b, isEditing: true } : b
                                                        ),
                                                      }
                                                    : t
                                                )
                                              );
                                            }}
                                          >
                                            ✏
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        className="quality-batch-card__delete"
                                        title={t('quality.deleteBatch')}
                                        onClick={() => {
                                          if (window.confirm(t('quality.confirmRemoveBatch'))) {
                                            setSessionTrucks((prev) =>
                                              prev.map((t) =>
                                                t.id === truck.id ? { ...t, batches: t.batches.filter((b) => b.id !== batch.id) } : t
                                              )
                                            );
                                            const draftKey = `${truck.id}_${batch.batch_number}`;
                                            setBatchDrafts((prev) => {
                                              const next = { ...prev };
                                              delete next[draftKey];
                                              return next;
                                            });
                                          }
                                        }}
                                      >
                                        🗑 {t('common.delete')}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </section>

                        <div className="wizard-nav-row">
                          <button
                            type="button"
                            className="app-button app-button--secondary wizard-nav-btn"
                            onClick={() => {
                              setVendorSelectorTruckId(truck.id);
                            }}
                          >
                            {t('common.back')}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              </div>
              );
            })()}
          </OperationStep>
        )
      )}

      {/* Quality Wizard Batch Inspection Mode */}
      {inspectingBatch && (
        <>
          {/* Step 0: Search Batch (Fallback when batch number is not provided) */}
          {step === 0 && (
            <OperationStep className="card-panel card-panel--narrow">
              <div className="page-header__content" style={{ marginBottom: '16px' }}>
                <span className="section-kicker">{t('quality.headerKicker')}</span>
                <h1 className="page-title">🔍 {t('quality.searchTitle')}</h1>
                <p className="page-copy">{t('quality.searchDesc')}</p>
              </div>
              <form onSubmit={handleBatchSearch}>
                <div className="form-field">
                  <label htmlFor="quality-batch-search">{t('quality.batchNumber')}</label>
                  <div className="quality-search-bar">
                    <input
                      id="quality-batch-search"
                      type="text"
                      className="app-input quality-search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('quality.searchPlaceholder')}
                      disabled={isSearching}
                      autoComplete="off"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="app-button app-button--primary"
                      disabled={isSearching}
                    >
                      {isSearching ? t('quality.searching') : t('common.search')}
                    </button>
                  </div>
                </div>
              </form>
              <div className="wizard-nav-row" style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={handleCancelInspection}
                >
                  {t('common.back')}
                </button>
              </div>
            </OperationStep>

          )}

          {/* Step 1: Inspection Details */}
          {step === 1 && (
            <InspectionStep className="card-panel card-panel--lg">
              <div className="page-header__content" style={{ marginBottom: '16px' }}>
                <span className="section-kicker">{t('quality.headerKicker')}</span>
                <h1 className="page-title">📝 {t('quality.stepInfo')}</h1>
                <p className="page-copy">{t('quality.infoDesc')}</p>
              </div>

              <div className="quality-inspection-info">
                <div className="quality-inspection-summary" aria-label={t('quality.stepBatch')}>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <span className="meta-label-icon" aria-hidden="true">🚚</span>
                      {t('quality.truckNumber')}
                    </span>
                    <strong>{metadata.car_number || '-'}</strong>
                  </div>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <span className="meta-label-icon" aria-hidden="true">📍</span>
                      {t('quality.farm')}
                    </span>
                    <strong>{metadata.farm_origin || '-'}</strong>
                  </div>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <span className="meta-label-icon" aria-hidden="true">{getProductIcon(metadata.item_name || metadata.item_code)}</span>
                      {t('quality.productName')}
                    </span>
                    <strong>{metadata.item_name || '-'}</strong>
                  </div>
                </div>

                <div className="quality-inspection-info__row">
                  <div className="form-field">
                    <label htmlFor="quality-inspector-name">{t('quality.inspectorName')} <span className="required">*</span></label>
                    <input
                      id="quality-inspector-name"
                      type="text"
                      className={`app-input ${errors.inspector_name ? 'app-input--invalid' : ''}`}
                      placeholder={t('quality.inspectorPlaceholder')}
                      value={metadata.inspector_name}
                      onChange={(e) => setMetadata({ ...metadata, inspector_name: e.target.value })}
                    />
                    {errors.inspector_name && <span className="error-msg">{errors.inspector_name}</span>}
                  </div>
                  <div className="form-field">
                    <label htmlFor="quality-inspection-date">{t('quality.inspectionDate')} <span className="required">*</span></label>
                    <input
                      id="quality-inspection-date"
                      className="app-input"
                      type="date"
                      value={metadata.inspection_date}
                      onChange={(e) => setMetadata({ ...metadata, inspection_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-field quality-sample-count-field">
                  <label htmlFor="quality-sample-count">{t('quality.numSamples')}</label>
                  <div className="quality-sample-count-stepper">
                    <button
                      type="button"
                      className="quality-sample-count-stepper__btn"
                      onClick={() => setSampleCount((c) => Math.max(1, c - 1))}
                      aria-label={t('quality.decreaseSamples')}
                    >
                      -
                    </button>
                    <input
                      id="quality-sample-count"
                      type="number"
                      className="app-input quality-sample-count-stepper__input"
                      value={sampleCount}
                      onChange={(e) => setSampleCount(Math.max(1, parseInt(e.target.value, 10) || 5))}
                    />
                    <button
                      type="button"
                      className="quality-sample-count-stepper__btn"
                      onClick={() => setSampleCount((c) => Math.min(150, c + 1))}
                      aria-label={t('quality.increaseSamples')}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor="quality-notes">{t('quality.additionalNotes')}</label>
                  <textarea
                    id="quality-notes"
                    className="app-input"
                    rows={4}
                    value={metadata.notes}
                    onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })}
                    placeholder={t('quality.notesPlaceholder')}
                  />
                </div>
              </div>

              <div className="wizard-nav-row">
                <button type="button" className="app-button app-button--secondary wizard-nav-btn" onClick={handleCancelInspection}>
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  className="app-button app-button--primary wizard-nav-btn"
                  onClick={handleNextFromInfo}
                >
                  {t('common.next')}
                </button>
              </div>
            </InspectionStep>

          )}

          {/* Sample Inspection */}
          {step >= 2 && step < 2 + sampleCount && (() => {
            const sampleIdx = step - 2;
            const currentSample = samples[sampleIdx] || { defects: {} };
            const currentDefectTotal = calculateQualityMetrics([currentSample], 1).sumAH;
            const categoryEntries = Object.entries(activeDefectCategories);

            return (
              <SamplesStep key={step} className="card-panel quality-wizard-card--wide">
                <div className="quality-wizard-heading quality-sample-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div className="page-header__content">
                    <span className="section-kicker">{t('quality.headerKicker')}</span>
                    <h1 className="page-title">
                      🧪 {t('quality.inspectingSample', sampleIdx + 1)}
                      {activeTruckId !== null && (() => {
                        const selectedTruck = sessionTrucks.find((t) => t.id === activeTruckId);
                        return selectedTruck ? (
                          <span style={{ fontSize: '1.1rem', fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: '12px' }}>
                            ({t('quality.truckNumber')}: {selectedTruck.truck_number || '-'})
                          </span>
                        ) : null;
                      })()}
                    </h1>
                    <p className="page-copy">{t('quality.sampleEntryDesc')}</p>
                  </div>
                  <span className="sample-completion-badge" style={{ backgroundColor: 'var(--color-primary-soft)', color: 'var(--color-primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                    {t('quality.sampleOf', sampleIdx + 1, sampleCount)}
                  </span>
                </div>

                <div className="quality-sample-live-summary">
                  <span>{tx('quality.recordedDefects', 'Recorded defects')}</span>
                  <strong>{currentDefectTotal}</strong>
                </div>

                {defectCategoriesLoading && workflowConfig.dynamicCriteria ? (
                  <div className="quality-vendor-state"><CircularProgress size={26} /></div>
                ) : (
                <div className="sample-category-tabs">
                  <div className="sample-category-tab-controls" role="tablist" aria-label={t('quality.stepSamples')}>
                    {categoryEntries.map(([catKey, cat]) => {
                      const tabMeta = DEFECT_CATEGORY_META[catKey] || {};
                      const activeCount = cat.items.reduce((sum, item) => sum + (currentSample.defects[item.key] > 0 ? 1 : 0), 0);
                      const isActive = activeSampleCategoryKey === catKey;
                      return (
                        <button
                          type="button"
                          key={`tab-label-${catKey}`}
                          className={`sample-category-tab sample-category-tab--${catKey}${isActive ? ' sample-category-tab--active' : ''}`}
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => setActiveSampleCategoryKey(catKey)}
                        >
                          <span aria-hidden="true">{cat.icon || tabMeta.icon}</span>
                          <strong>{cat.titleAr || cat.titleEn ? getCategoryTitle(cat) : tx(tabMeta.labelKey, tabMeta.fallback)}</strong>
                          <em>{activeCount}</em>
                        </button>
                      );
                    })}
                  </div>

                  {renderedDefectCategoryEntries.map(([catKey, cat]) => (
                    <div
                      className={`category-card sample-category-panel sample-category-panel--${catKey}${activeSampleCategoryKey === catKey ? ' sample-category-panel--active' : ''}`}
                      key={catKey}
                    >
                      <div className={`category-card-header ${cat.class}`}>
                        <span className="category-card-title">{getCategoryTitle(cat)}</span>
                      </div>
                      <div className="category-card-body">
                        {cat.items.length === 0 ? (
                          <div className="sample-category-empty">
                            <strong>{tx('quality.noActiveDefects', 'No defects in this category.')}</strong>
                          </div>
                        ) : cat.items.map((item) => {
                          const value = currentSample.defects[item.key] || 0;
                          const isChecked = value > 0;

                          return (
                            <div className={`defect-input-row${isChecked ? ' defect-input-row--active' : ''}`} key={item.key}>
                              <label className="defect-label-side">
                                <span className="defect-name">{getDefectDisplayName(item)}</span>
                                <span className="custom-checkbox-container">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => handleDefectToggle(sampleIdx, item.key, e.target.checked)}
                                  />
                                  <span className="checkmark"></span>
                                </span>
                              </label>
                              <div className={`defect-qty-side ${!isChecked ? 'disabled' : ''}`}>
                                <div className="qty-input-wrapper">
                                  <button
                                    type="button"
                                    className="qty-btn"
                                    onClick={() => handleDefectChange(sampleIdx, item.key, -1)}
                                    disabled={!isChecked}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    value={value}
                                    onChange={(e) => handleDefectInputChange(sampleIdx, item.key, e.target.value)}
                                    disabled={!isChecked}
                                  />
                                  <button
                                    type="button"
                                    className="qty-btn"
                                    onClick={() => handleDefectChange(sampleIdx, item.key, 1)}
                                    disabled={!isChecked}
                                  >
                                    +
                                  </button>
                                </div>
                                <span className="defect-unit">{t('quality.unit')}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                )}

                <div className="sample-inner-nav">
                  <button
                    type="button"
                    className="app-button app-button--secondary wizard-nav-btn"
                    onClick={() => setStep(step - 1)}
                  >
                    {t('common.back')}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--primary wizard-nav-btn"
                    onClick={() => {
                      if (step === 2 + sampleCount - 1) {
                        goToStep(200); // Go to results dashboard
                      } else {
                        goToStep(step + 1);
                      }
                    }}
                  >
                    {step === 2 + sampleCount - 1 ? tx('quality.reviewResultsAction', 'Review Results →') : t('quality.nextSample')}
                  </button>
                </div>
              </SamplesStep>
            );
          })()}

          {/* Step 200: Results Dashboard */}
          {step === 200 && (
            <ReviewStep className="quality-wizard-card--wide results-dashboard" style={{ display: 'grid', gap: '20px' }}>
              <section className="card-panel" style={{ display: 'grid', gap: '14px' }}>
                <div className="page-header__content">
                  <span className="section-kicker">{t('quality.headerKicker')}</span>
                  <h1 className="page-title">📋 {tx('quality.stepReview', 'Review & Verify')}</h1>
                  <p className="page-copy">{tx('quality.reviewDesc', 'Please review the sample defect data before saving the inspection report.')}</p>
                </div>
                <div className="quality-inspection-summary" aria-label={tx('quality.reviewCollectedInfo', 'Collected information')}>
                  {[
                    [t('quality.inspectorName'), metadata.inspector_name, '👤'],
                    [t('quality.inspectionDate'), metadata.inspection_date, '📅'],
                    [t('quality.supplierName'), metadata.supplier_name, '🏢'],
                    [t('quality.farmOrigin'), metadata.farm_origin, '📍'],
                    [t('quality.contractorName'), metadata.contractor_name, '👤'],
                    [t('quality.carNumber'), metadata.car_number, '🚚'],
                    [t('quality.productName'), metadata.item_name, getProductIcon(metadata.item_name || metadata.item_code)],
                    [t('quality.batchNumber'), metadata.batch_number, '🏷️'],
                    [t('quality.additionalNotes'), metadata.notes, '📝'],
                  ].map(([label, value, icon]) => (
                    <div key={label}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span className="meta-label-icon" aria-hidden="true">{icon}</span>
                        {label}
                      </span>
                      <strong>{value === undefined || value === null || value === '' ? '-' : value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <div className="kpi-grid">
                <div className="kpi-card">
                  <span className="kpi-val">{sampleCount}</span>
                  <span className="kpi-label">{t('quality.totalSamples')}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-val">{calculatedMetrics.sumAH}</span>
                  <span className="kpi-label">{lang === 'ar' ? 'إجمالي الوحدات المفحوصة' : 'Total inspected units'}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-val" style={{ fontSize: '15px', fontWeight: 700, lineHeight: '33px' }}>{mostCommonDefect}</span>
                  <span className="kpi-label">{t('quality.commonDefect')}</span>
                </div>
                <div className={`kpi-card kpi-card--${calculatedMetrics.decision.includes('Rejected') ? 'danger' : calculatedMetrics.decision.includes('Conditional') ? 'warning' : 'success'}`}>
                  <span className="kpi-val kpi-val--decision">
                    {t(`quality.decisions.${calculatedMetrics.decision}`) || calculatedMetrics.decision}
                  </span>
                  <span className="kpi-label">{t('quality.qaDecision')}</span>
                </div>
              </div>

              {/* Defect Category Percentages Grid */}
              <div className="defect-categories-percentage-container">
                {Object.entries(activeDefectCategories).map(([catKey, cat]) => (
                  <div className="kpi-card" key={catKey} style={{ display: 'block', textAlign: 'right', padding: '16px' }}>
                    <h4 style={{ margin: '0 0 14px 0', fontSize: '0.95rem', fontWeight: 800, borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      {getCategoryTitle(cat)}
                    </h4>
                    <div>
                      {cat.items.map((item) => {
                        const qty = calculatedMetrics.totals[item.key] || 0;
                        const pct = calculatedMetrics.sumAH > 0 ? (qty / calculatedMetrics.sumAH) * 100 : 0;
                        const barColorClass = cat.barClass || (catKey === 'pests' ? 'bar-pest' : catKey === 'mechanical' ? 'bar-mechanical' : 'bar-other');
                        return (
                          <div className="defect-percentage-item" key={item.key}>
                            <div className="pct-info">
                              <span>{getDefectDisplayName(item)}</span>
                              <span style={{ color: qty > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700 }}>
                                {pct.toFixed(2)}% ({qty} {t('quality.unit', 'وحدة')})
                              </span>
                            </div>
                            <div className="pct-bar-bg">
                              <div className={`pct-bar-fill ${barColorClass}`} style={{ width: `${pct}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <section className="card-panel">
                <div className="page-header__content" style={{ marginBottom: '16px' }}>
                  <span className="section-kicker">{t('quality.headerKicker')}</span>
                  <h1 className="page-title">📊 {t('quality.excelMatrix')}</h1>
                  <p className="page-copy">{t('quality.excelMatrixDesc')}</p>
                </div>

                <div className="excel-matrix-wrapper">
                  <ExcelSummaryMatrix
                    totals={calculatedMetrics.totals}
                    sumAH={calculatedMetrics.sumAH}
                    sumAF={calculatedMetrics.sumAF}
                    sumAG={calculatedMetrics.sumAG}
                    t={t}
                  />
                </div>

                {calculatedMetrics.quarantineViolation && (
                  <div className="notes-report-box" style={{ marginTop: '20px' }}>
                    <strong>{t('quality.quarantineViolation')}</strong>
                    {t('quality.quarantineViolationDesc')}
                  </div>
                )}
              </section>

              <div className="wizard-nav-row">
                <button type="button" className="app-button app-button--secondary wizard-nav-btn" onClick={() => setStep(2 + sampleCount - 1)}>
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  className="app-button app-button--primary wizard-nav-btn"
                  onClick={handleSubmitReport}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting ? 'true' : 'false'}
                >
                  {isSubmitting ? (
                    <>
                      <AppSpinner size="xs" />
                      <span>{t('quality.submitting')}</span>
                    </>
                  ) : (
                    t('quality.confirmSaveReport')
                  )}
                </button>
              </div>
            </ReviewStep>

          )}

          {/* Step 201: Printable A4 Report & Done */}
          {step === 201 && submittedData && (() => {
            const printSamples = submittedData.samples_data || samples || [];
            const printSampleCount = submittedData.sample_size || printSamples.length || sampleCount;
            return (
              <CompleteStep className="card-panel quality-wizard-card--wide">
                <div className="page-header__content no-print" style={{ marginBottom: '16px' }}>
                  <span className="section-kicker">{t('quality.headerKicker')}</span>
                  <h1 className="page-title">🎉 {t('quality.stepPrint')}</h1>
                  <p className="page-copy">{t('quality.submitSuccess')}</p>
                </div>

                <div className="quality-completion-actions no-print">
                  <PrintActionButton icon={<PrintIcon />}
                    onClick={() => {
                      const opened = openPrintDocument({
                        title: `EGAST-QA-${submittedData.batch_number || 'Quality-Inspection'}`,
                        elements: completionPrintSheetRef.current,
                      });
                      if (!opened) {
                        toast.error(tx('quality.printWindowBlocked', 'Unable to open the print document. Please allow pop-ups and try again.'));
                      }
                    }}
                  />
                  <div className="quality-completion-actions__secondary">
                    <Button
                      type="button"
                      variant="outlined"
                      color="primary"
                      endIcon={<LocalShippingIcon />}
                      onClick={resetToNewVehicleInspection}
                    >
                      {tx('quality.startNewVehicleInspection', 'Start New Vehicle Inspection')}
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      color="inherit"
                      endIcon={<ArrowBackIcon />}
                      onClick={returnToCurrentVehicleDetails}
                    >
                      {tx('quality.returnToVehicleDetails', 'Return to Vehicle Details')}
                    </Button>
                  </div>
                </div>

                <div className="a4-print-sheet quality-print-sheet" ref={completionPrintSheetRef}>
                  <QualityPrintHeader reportNumber={`EGAST-QA-${submittedData.batch_number}`} />

                  {/* Metadata Grid */}
                  <h3 className="report-section-header quality-section-header">بيانات الفحص</h3>
                  <div className="report-info-grid">
                    <div className="info-cell"><span className="cell-lbl">تاريخ الفحص:</span> <strong>{submittedData.inspection_date || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">المفتش المسؤول:</span> <strong>{submittedData.inspector_name || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">مدخل البيانات:</span> <strong>{submittedData.data_clerk_name || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">المورد:</span> <strong>{submittedData.supplier_name || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">المزرعة / المنشأ:</span> <strong>{submittedData.farm_origin || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">المقاول:</span> <strong>{submittedData.contractor_name || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">رقم السيارة:</span> <strong>{submittedData.car_number || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">المحصول:</span> <strong>{submittedData.crop_name || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">نوع المادة الخام:</span> <strong>{submittedData.raw_material_type || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">رقم التشغيلة:</span> <strong>{submittedData.batch_number || '-'}</strong></div>
                    <div className="info-cell"><span className="cell-lbl">إجمالي العينات المفحوصة:</span> <strong>{printSampleCount} عينات</strong></div>
                  </div>

                  {/* Mini KPIs Dashboard inside printed document */}
                  <h3 className="report-section-header quality-section-header">ملخص الجودة</h3>
                  <div className="report-kpi-row">
                    <div className="kpi-mini-box">
                      <span className="kpi-lbl">إجمالي العينات</span>
                      <strong>{printSampleCount}</strong>
                    </div>
                    <div className="kpi-mini-box">
                      <span className="kpi-lbl">إجمالي الوحدات المفحوصة</span>
                      <strong>{submittedData.ah_grand_total} وحدة</strong>
                    </div>
                    <div className="kpi-mini-box">
                      <span className="kpi-lbl">العيب الأكثر شيوعاً</span>
                      <strong>{(() => {
                        const defectTotals = {};
                        printSamples.forEach(sample => {
                          for (const key in sample.defects) {
                            const qty = Number(sample.defects[key] || 0);
                            if (qty > 0) {
                              defectTotals[key] = (defectTotals[key] || 0) + qty;
                            }
                          }
                        });
                        let maxDefectKey = null;
                        let maxQty = -1;
                        for (const key in defectTotals) {
                          if (defectTotals[key] > maxQty && defectTotals[key] > 0) {
                            maxQty = defectTotals[key];
                            maxDefectKey = key;
                          }
                        }
                        if (maxDefectKey) {
                          return `${getDefectDisplayNameByKey(maxDefectKey)} (${maxQty} وحدة)`;
                        }
                        return "لا يوجد عيوب";
                      })()}</strong>
                    </div>
                    <div className={`kpi-mini-box kpi-mini-box--status ${submittedData.decision.includes('Rejected') ? 'status-rejected' : 'status-accepted'}`}>
                      <span className="kpi-lbl">قرار الجودة النهائي</span>
                      <strong>{t(`quality.decisions.${submittedData.decision}`) || submittedData.decision}</strong>
                    </div>
                  </div>

                  <h3 className="report-section-header">جدول تحليل ونسب العيوب المكتشفة</h3>
                  <ExcelSummaryMatrix
                    totals={(() => {
                      const defectTotals = {};
                      printSamples.forEach(sample => {
                        for (const key in sample.defects) {
                          defectTotals[key] = (defectTotals[key] || 0) + Number(sample.defects[key] || 0);
                        }
                      });
                      return defectTotals;
                    })()}
                    sumAH={submittedData.ah_grand_total}
                    sumAF={submittedData.af_waste_total}
                    sumAG={submittedData.ag_quality_total}
                    t={t}
                  />

                  {submittedData.notes && (
                    <div className="print-notes-box">
                      <strong>توصيات ضبط الجودة وملاحظات الاستلام الفنية:</strong>
                      <p>{submittedData.notes}</p>
                    </div>
                  )}

                  {/* Signatures pad */}
                  <div className="report-signature-row">
                    <div className="sig-column">
                      <p>توقيع مفتش الجودة المسؤول:</p>
                      <div className="sig-line"></div>
                      <span className="sig-date-placeholder">التاريخ: .... / .... / ...........</span>
                    </div>
                    <div className="sig-column">
                      <p>اعتماد مدير إدارة الجودة والمخازن:</p>
                      <div className="sig-line"></div>
                      <span className="sig-date-placeholder">التاريخ: .... / .... / ...........</span>
                    </div>
                  </div>

                  {/* Document Footer */}
                  <div className="report-print-footer">
                    <span className="report-print-footer-brand">
                      الشركة المصرية للخدمات الزراعية (إيجاست) · تقرير فحص الجودة
                    </span>
                    <span className="report-print-footer-meta">
                      EGAST Quality Assurance System
                    </span>
                  </div>
                </div>
              </CompleteStep>
            );
          })()}

          {/* Step 202: Simple Success Screen after Save */}
          {step === 202 && submittedData && (
            <CompleteStep className="card-panel card-panel--narrow" style={{ textAlign: 'center', padding: '32px 24px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎉</div>
              <h2 className="page-title" style={{ marginBottom: '8px' }}>
                {t('quality.saveSuccessTitle') || 'Inspection Saved Successfully'}
              </h2>
              <p className="page-copy" style={{ marginBottom: '24px', fontSize: '0.95rem' }}>
                {t('quality.saveSuccessDesc') ? t('quality.saveSuccessDesc').replace('{batchNum}', submittedData.batch_number) : `The quality inspection report for batch ${submittedData.batch_number} has been recorded and submitted for review.`}
              </p>

              <div className="quality-completion-actions">
                <PrintActionButton icon={<PrintIcon />}
                  onClick={() => {
                    goToStep(201); // Navigate to A4 print sheet
                  }}
                />

                <div className="quality-completion-actions__secondary">
                  <Button
                    type="button"
                    variant="outlined"
                    color="primary"
                    endIcon={<LocalShippingIcon />}
                    onClick={resetToNewVehicleInspection}
                  >
                    {tx('quality.startNewVehicleInspection', 'Start New Vehicle Inspection')}
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    color="inherit"
                    endIcon={<ArrowBackIcon />}
                    onClick={returnToCurrentVehicleDetails}
                  >
                    {tx('quality.returnToVehicleDetails', 'Return to Vehicle Details')}
                  </Button>
                </div>
              </div>
            </CompleteStep>

          )}
        </>
      )}
      </div>

    </div>
  );
}

export default QualityWizardLayout;
