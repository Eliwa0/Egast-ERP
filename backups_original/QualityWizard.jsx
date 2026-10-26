import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import '../styles/pages/quality-inspection.css';

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

const QUALITY_STEPS = [
  { labelKey: 'quality.stepBatch', icon: '🔍' },
  { labelKey: 'quality.stepInfo', icon: '📝' },
  { labelKey: 'quality.stepSamples', icon: '🧪' },
  { labelKey: 'quality.stepReview', icon: '📋' },
  { labelKey: 'quality.stepResults', icon: '📊' },
  { labelKey: 'quality.stepDone', icon: '🎉' },
];

const getQualityPhase = (step, sampleCount) => {
  if (step === 0) return 0;
  if (step === 1) return 1;
  if (step >= 2 && step < 3 + sampleCount) return 2;
  if (step === 3 + sampleCount) return 3;
  if (step === 4 + sampleCount) return 4;
  return 5;
};

function QualityStepBar({ phase, t }) {
  return (
    <div className="wizard-stepbar-wrap">
      {QUALITY_STEPS.map(({ labelKey, icon }, i) => {
        const isDone = i < phase;
        const isActive = i === phase;
        const cls = [
          'wizard-step',
          isDone ? 'wizard-step--done' : '',
          isActive ? 'wizard-step--active' : '',
        ].filter(Boolean).join(' ');

        return (
          <React.Fragment key={labelKey}>
            <div className={cls}>
              <div className="wizard-step__circle">
                {isDone ? '✓' : icon}
              </div>
              <span className="wizard-step__label">{t(labelKey)}</span>
            </div>
            {i < QUALITY_STEPS.length - 1 && (
              <div className={`wizard-connector${isDone ? ' wizard-connector--done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function QualityWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const tx = (path, fallback, ...args) => {
    const value = t(path, ...args);
    return value === path ? fallback : value;
  };

  // Wizard state
  const [step, setStep] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedData, setSubmittedData] = useState(null);

  const [metadata, setMetadata] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    inspector_name: '',
    data_clerk_name: user?.username || '',
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
    warehouse: '',
    quantity: 0,
  });

  const [sampleCount, setSampleCount] = useState(5);
  const [samples, setSamples] = useState([]);
  const [errors, setErrors] = useState({});

  // Restore draft if any exists in localStorage
  useEffect(() => {
    const draft = localStorage.getItem('quality_inspection_draft');
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.metadata) setMetadata(parsed.metadata);
        if (parsed.sampleCount) setSampleCount(parsed.sampleCount);
        if (parsed.samples) setSamples(parsed.samples);
        if (parsed.step) setStep(parsed.step);
        toast.info(tx('quality.draftSaved', 'Restored draft inspection report from local storage.'));
      } catch (e) {
        console.error('Failed to parse inspection draft', e);
      }
    }
  }, []);

  // Autosave draft state
  useEffect(() => {
    if (step > 0 && step < 5 + sampleCount) {
      const draft = {
        metadata,
        sampleCount,
        samples,
        step,
      };
      localStorage.setItem('quality_inspection_draft', JSON.stringify(draft));
    } else if (step === 5 + sampleCount) {
      localStorage.removeItem('quality_inspection_draft');
    }
  }, [metadata, sampleCount, samples, step]);

  // Sync samples length when count changes
  useEffect(() => {
    setSamples((prev) => {
      const next = [...prev];
      if (next.length < sampleCount) {
        for (let i = next.length; i < sampleCount; i++) {
          next.push({
            id: i + 1,
            defects: {
              acarus: 0, scale_insect: 0, spray_marks: 0, citrus_rust: 0, thrips: 0,
              vegetable_defects: 0, gummosis: 0, oil_spots: 0, sunburn: 0, sooty_mold: 0,
              mealybug: 0, tearing: 0, high_cut: 0, bruises: 0, cuts: 0, under_size: 0,
              venting: 0, fruit_fly: 0, creasing: 0, fall_drop: 0, mutations: 0,
              navel_blight: 0, softness: 0, molds: 0, grade_1: 0, grade_2: 0
            },
          });
        }
      } else if (next.length > sampleCount) {
        return next.slice(0, sampleCount);
      }
      return next;
    });
  }, [sampleCount]);

  // Batch search logic
  const handleBatchSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      toast.warning(tx('quality.enterBatchNumber', 'Please enter a batch number.'));
      return;
    }
    setIsSearching(true);
    try {
      const res = await API.get(`/quality/batches/search/?batch_number=${searchQuery.trim()}`);
      if (res.data.success && res.data.data.batch) {
        const b = res.data.data.batch;
        setMetadata((prev) => ({
          ...prev,
          batch_number: b.DistNumber || b.batch_number || searchQuery.trim(),
          item_code: b.ItemCode || b.item_code || '',
          item_name: b.ItemName || b.item_name || '',
          warehouse: b.WhsCode || b.warehouse || '',
          quantity: parseFloat(b.Quantity || b.quantity || 0),
          supplier_name: b.SupplierName || b.supplier_name || '',
          farm_origin: b.FarmOrigin || b.farm_origin || '',
          contractor_name: b.ContractorName || b.contractor_name || '',
          car_number: b.CarNumber || b.car_number || '',
        }));
        toast.success(tx('quality.batchFound', 'Batch details loaded successfully.'));
        setStep(1);
      } else {
        toast.warning(tx('quality.batchNotFound', 'Batch not found. Continuing with manual input.'));
        setMetadata((prev) => ({
          ...prev,
          batch_number: searchQuery.trim(),
        }));
        setStep(1);
      }
    } catch (err) {
      console.error(err);
      toast.warning(tx('quality.searchFailed', 'Error searching batch details. Continuing with manual input.'));
      setMetadata((prev) => ({
        ...prev,
        batch_number: searchQuery.trim(),
      }));
      setStep(1);
    } finally {
      setIsSearching(false);
    }
  };

  // Validation
  const validateMetadata = () => {
    const errs = {};
    if (!metadata.batch_number) errs.batch_number = t('quality.batchRequired');
    if (!metadata.inspector_name) errs.inspector_name = t('quality.inspectorRequired');
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Defect quantities handlers
  const handleDefectToggle = (sampleIdx, defectKey, isChecked) => {
    setSamples((prev) => {
      const next = [...prev];
      const s = { ...next[sampleIdx] };
      s.defects = { ...s.defects };
      s.defects[defectKey] = isChecked ? 1 : 0;
      next[sampleIdx] = s;
      return next;
    });
  };

  const handleDefectChange = (sampleIdx, defectKey, delta) => {
    setSamples((prev) => {
      const next = [...prev];
      const s = { ...next[sampleIdx] };
      s.defects = { ...s.defects };
      const currentVal = s.defects[defectKey] || 0;
      s.defects[defectKey] = Math.max(0, currentVal + delta);
      next[sampleIdx] = s;
      return next;
    });
  };

  const handleDefectInputChange = (sampleIdx, defectKey, value) => {
    const intVal = parseInt(value, 10) || 0;
    setSamples((prev) => {
      const next = [...prev];
      const s = { ...next[sampleIdx] };
      s.defects = { ...s.defects };
      s.defects[defectKey] = Math.max(0, intVal);
      next[sampleIdx] = s;
      return next;
    });
  };

  // Calculations for Excel-aligned summary
  const calculatedMetrics = useMemo(() => {
    const totals = {
      acarus: 0, scale_insect: 0, spray_marks: 0, citrus_rust: 0, thrips: 0,
      vegetable_defects: 0, gummosis: 0, oil_spots: 0, sunburn: 0, sooty_mold: 0,
      mealybug: 0, tearing: 0, high_cut: 0, bruises: 0, cuts: 0, under_size: 0,
      venting: 0, fruit_fly: 0, creasing: 0, fall_drop: 0, mutations: 0,
      navel_blight: 0, softness: 0, molds: 0, grade_1: 0, grade_2: 0
    };

    samples.forEach((s) => {
      Object.keys(totals).forEach((k) => {
        totals[k] += (s.defects?.[k] || 0);
      });
    });

    // AF = sum of pests + mutations
    const sumAF = AF_KEYS.reduce((acc, k) => acc + (totals[k] || 0), 0);
    // AG = sum of mechanical + other physiological + molds
    const sumAG = AG_KEYS.reduce((acc, k) => acc + (totals[k] || 0), 0);
    // AH = grand total (AF + AG)
    const sumAH = sumAF + sumAG;

    const avgDefects = sampleCount > 0 ? (sumAH / sampleCount).toFixed(2) : '0.00';

    // Bruises and cuts % = (bruises + cuts) / sampleCount * 100
    const combinedBruisesCuts = (totals['bruises'] || 0) + (totals['cuts'] || 0);
    const pctBruisesCuts = sampleCount > 0 ? ((combinedBruisesCuts / sampleCount) * 100).toFixed(1) : '0.0';

    // High cut % = high_cut / sampleCount * 100
    const pctHighCut = sampleCount > 0 ? (((totals['high_cut'] || 0) / sampleCount) * 100).toFixed(1) : '0.0';

    // Quarantine violation: if molds > 0
    const quarantineViolation = (totals['molds'] || 0) > 0;

    // Decision calculations
    let decision = 'Approved';
    if (quarantineViolation) {
      decision = 'Rejected (Quarantine Violation)';
    } else if (parseFloat(pctBruisesCuts) > 10.0 || parseFloat(pctHighCut) > 15.0) {
      decision = 'Rejected (Defect limits exceeded)';
    } else if (parseFloat(pctBruisesCuts) > 5.0 || parseFloat(pctHighCut) > 8.0) {
      decision = 'Conditional Release (Consult QA Admin)';
    }

    return {
      totals,
      sumAF,
      sumAG,
      sumAH,
      avgDefects,
      pctBruisesCuts,
      pctHighCut,
      quarantineViolation,
      decision,
    };
  }, [samples, sampleCount]);

  // Submit report to server
  const handleSubmitReport = async () => {
    setIsSubmitting(true);
    try {
      const payload = {
        metadata: {
          ...metadata,
          sample_size: sampleCount,
          af_waste_total: calculatedMetrics.sumAF,
          ag_quality_total: calculatedMetrics.sumAG,
          ah_grand_total: calculatedMetrics.sumAH,
          average_defects_per_sample: parseFloat(calculatedMetrics.avgDefects),
          combined_bruises_cuts_percentage: parseFloat(calculatedMetrics.pctBruisesCuts),
          high_cut_percentage: parseFloat(calculatedMetrics.pctHighCut),
          quarantine_violation: calculatedMetrics.quarantineViolation,
          decision: calculatedMetrics.decision,
        },
        samples: samples.map((s) => ({
          id: s.id,
          defects: s.defects,
        })),
      };

      const res = await API.post('/quality/inspections/create/', payload);
      if (res.data.success) {
        toast.success(tx('quality.submitSuccess', 'Quality Inspection report created and saved to review.'));
        setSubmittedData(res.data.data.inspection);
        setStep(5 + sampleCount); // Jump to printable Done page
      } else {
        toast.error(res.data.error || tx('quality.submitFailed', 'Failed to submit inspection report.'));
      }
    } catch (err) {
      console.error(err);
      toast.error(tx('quality.submitNetworkError', 'Network error submitting inspection report.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset wizard
  const handleReset = () => {
    if (window.confirm(t('quality.resetConfirm'))) {
      setStep(0);
      setSearchQuery('');
      setMetadata({
        inspection_date: new Date().toISOString().split('T')[0],
        inspector_name: '',
        data_clerk_name: user?.username || '',
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
        warehouse: '',
        quantity: 0,
      });
      setSampleCount(5);
      setSamples([]);
      setSubmittedData(null);
    }
  };

  const qualityPhase = getQualityPhase(step, sampleCount);

  return (
    <div className="page-shell quality-wizard">
      <QualityStepBar phase={qualityPhase} t={t} />

      {/* Step 0: Search Batch */}
      {step === 0 && (
        <section className="card-panel card-panel--narrow">
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
        </section>
      )}

      {/* Step 1: Inspection Info */}
      {step === 1 && (
        <section className="card-panel card-panel--lg">
          <div className="page-header__content" style={{ marginBottom: '16px' }}>
            <span className="section-kicker">{t('quality.headerKicker')}</span>
            <h1 className="page-title">📝 {t('quality.stepInfo')}</h1>
            <p className="page-copy">{t('quality.infoDesc')}</p>
          </div>

          <div className="quality-form-grid">
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
              <label htmlFor="quality-data-clerk">{t('quality.dataClerkName')}</label>
              <input
                id="quality-data-clerk"
                className="app-input"
                type="text"
                value={metadata.data_clerk_name}
                disabled
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-batch-number">{t('quality.batchNumber')}</label>
              <input
                id="quality-batch-number"
                className="app-input"
                type="text"
                value={metadata.batch_number}
                disabled
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-item-code">{t('quality.itemCode')}</label>
              <input
                id="quality-item-code"
                className="app-input"
                type="text"
                value={metadata.item_code}
                onChange={(e) => setMetadata({ ...metadata, item_code: e.target.value })}
                placeholder={t('quality.itemCodePlaceholder')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-product-name">{t('quality.productName')}</label>
              <input
                id="quality-product-name"
                className="app-input"
                type="text"
                value={metadata.item_name}
                onChange={(e) => setMetadata({ ...metadata, item_name: e.target.value })}
                placeholder={t('quality.productName')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-supplier-name">{t('quality.supplierName')}</label>
              <input
                id="quality-supplier-name"
                className="app-input"
                type="text"
                value={metadata.supplier_name}
                onChange={(e) => setMetadata({ ...metadata, supplier_name: e.target.value })}
                placeholder={t('quality.supplierName')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-farm-origin">{t('quality.farmOrigin')}</label>
              <input
                id="quality-farm-origin"
                className="app-input"
                type="text"
                value={metadata.farm_origin}
                onChange={(e) => setMetadata({ ...metadata, farm_origin: e.target.value })}
                placeholder={t('quality.farmOrigin')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-contractor-name">{t('quality.contractorName')}</label>
              <input
                id="quality-contractor-name"
                className="app-input"
                type="text"
                value={metadata.contractor_name}
                onChange={(e) => setMetadata({ ...metadata, contractor_name: e.target.value })}
                placeholder={t('quality.contractorName')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-car-number">{t('quality.carNumber')}</label>
              <input
                id="quality-car-number"
                className="app-input"
                type="text"
                value={metadata.car_number}
                onChange={(e) => setMetadata({ ...metadata, car_number: e.target.value })}
                placeholder={t('quality.carNumber')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-crop-name">{t('quality.cropName')}</label>
              <input
                id="quality-crop-name"
                className="app-input"
                type="text"
                value={metadata.crop_name}
                onChange={(e) => setMetadata({ ...metadata, crop_name: e.target.value })}
                placeholder={t('quality.cropNamePlaceholder')}
              />
            </div>
            <div className="form-field">
              <label htmlFor="quality-raw-material-type">{t('quality.rawMaterialType')}</label>
              <input
                id="quality-raw-material-type"
                className="app-input"
                type="text"
                value={metadata.raw_material_type}
                onChange={(e) => setMetadata({ ...metadata, raw_material_type: e.target.value })}
                placeholder={t('quality.rawMaterialPlaceholder')}
              />
            </div>
            <div className="form-field quality-form-field--full">
              <label htmlFor="quality-notes">{t('quality.additionalNotes')}</label>
              <textarea
                id="quality-notes"
                className="app-input"
                rows={3}
                value={metadata.notes}
                onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })}
                placeholder={t('quality.notesPlaceholder')}
              />
            </div>
          </div>

          <div className="wizard-nav-row">
            <button type="button" className="app-button app-button--secondary wizard-nav-btn" onClick={() => setStep(0)}>
              {t('common.back')}
            </button>
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn"
              onClick={() => {
                if (validateMetadata()) setStep(2);
              }}
            >
              {t('common.next')}
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Sample Setup */}
      {step === 2 && (
        <section className="card-panel card-panel--narrow">
          <div className="page-header__content" style={{ marginBottom: '16px' }}>
            <span className="section-kicker">{t('quality.headerKicker')}</span>
            <h1 className="page-title">🔢 {t('quality.stepCount')}</h1>
            <p className="page-copy">{t('quality.sampleSetupDesc')}</p>
          </div>

          <div className="quality-sample-setup">
            <label htmlFor="quality-sample-count">{t('quality.sampleCountQuestion')}</label>
            <div className="counter-input">
              <button
                type="button"
                className="counter-btn"
                onClick={() => setSampleCount((c) => Math.max(1, c - 1))}
                aria-label={t('quality.decreaseSamples')}
              >
                -
              </button>
              <input
                id="quality-sample-count"
                type="number"
                className="app-input"
                value={sampleCount}
                onChange={(e) => setSampleCount(Math.max(1, parseInt(e.target.value, 10) || 5))}
              />
              <button
                type="button"
                className="counter-btn"
                onClick={() => setSampleCount((c) => Math.min(150, c + 1))}
                aria-label={t('quality.increaseSamples')}
              >
                +
              </button>
            </div>
            <p className="form-field__hint">
              {t('quality.sampleSetupHint')}
            </p>
          </div>

          <div className="wizard-nav-row">
            <button type="button" className="app-button app-button--secondary wizard-nav-btn" onClick={() => setStep(1)}>
              {t('common.back')}
            </button>
            <button type="button" className="app-button app-button--primary wizard-nav-btn" onClick={() => setStep(3)}>
              {t('quality.startDefects')}
            </button>
          </div>
        </section>
      )}

      {/* Steps 3 to 2+S: Inspect Sample X */}
      {step >= 3 && step < 3 + sampleCount && (() => {
        const sampleIdx = step - 3;
        const currentSample = samples[sampleIdx] || { defects: {} };

        return (
          <section className="card-panel quality-wizard-card--wide">
            <div className="quality-wizard-heading quality-sample-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div className="page-header__content">
                <span className="section-kicker">{t('quality.headerKicker')}</span>
                <h1 className="page-title">🧪 {t('quality.inspectingSample', sampleIdx + 1)}</h1>
                <p className="page-copy">{t('quality.sampleEntryDesc')}</p>
              </div>
              <span className="sample-completion-badge" style={{ backgroundColor: 'var(--color-primary-soft)', color: 'var(--color-primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                {t('quality.sampleOf', sampleIdx + 1, sampleCount)}
              </span>
            </div>

            <div className="defects-category-grid">
              {Object.entries(DEFECT_CATEGORIES).map(([catKey, cat]) => (
                <div className="category-card" key={catKey}>
                  <div className={`category-card-header ${cat.class}`}>
                    <span className="category-card-title">{tx(cat.titleKey, cat.titleDefault)}</span>
                  </div>
                  <div className="category-card-body">
                    {cat.items.map((item) => {
                      const value = currentSample.defects[item.key] || 0;
                      const isChecked = value > 0;

                      return (
                        <div className="defect-input-row" key={item.key}>
                          <label className="defect-label-side">
                            <span className="custom-checkbox-container">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => handleDefectToggle(sampleIdx, item.key, e.target.checked)}
                              />
                              <span className="checkmark"></span>
                            </span>
                            <span className="defect-name">{t('quality.defects.' + item.key) || item.name}</span>
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
                onClick={() => setStep(step + 1)}
              >
                {step === 2 + sampleCount ? t('quality.finishInspection') : t('quality.nextSample')}
              </button>
            </div>
          </section>
        );
      })()}

      {/* Step 3+S: Review Summary */}
      {step === 3 + sampleCount && (
        <section className="card-panel card-panel--lg">
          <div className="page-header__content" style={{ marginBottom: '16px' }}>
            <span className="section-kicker">{t('quality.headerKicker')}</span>
            <h1 className="page-title">📋 {t('quality.stepReview')}</h1>
            <p className="page-copy">{t('quality.reviewDesc')}</p>
          </div>

          <div className="quality-table-wrapper">
            <table className="quality-table">
              <thead>
                <tr>
                  <th>{t('quality.sampleNumber')}</th>
                  <th>{t('quality.sampleDefectsTotal')}</th>
                  <th>{t('quality.breakdown')}</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => {
                  const activeDefects = Object.entries(s.defects)
                    .filter(([_, qty]) => qty > 0)
                    .map(([k, qty]) => {
                      const translatedName = t('quality.defects.' + k);
                      return `${translatedName} (${qty})`;
                    });

                  const totalQty = Object.values(s.defects).reduce((sum, qty) => sum + qty, 0);
                  const defectSummary = activeDefects.length > 0
                    ? activeDefects.join(', ')
                    : t('quality.noDefectsRecorded');

                  return (
                    <tr key={s.id}>
                      <td className="quality-table__sample">{t('quality.sampleLabel', s.id)}</td>
                      <td className="quality-table__num">{totalQty}</td>
                      <td>{defectSummary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="wizard-nav-row">
            <button type="button" className="app-button app-button--secondary wizard-nav-btn" onClick={() => setStep(step - 1)}>
              {t('common.back')}
            </button>
            <button type="button" className="app-button app-button--primary wizard-nav-btn" onClick={() => setStep(step + 1)}>
              {t('quality.viewResultsDashboard')}
            </button>
          </div>
        </section>
      )}

      {/* Step 4+S: Results Dashboard */}
      {step === 4 + sampleCount && (
        <div className="quality-wizard-card--wide results-dashboard" style={{ display: 'grid', gap: '20px' }}>
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-val">{sampleCount}</span>
              <span className="kpi-label">{t('quality.totalSamples')}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-val">{calculatedMetrics.sumAH}</span>
              <span className="kpi-label">{t('quality.totalDefects')}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-val">{calculatedMetrics.avgDefects}</span>
              <span className="kpi-label">{t('quality.averageDefects')}</span>
            </div>
            <div className={`kpi-card kpi-card--${calculatedMetrics.decision.includes('Rejected') ? 'danger' : calculatedMetrics.decision.includes('Conditional') ? 'warning' : 'success'}`}>
              <span className="kpi-val kpi-val--decision">
                {calculatedMetrics.decision}
              </span>
              <span className="kpi-label">{t('quality.qaDecision')}</span>
            </div>
          </div>

          <section className="card-panel">
            <div className="page-header__content" style={{ marginBottom: '16px' }}>
              <span className="section-kicker">{t('quality.headerKicker')}</span>
              <h1 className="page-title">📊 {t('quality.stepResults')}</h1>
              <p className="page-copy">{t('quality.excelMatrixDesc')}</p>
            </div>
            
            <div className="excel-matrix-wrapper">
              <table className="excel-matrix-table">
                <thead>
                  <tr>
                    <th className="excel-matrix-table__first-col">{t('quality.defectCodeCategory')}</th>
                    {samples.map((s) => (
                      <th key={s.id}>S{s.id}</th>
                    ))}
                    <th>{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(DEFECT_CATEGORIES).map(([catKey, cat]) => (
                    <React.Fragment key={catKey}>
                      <tr className="excel-category-row">
                        <td colSpan={sampleCount + 2}>
                          {tx(cat.titleKey, cat.titleDefault)}
                        </td>
                      </tr>
                      {cat.items.map((item) => (
                        <tr key={item.key}>
                          <td className="defect-row-header">{t('quality.defects.' + item.key) || item.name}</td>
                          {samples.map((s) => (
                            <td key={s.id}>{s.defects[item.key] || 0}</td>
                          ))}
                          <td className="excel-matrix-table__total">{calculatedMetrics.totals[item.key] || 0}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  
                  {/* Totals Rows */}
                  <tr className="totals-row">
                    <td className="defect-row-header">{t('quality.wasteTotal')}</td>
                    {samples.map((s) => {
                      const sumS = AF_KEYS.reduce((acc, k) => acc + (s.defects[k] || 0), 0);
                      return <td key={s.id}>{sumS}</td>;
                    })}
                    <td>{calculatedMetrics.sumAF}</td>
                  </tr>
                  <tr className="totals-row">
                    <td className="defect-row-header">{t('quality.qualityTotal')}</td>
                    {samples.map((s) => {
                      const sumS = AG_KEYS.reduce((acc, k) => acc + (s.defects[k] || 0), 0);
                      return <td key={s.id}>{sumS}</td>;
                    })}
                    <td>{calculatedMetrics.sumAG}</td>
                  </tr>
                  <tr className="totals-row totals-row--grand">
                    <td className="defect-row-header">{t('quality.grandTotal')}</td>
                    {samples.map((s) => {
                      const sumS = Object.keys(s.defects).reduce((acc, k) => acc + (s.defects[k] || 0), 0);
                      return <td key={s.id}>{sumS}</td>;
                    })}
                    <td>{calculatedMetrics.sumAH}</td>
                  </tr>

                  {/* Percentages */}
                  <tr>
                    <td className="defect-row-header">{t('quality.pctBruisesCuts')}</td>
                    <td className="excel-matrix-table__summary" colSpan={sampleCount + 1}>
                      {calculatedMetrics.pctBruisesCuts}%
                    </td>
                  </tr>
                  <tr>
                    <td className="defect-row-header">{t('quality.pctHighCut')}</td>
                    <td className="excel-matrix-table__summary" colSpan={sampleCount + 1}>
                      {calculatedMetrics.pctHighCut}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {calculatedMetrics.quarantineViolation && (
              <div className="notes-report-box">
                <strong>{t('quality.quarantineViolation')}</strong>
                {t('quality.quarantineViolationDesc')}
              </div>
            )}
          </section>

          <div className="wizard-nav-row">
            <button type="button" className="app-button app-button--secondary wizard-nav-btn" onClick={() => setStep(step - 1)}>
              {t('common.back')}
            </button>
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn"
              onClick={handleSubmitReport}
              disabled={isSubmitting}
            >
              {isSubmitting ? t('quality.submitting') : t('quality.confirmSaveReport')}
            </button>
          </div>
        </div>
      )}

      {/* Step 5+S: Printable A4 Report & Done */}
      {step === 5 + sampleCount && submittedData && (
        <section className="card-panel quality-wizard-card--wide">
          <div className="page-header__content no-print" style={{ marginBottom: '16px' }}>
            <span className="section-kicker">{t('quality.headerKicker')}</span>
            <h1 className="page-title">🎉 {t('quality.stepPrint')}</h1>
            <p className="page-copy">{t('quality.submitSuccess')}</p>
          </div>

          <div className="quality-print-actions no-print">
            <button type="button" className="app-button app-button--secondary" onClick={() => window.print()}>
              {t('quality.printReport')}
            </button>
            <button type="button" className="app-button app-button--success" onClick={() => navigate('/')}>
              {t('quality.returnHome')}
            </button>
            <button type="button" className="app-button app-button--danger" onClick={handleReset}>
              {t('quality.startNewInspection')}
            </button>
          </div>

          {/* Printable Container */}
          <div className="print-layout-container">
            <div className="print-header">
              <div className="print-logo-box">EGAST</div>
              <div className="print-title">
                <h2>تقرير فحص الجودة / Quality Inspection Report</h2>
                <span style={{ fontSize: '0.8rem' }}>EGAST Quality Management System</span>
              </div>
              <div style={{ textAlign: 'left', fontSize: '0.8rem' }}>
                <div>رقم التقرير: #{submittedData.id}</div>
                <div>التاريخ: {submittedData.inspection_date}</div>
              </div>
            </div>

            <div className="print-metadata-grid">
              <div className="print-meta-item"><strong>رقم التشغيلة (Batch #):</strong> {submittedData.batch_number}</div>
              <div className="print-meta-item"><strong>كود المادة (Item Code):</strong> {submittedData.item_code}</div>
              <div className="print-meta-item"><strong>اسم المنتج (Product):</strong> {submittedData.item_name}</div>
              <div className="print-meta-item"><strong>المورد (Supplier):</strong> {submittedData.supplier_name}</div>
              <div className="print-meta-item"><strong>المزرعة (Farm):</strong> {submittedData.farm_origin}</div>
              <div className="print-meta-item"><strong>المقاول (Contractor):</strong> {submittedData.contractor_name}</div>
              <div className="print-meta-item"><strong>رقم السيارة (Car #):</strong> {submittedData.car_number}</div>
              <div className="print-meta-item"><strong>المحصول (Crop):</strong> {submittedData.crop_name}</div>
              <div className="print-meta-item"><strong>النوع (Type):</strong> {submittedData.raw_material_type}</div>
              <div className="print-meta-item"><strong>المفتش (Inspector):</strong> {submittedData.inspector_name}</div>
              <div className="print-meta-item"><strong>مدخل البيانات (Clerk):</strong> {submittedData.data_clerk_name}</div>
              <div className="print-meta-item"><strong>حجم العينة (Sample Size):</strong> {submittedData.sample_size} كجم</div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 'bold', margin: '0 0 10px 0' }}>ملخص العيوب والنتائج / Excel Summary Matrix</h3>
              <table className="excel-matrix-table" style={{ width: '100%', border: '1.5px solid black' }}>
                <thead>
                  <tr>
                    <th>الرمز / Defect</th>
                    {samples.map((s) => (
                      <th key={s.id}>ع{s.id}</th>
                    ))}
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(DEFECT_CATEGORIES).map(([catKey, cat]) => (
                    <React.Fragment key={catKey}>
                      <tr style={{ background: '#f3f4f6' }}>
                        <td colSpan={sampleCount + 2} style={{ textAlign: 'right', fontWeight: 800, fontSize: '0.85rem' }}>
                          {tx(cat.titleKey, cat.titleDefault)}
                        </td>
                      </tr>
                      {cat.items.map((item) => (
                        <tr key={item.key}>
                          <td style={{ textAlign: 'right', fontWeight: 700 }} className="defect-row-header">{t('quality.defects.' + item.key) || item.name}</td>
                          {samples.map((s) => (
                            <td key={s.id}>{s.defects[item.key] || 0}</td>
                          ))}
                          <td style={{ fontWeight: 'bold' }}>{calculatedMetrics.totals[item.key] || 0}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  
                  {/* Totals Rows */}
                  <tr className="totals-row" style={{ background: '#e5e7eb' }}>
                    <td style={{ textAlign: 'right' }}>إجمالي الهدر / Waste Total (AF)</td>
                    {samples.map((s) => {
                      const sumS = AF_KEYS.reduce((acc, k) => acc + (s.defects[k] || 0), 0);
                      return <td key={s.id}>{sumS}</td>;
                    })}
                    <td>{calculatedMetrics.sumAF}</td>
                  </tr>
                  <tr className="totals-row" style={{ background: '#e5e7eb' }}>
                    <td style={{ textAlign: 'right' }}>إجمالي الجودة / Quality Total (AG)</td>
                    {samples.map((s) => {
                      const sumS = AG_KEYS.reduce((acc, k) => acc + (s.defects[k] || 0), 0);
                      return <td key={s.id}>{sumS}</td>;
                    })}
                    <td>{calculatedMetrics.sumAG}</td>
                  </tr>
                  <tr className="totals-row" style={{ background: '#d1d5db', borderBottom: '4px double black' }}>
                    <td style={{ textAlign: 'right' }}>الإجمالي العام / Grand Total (AH)</td>
                    {samples.map((s) => {
                      const sumS = Object.keys(s.defects).reduce((acc, k) => acc + (s.defects[k] || 0), 0);
                      return <td key={s.id}>{sumS}</td>;
                    })}
                    <td>{calculatedMetrics.sumAH}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
              <div style={{ border: '1px solid #cbd5e1', padding: '15px', borderRadius: '4px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', fontWeight: 800 }}>حسابات النسب المئوية / Percentages</h4>
                <div style={{ fontSize: '0.85rem' }}>
                  <div>نسبة الكدمات والجروح (Bruises & Cuts Pct): <strong>{calculatedMetrics.pctBruisesCuts}%</strong></div>
                  <div>نسبة القص العالي (High Cut Pct): <strong>{calculatedMetrics.pctHighCut}%</strong></div>
                  <div>متوسط العيوب لكل عينة (Avg Defects): <strong>{calculatedMetrics.avgDefects}</strong></div>
                </div>
              </div>
              <div style={{ border: '1px solid #cbd5e1', padding: '15px', borderRadius: '4px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', fontWeight: 800 }}>قرار مراقبة الجودة / Quality Decision</h4>
                <div style={{ fontSize: '1.1rem', fontWeight: 900, color: submittedData.decision.includes('Rejected') ? 'red' : 'green' }}>
                  {submittedData.decision}
                </div>
              </div>
            </div>

            {submittedData.notes && (
              <div style={{ border: '1px solid #cbd5e1', padding: '15px', borderRadius: '4px', marginTop: '15px', fontSize: '0.85rem' }}>
                <strong>ملاحظات إضافية / Additional Notes:</strong>
                <p style={{ margin: '6px 0 0 0' }}>{submittedData.notes}</p>
              </div>
            )}

            <div className="print-signatures">
              <div className="signature-box">
                <div>مفتش الجودة / Quality Inspector</div>
                <div className="line"></div>
                <div style={{ fontWeight: 'bold' }}>{submittedData.inspector_name}</div>
              </div>
              <div className="signature-box">
                <div>مدير الجودة / QC Manager</div>
                <div className="line"></div>
              </div>
              <div className="signature-box">
                <div>المدير العام / General Manager</div>
                <div className="line"></div>
              </div>
            </div>
            
            <div className="report-footer-brand">
              EGAST ERP system — Quality Control Module
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default QualityWizard;
