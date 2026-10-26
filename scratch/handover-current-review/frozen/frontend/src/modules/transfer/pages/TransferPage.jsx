import { binSearch } from '../../../services/masterDataSearch';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useI18n } from '../../../contexts/I18nContext';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import { canManageTransfer } from '../../../utils/roles';
import { useTransferWorkflow } from '../hooks/useTransferWorkflow';
import { TransferStage, TransferStatus } from '../types/transferTypes';
import { fetchPhysicalBatch, confirmPhysicalTransfer } from '../services/transferService';
import ColdStorageMap from '../components/ColdStorageMap';
import { getProductIcon } from '../../../utils/productIcon';
import './TransferPage.css';

const STEP_STAGE       = 0;
const STEP_SOURCE      = 1;
const STEP_BATCHES     = 2;
const STEP_DESTINATION = 3;
const STEP_REVIEW      = 4;
const STEP_DONE        = 5;
const SCANNER_DEBOUNCE_MS = 500;
const MIN_AUTO_SCAN_LENGTH = 6;

const normalizeScanValue = (value) => String(value || '').trim().toUpperCase();

const isAutoScanCandidate = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed.length >= MIN_AUTO_SCAN_LENGTH && trimmed.includes('-');
};

const STEPS = [
  { labelKey: 'transfer.stepStage',       icon: '🔀' },
  { labelKey: 'transfer.stepSource',      icon: '🏭' },
  { labelKey: 'transfer.stepBatches',     icon: '🏷️' },
  { labelKey: 'transfer.stepDestination', icon: '🚚' },
  { labelKey: 'transfer.stepReview',      icon: '📋' },
  { labelKey: 'transfer.stepDone',        icon: '🎉' },
];

const STAGE_META = {
  [TransferStage.STAGE_1_TO_INTERMEDIATE]: {
    badgeKey:      'transfer.stage1Badge',
    titleKey:      'transfer.stage1Title',
    descKey:       'transfer.stage1Desc',
    fromLabelKey:  'transfer.fromStation',
    toLabelKey:    'transfer.toIntermediate',
  },
  [TransferStage.STAGE_2_TO_FRIDGE]: {
    badgeKey:      'transfer.stage2Badge',
    titleKey:      'transfer.stage2Title',
    descKey:       'transfer.stage2Desc',
    fromLabelKey:  'transfer.fromIntermediate',
    toLabelKey:    'transfer.toFridge',
  },
  [TransferStage.STAGE_3_FROM_FRIDGE]: {
    badgeKey:      'transfer.stage3Badge',
    titleKey:      'transfer.stage3Title',
    descKey:       'transfer.stage3Desc',
    fromLabelKey:  'transfer.fromFridge',
    toLabelKey:    'transfer.toDestination',
  },
  [TransferStage.STAGE_4_TO_DESTINATION]: {
    badgeKey:      'transfer.stage4Badge',
    titleKey:      'transfer.stage4Title',
    descKey:       'transfer.stage4Desc',
    fromLabelKey:  'transfer.fromWarehouse',
    toLabelKey:    'transfer.toDestination',
  },
  [TransferStage.STAGE_5_TO_CONTAINER]: {
    badgeKey:      'transfer.stage5Badge',
    titleKey:      'transfer.stage5Title',
    descKey:       'transfer.stage5Desc',
    fromLabelKey:  'transfer.fromWarehouse',
    toLabelKey:    'transfer.toContainer',
  },
};

const SOURCE_STATUS_LABELS = {
  SAP_AVAILABLE: 'transfer.status.sapAvailable',
  SAP_POSTED: 'transfer.status.sapPosted',
  LOCAL_PENDING_RECEIPT: 'transfer.status.localPendingReceipt',
  LOCAL_POSTED_RECEIPT: 'transfer.status.localPostedReceipt',
  PENDING_TRANSFER_CHAIN: 'transfer.status.pendingTransferChain',
  NOT_FOUND: 'transfer.status.notFound',
};

function sourceStatusLabel(line, t) {
  return (
    (SOURCE_STATUS_LABELS[line?.availabilityStatus] ? t(SOURCE_STATUS_LABELS[line.availabilityStatus]) : null) ||
    line?.sourceStatusLabel ||
    t('transfer.status.sapAvailable')
  );
}

function sourceStatusTone(line) {
  if (['SAP_AVAILABLE', 'SAP_POSTED'].includes(line?.availabilityStatus) || line?.canPostToSap) return 'sap';
  if (line?.availabilityStatus === 'NOT_FOUND') return 'missing';
  return 'local';
}

function StepBar({ currentStep, maxReachedStep, onStepClick }) {
  const stepbarRef = useRef(null);
  const { t } = useI18n();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const stepbar = stepbarRef.current;
    const activeStep = stepbar?.querySelector('.wizard-step--active');
    if (!stepbar || !activeStep) return;

    activeStep.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentStep]);

  return (
    <div className="wizard-stepbar-wrap" ref={stepbarRef}>
      {STEPS.map(({ labelKey, icon }, i) => {
        const label = t(labelKey);
        const isDone   = i < currentStep;
        const isActive = i === currentStep;
        const canClick = i < currentStep;
        const isLocked = i > maxReachedStep;
        const cls = [
          'wizard-step',
          isDone   ? 'wizard-step--done'      : '',
          isActive ? 'wizard-step--active'    : '',
          canClick ? 'wizard-step--clickable' : '',
          isLocked ? 'wizard-step--locked'    : '',
        ].filter(Boolean).join(' ');
        return (
          <React.Fragment key={label}>
            <div className={cls} onClick={() => canClick && onStepClick(i)}>
              <div className="wizard-step__circle">
                {isDone ? '✓' : icon}
              </div>
              <span className="wizard-step__label">{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`wizard-connector${isDone ? ' wizard-connector--done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function TransferPage({ operation = 'all' }) {
  const navigate = useNavigate();
  const scanRef = useRef(null);
  const inFlightScanRef = useRef('');
  const lastAutoScanRef = useRef('');
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const adminUser = canManageTransfer(user);

  const {
    stage, setStage,
    sourcePalletPositionRequired, destinationTypeRequired,
    allowedSourceMapBins, allowedDestinationMapBins,
    transferAccess,
    transferAccessLoading,
    availableFromWarehouses,
    availableToWarehouses,
    fromBins, toBins,
    fromWarehouse, setFromWarehouse,
    fromBin, setFromBin,
    sourcePalletPositionId,
    sourcePalletPositionCode,
    setSourcePalletPosition,
    toDestType, setToDestType,
    toWarehouse, setToWarehouse,
    toBin, setToBin,
    palletPositionId,
    palletPositionCode,
    setPalletPosition,
    batchLines,
    scanInput, setScanInput,
    scanStatus, scanError, scanBatch,
    removeLine,
    fromBinRequired, toBinRequired, destinationPalletPositionRequired,
    canSubmit, transferStatus, submitError, transferResult, destinationBinError, destinationBinLoading,
    submit, reset,
  } = useTransferWorkflow();

  const [currentStep, setCurrentStep]       = useState(STEP_STAGE);
  const [maxReachedStep, setMaxReachedStep] = useState(STEP_STAGE);
  const [destinationViewMode, setDestinationViewMode] = useState('map'); // 'map' | 'dropdown'
  const [sourceViewMode, setSourceViewMode] = useState('map'); // 'map' | 'dropdown'
  const [sourceBatchCandidate, setSourceBatchCandidate] = useState('');
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);

  // Stage 4 & 5 Physical Transfer states
  const [containerNumber, setContainerNumber] = useState('');
  const [physicalBatchLines, setPhysicalBatchLines] = useState([]);
  const [physicalScanStatus, setPhysicalScanStatus] = useState(TransferStatus.IDLE);
  const [physicalScanError, setPhysicalScanError] = useState('');
  const [physicalSubmitStatus, setPhysicalSubmitStatus] = useState(TransferStatus.IDLE);
  const [physicalSubmitError, setPhysicalSubmitError] = useState('');
  const [physicalResult, setPhysicalResult] = useState(null);

  const isPhysicalStage = stage === TransferStage.STAGE_5_TO_CONTAINER;
  useEffect(() => {
    if (operation === 'shipping' && stage !== TransferStage.STAGE_5_TO_CONTAINER) {
      setStage(TransferStage.STAGE_5_TO_CONTAINER);
      setCurrentStep(STEP_SOURCE);
      setMaxReachedStep(STEP_SOURCE);
    }
  }, [operation, stage, setStage]);
  const stage5Allowed = adminUser || Boolean(transferAccess?.rules?.some(rule => rule.is_active
    && rule.stage === TransferStage.STAGE_5_TO_CONTAINER && rule.direction === 'FROM'));
  const stage4Allowed = Boolean(adminUser || transferAccess?.allow_all || transferAccess?.rules?.some(
    rule => rule.is_active && rule.stage === TransferStage.STAGE_4_TO_DESTINATION,
  ));
  const simplifiedFlow = false;
  const noWarehouseAccess =
    !adminUser &&
    !transferAccessLoading &&
    transferAccess &&
    !transferAccess.allow_all &&
    !transferAccess.has_rules;
  const activeTransferResult = isPhysicalStage ? physicalResult : transferResult;

  useEffect(() => {
    if (!isPhysicalStage) return;
    setPhysicalBatchLines([]);
    setPhysicalScanError('');
    setPhysicalSubmitError('');
    setPhysicalResult(null);
  }, [isPhysicalStage, fromWarehouse]);

  useEffect(() => {
    if (activeTransferResult) {
      setCurrentStep(STEP_DONE);
      setMaxReachedStep(STEP_DONE);
    }
  }, [activeTransferResult]);

  useEffect(() => {
    if (!simplifiedFlow || activeTransferResult) return;
    if (currentStep !== STEP_BATCHES) {
      setCurrentStep(STEP_BATCHES);
      setMaxReachedStep(STEP_BATCHES);
    }
  }, [simplifiedFlow, activeTransferResult, currentStep]);

  useEffect(() => {
    if (currentStep === STEP_BATCHES) {
      if (sourceBatchCandidate && !scanInput && batchLines.length === 0) {
        setScanInput(sourceBatchCandidate);
      }
      if (scanRef.current) {
        scanRef.current.focus();
      }
    }
  }, [currentStep, sourceBatchCandidate, scanInput, batchLines.length, setScanInput]);

  const linesValid = isPhysicalStage
    ? physicalBatchLines.length > 0 && physicalBatchLines.every((l) => l.canConfirm && String(l.currentLocation || '').trim().toUpperCase() === String(fromWarehouse || '').trim().toUpperCase())
    : (batchLines.length > 0 && batchLines.every((l) => l.availableQuantity > 0));

  const isFridgeSource = sourcePalletPositionRequired;

  const physicalSourceAllowed = isPhysicalStage && availableFromWarehouses.some(warehouse => warehouse.code === fromWarehouse);
  const physicalCanSubmit = isPhysicalStage && linesValid && physicalSourceAllowed && Boolean(containerNumber.trim());

  const stepValid = {
    [STEP_STAGE]: Boolean(stage),
    [STEP_SOURCE]: isPhysicalStage ? physicalSourceAllowed : (
      Boolean(fromWarehouse) &&
      (!fromBinRequired || Boolean(fromBin)) &&
      (!isFridgeSource || Boolean(sourcePalletPositionId))
    ),
    [STEP_BATCHES]: linesValid,
    [STEP_DESTINATION]: isPhysicalStage
      ? Boolean(containerNumber.trim())
      : (
        !destinationBinLoading && !destinationBinError &&
        (!destinationTypeRequired || Boolean(toDestType)) &&
        Boolean(toWarehouse) &&
        (!toBinRequired || Boolean(toBin)) &&
        (!destinationPalletPositionRequired || Boolean(palletPositionId))
      ),
    [STEP_REVIEW]: isPhysicalStage ? physicalCanSubmit : canSubmit,
    [STEP_DONE]: true,
  };

  const goTo = (step) => {
    setCurrentStep(step);
    if (step > maxReachedStep) setMaxReachedStep(step);
  };

  const next = () => {
    if (stepValid[currentStep] && currentStep < STEP_DONE) goTo(currentStep + 1);
  };

  const selectStageAndContinue = (nextStage) => {
    if (nextStage === TransferStage.STAGE_5_TO_CONTAINER) {
      navigate('/shipping-loading');
      return;
    }
    setStage(nextStage);
    setPhysicalBatchLines([]);
    setContainerNumber('');
    setPhysicalScanError('');
    setPhysicalSubmitError('');
    setPhysicalResult(null);
    goTo(STEP_SOURCE);
  };

  const handleStageKeyDown = (event, nextStage) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectStageAndContinue(nextStage);
    }
  };

  const back = () => {
    if (currentStep > STEP_STAGE) setCurrentStep(currentStep - 1);
  };

  const handleReset = () => {
    reset();
    setPhysicalBatchLines([]);
    setContainerNumber('');
    setPhysicalScanError('');
    setPhysicalSubmitError('');
    setPhysicalResult(null);
    setMapRefreshTrigger((prev) => prev + 1);
    setCurrentStep(simplifiedFlow ? STEP_BATCHES : STEP_STAGE);
    setMaxReachedStep(simplifiedFlow ? STEP_BATCHES : STEP_STAGE);
    inFlightScanRef.current = '';
    lastAutoScanRef.current = '';
  };

  const hasBatchLine = useCallback((value) => {
    const normalized = normalizeScanValue(value);
    if (isPhysicalStage) {
      return physicalBatchLines.some((l) => normalizeScanValue(l.batchNumber) === normalized);
    }
    return batchLines.some((line) => normalizeScanValue(line.batchNumber) === normalized);
  }, [batchLines, physicalBatchLines, isPhysicalStage]);

  const handleScanPhysicalBatch = useCallback(async (value = scanInput) => {
    const normalized = normalizeScanValue(value);
    if (!normalized || physicalScanStatus === TransferStatus.LOADING) return;
    if (inFlightScanRef.current === normalized) return;

    inFlightScanRef.current = normalized;
    setPhysicalScanStatus(TransferStatus.LOADING);
    setPhysicalScanError('');
    try {
      const data = await fetchPhysicalBatch(normalized);
      const pallet = data?.pallet;
      const currentLocation = data?.current_location || pallet?.physical_location;
      const sourceOperation = data?.source_operation || (pallet?.source_operation ? pallet.source_operation : null);

      let canConfirm = true;
      let warningMessage = '';

      if (stage === TransferStage.STAGE_5_TO_CONTAINER) {
        if (pallet?.state === 'LOADED_TO_CONTAINER' || pallet?.container_number) {
          canConfirm = false;
          warningMessage = t('transfer.alreadyLoadedToContainer');
        } else if (!currentLocation) {
          canConfirm = false;
          warningMessage = t('physicalTransfer.locationUnavailable');
        } else if (String(currentLocation).trim().toUpperCase() !== String(fromWarehouse).trim().toUpperCase()) {
          canConfirm = false;
          warningMessage = t('physicalTransfer.sourceMismatch', currentLocation);
        }
      }

      setPhysicalBatchLines([
        {
          batchNumber: normalized,
          state: data?.current_state || pallet?.state || 'UNKNOWN',
          currentLocation: currentLocation || '',
          containerNumber: pallet?.container_number || null,
          sourceOperation,
          canConfirm,
          warningMessage,
        },
      ]);
      setScanInput('');
    } catch (err) {
      setPhysicalScanError(err.response?.data?.error || t('physicalTransfer.loadFailed'));
    } finally {
      setPhysicalScanStatus(TransferStatus.IDLE);
      inFlightScanRef.current = '';
      window.requestAnimationFrame(() => {
        scanRef.current?.focus();
      });
    }
  }, [scanInput, physicalScanStatus, stage, fromWarehouse, t, setScanInput]);

  const handleScanBatch = useCallback(async (value = scanInput) => {
    if (isPhysicalStage) {
      return handleScanPhysicalBatch(value);
    }
    const normalized = normalizeScanValue(value);
    if (!normalized || scanStatus === TransferStatus.LOADING) return;
    if (inFlightScanRef.current === normalized) return;

    inFlightScanRef.current = normalized;
    try {
      await scanBatch(value);
    } finally {
      inFlightScanRef.current = '';
      window.requestAnimationFrame(() => {
        scanRef.current?.focus();
      });
    }
  }, [isPhysicalStage, handleScanPhysicalBatch, scanBatch, scanInput, scanStatus]);

  const handleConfirmPhysical = async () => {
    if (!isPhysicalStage || !physicalCanSubmit) return;
    const line = physicalBatchLines[0];
    if (!line) return;

    setPhysicalSubmitStatus(TransferStatus.LOADING);
    setPhysicalSubmitError('');
    try {
      const data = await confirmPhysicalTransfer(5, line.batchNumber, containerNumber.trim(), fromWarehouse);
      setPhysicalResult({
        stage,
        fromWarehouse,
        destinationLocation: `CONTAINER: ${containerNumber.trim()}`,
        reference: data?.event?.reference,
        event: data?.event,
        pallet: data?.pallet,
        containerNumber: containerNumber.trim(),
        lines: [
          {
            batchNumber: line.batchNumber,
            quantity: 1,
            uom: 'PLT',
          },
        ],
        isPhysical: true,
      });
      setCurrentStep(STEP_DONE);
      setMaxReachedStep(STEP_DONE);
    } catch (err) {
      setPhysicalSubmitError(err.response?.data?.error || t('physicalTransfer.saveFailed'));
    } finally {
      setPhysicalSubmitStatus(TransferStatus.IDLE);
    }
  };

  useEffect(() => {
    if (currentStep !== STEP_BATCHES) return undefined;

    const candidate = scanInput.trim();
    const normalized = normalizeScanValue(candidate);
    if (!candidate) {
      lastAutoScanRef.current = '';
      return undefined;
    }
    if (
      !isAutoScanCandidate(candidate) ||
      (isPhysicalStage ? physicalScanStatus === TransferStatus.LOADING : scanStatus === TransferStatus.LOADING) ||
      inFlightScanRef.current === normalized ||
      lastAutoScanRef.current === normalized ||
      hasBatchLine(candidate)
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      lastAutoScanRef.current = normalized;
      handleScanBatch(candidate);
    }, SCANNER_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [currentStep, scanInput, scanStatus, physicalScanStatus, isPhysicalStage, hasBatchLine, handleScanBatch]);

  const rawStageMeta = stage ? STAGE_META[stage] : null;
  const stageMeta = rawStageMeta ? {
    badge: t(rawStageMeta.badgeKey),
    title: t(rawStageMeta.titleKey),
    desc: t(rawStageMeta.descKey),
    fromLabel: t(rawStageMeta.fromLabelKey),
    toLabel: t(rawStageMeta.toLabelKey),
  } : null;

  const submitButtonText = isPhysicalStage
    ? t('transfer.confirmLoad')
    : (adminUser ? t('transfer.createInventoryTransfer') : t('transfer.submitForReview'));

  const loadingButtonText = isPhysicalStage
    ? t('common.loading')
    : (adminUser ? t('transfer.postingToSap') : t('transfer.submitting'));

  const hasLocalReceiptLines = !isPhysicalStage && batchLines.some((line) => !line.canPostToSap);

  const destStepTitle = isPhysicalStage
    ? t('transfer.toContainer')
    : (stage !== TransferStage.STAGE_2_TO_FRIDGE
      ? (stageMeta?.toLabel ?? t('transfer.selectDestinationTitle'))
      : toDestType === 'intermediate'
      ? t('transfer.toIntermediate')
      : toDestType === 'fridge'
      ? t('transfer.toFridgeStocking')
      : t('transfer.selectDestinationTitle'));

  const stepTitles = [
    t('transfer.selectStageTitle'),
    stageMeta ? stageMeta.fromLabel : t('transfer.selectSourceTitle'),
    t('transfer.scanBatchesTitle'),
    destStepTitle,
    t('transfer.reviewSubmitTitle'),
    t('transfer.completeTitle'),
  ];

  const stepSubtitles = [
    t('transfer.chooseTransferFlow'),
    isPhysicalStage
      ? t('transfer.stage5Desc')
      : (stage === TransferStage.STAGE_4_TO_DESTINATION ? t('transfer.stage4Desc') : t('transfer.selectSourceWarehouse')),
    t('transfer.scanBatchNumbers'),
    isPhysicalStage
      ? t('transfer.enterContainerNumber')
      : (stage === TransferStage.STAGE_2_TO_FRIDGE && !toDestType
        ? t('transfer.chooseMoveTarget')
        : t('transfer.selectDestinationWarehouse')),
    t('transfer.confirmTransferDetails'),
    '',
  ];

  const displayFromWarehouse = fromWarehouse;

  const displayToWarehouse = isPhysicalStage
    ? (containerNumber.trim() ? `CONTAINER: ${containerNumber.trim()}` : t('transfer.toContainer'))
    : toWarehouse;

  const activeSubmit = isPhysicalStage ? handleConfirmPhysical : submit;
  const activeCanSubmit = isPhysicalStage ? physicalCanSubmit : canSubmit;
  const activeSubmitStatus = isPhysicalStage ? physicalSubmitStatus : transferStatus;
  const activeSubmitError = isPhysicalStage ? physicalSubmitError : submitError;

  return (
    <div className="page-shell transfer-page">
      <header className="page-header">
        <div className="page-header__content">
          <span className="section-kicker">{t('transfer.headerKicker')}</span>
          <h1 className="page-title">{operation === 'shipping' ? t('physicalTransfer.shippingDelivery') : t('transfer.title')}</h1>
        </div>
      </header>
      {destinationBinLoading && <div role="status">{t('common.loading')}</div>}
      {destinationBinError && <div role="alert" className="feedback-message feedback-message--error">{destinationBinError}</div>}

      {adminUser && (
        <StepBar
          currentStep={currentStep}
          maxReachedStep={maxReachedStep}
          onStepClick={goTo}
        />
      )}

      {noWarehouseAccess && !isPhysicalStage && (
        <div className="feedback-message feedback-message--error transfer-access-message">
          {transferAccess.message || t('transfer.noWarehouseAccess')}
        </div>
      )}

      {!adminUser && transferAccessLoading && !isPhysicalStage && (
        <div className="feedback-message feedback-message--info transfer-access-message">
          {t('common.loading')}
        </div>
      )}

      <section className="card-panel transfer-wizard-card">

        {/* Step heading */}
        {currentStep < STEP_DONE && (
          <div className="transfer-wizard-heading">
            <h2 className="transfer-wizard-title">{stepTitles[currentStep]}</h2>
            {stepSubtitles[currentStep] && (
              <p className="transfer-wizard-subtitle">{stepSubtitles[currentStep]}</p>
            )}
          </div>
        )}

        {/* ── Step 0: Stage ──────────────────────────────────────────── */}
        {currentStep === STEP_STAGE && (
          <div className="transfer-stage-grid">
            {operation !== 'shipping' && <>
            <button
              type="button"
              className={[
                'transfer-stage-btn',
                stage === TransferStage.STAGE_1_TO_INTERMEDIATE ? 'transfer-stage-btn--active' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={stage === TransferStage.STAGE_1_TO_INTERMEDIATE}
              onClick={() => selectStageAndContinue(TransferStage.STAGE_1_TO_INTERMEDIATE)}
              onKeyDown={(event) => handleStageKeyDown(event, TransferStage.STAGE_1_TO_INTERMEDIATE)}
            >
              <span className="transfer-stage-badge">{t('transfer.stage1Badge')}</span>
              <span className="transfer-stage-label">{t('transfer.stage1Title')}</span>
              <span className="transfer-stage-desc">
                {t('transfer.stage1Desc')}
              </span>
            </button>

            <button
              type="button"
              className={[
                'transfer-stage-btn',
                stage === TransferStage.STAGE_2_TO_FRIDGE ? 'transfer-stage-btn--active' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={stage === TransferStage.STAGE_2_TO_FRIDGE}
              onClick={() => selectStageAndContinue(TransferStage.STAGE_2_TO_FRIDGE)}
              onKeyDown={(event) => handleStageKeyDown(event, TransferStage.STAGE_2_TO_FRIDGE)}
            >
              <span className="transfer-stage-badge">{t('transfer.stage2Badge')}</span>
              <span className="transfer-stage-label">{t('transfer.stage2Title')}</span>
              <span className="transfer-stage-desc">
                {t('transfer.stage2Desc')}
              </span>
            </button>

            <button
              type="button"
              className={[
                'transfer-stage-btn',
                stage === TransferStage.STAGE_3_FROM_FRIDGE ? 'transfer-stage-btn--active' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={stage === TransferStage.STAGE_3_FROM_FRIDGE}
              onClick={() => selectStageAndContinue(TransferStage.STAGE_3_FROM_FRIDGE)}
              onKeyDown={(event) => handleStageKeyDown(event, TransferStage.STAGE_3_FROM_FRIDGE)}
            >
              <span className="transfer-stage-badge">{t('transfer.stage3Badge')}</span>
              <span className="transfer-stage-label">{t('transfer.stage3Title')}</span>
              <span className="transfer-stage-desc">
                {t('transfer.stage3Desc')}
              </span>
            </button>

            {stage4Allowed && <button
              type="button"
              className={[
                'transfer-stage-btn',
                stage === TransferStage.STAGE_4_TO_DESTINATION ? 'transfer-stage-btn--active' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={stage === TransferStage.STAGE_4_TO_DESTINATION}
              onClick={() => selectStageAndContinue(TransferStage.STAGE_4_TO_DESTINATION)}
              onKeyDown={(event) => handleStageKeyDown(event, TransferStage.STAGE_4_TO_DESTINATION)}
            >
              <span className="transfer-stage-badge">{t('transfer.stage4Badge')}</span>
              <span className="transfer-stage-label">{t('transfer.stage4Title')}</span>
              <span className="transfer-stage-desc">
                {t('transfer.stage4Desc')}
              </span>
            </button>}

            </>}
            {operation !== 'internal' && stage5Allowed && <button
              type="button"
              className={[
                'transfer-stage-btn',
                stage === TransferStage.STAGE_5_TO_CONTAINER ? 'transfer-stage-btn--active' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={stage === TransferStage.STAGE_5_TO_CONTAINER}
              onClick={() => selectStageAndContinue(TransferStage.STAGE_5_TO_CONTAINER)}
              onKeyDown={(event) => handleStageKeyDown(event, TransferStage.STAGE_5_TO_CONTAINER)}
            >
              <span className="transfer-stage-badge">{t('transfer.stage5Badge')}</span>
              <span className="transfer-stage-label">{t('transfer.stage5Title')}</span>
              <span className="transfer-stage-desc">
                {t('transfer.stage5Desc')}
              </span>
            </button>}
          </div>
        )}

        {/* ── Step 1: Source ─────────────────────────────────────────── */}
        {currentStep === STEP_SOURCE && isPhysicalStage && (
          <div className="transfer-form-grid">
            <div className="form-field">
              <label htmlFor="t-from-wh">
                {t('transfer.fromWarehouse')}
              </label>
              <SearchableSelect
                id="t-from-wh"
                searchInDropdown
                className="app-select"
                disabled={availableFromWarehouses.length === 0}
                value={fromWarehouse}
                onChange={(e) => setFromWarehouse(e.target.value)}
                placeholder={t('transfer.selectSourceWarehouse')}
              >
                <option value="">
                  {t('transfer.selectSourceWarehouse')}
                </option>
                {availableFromWarehouses.map((w) => (
                  <option key={w.code} value={w.code} data-search={[w.name, w.name_ar, w.name_en].filter(Boolean).join(' ')}>
                    {w.code} - {w.name}
                  </option>
                ))}
              </SearchableSelect>
            </div>
          </div>
        )}

        {currentStep === STEP_SOURCE && !isPhysicalStage && (
          <div className="transfer-form-grid">
            <div className="form-field">
              <label htmlFor="t-from-wh">
                {stageMeta?.fromLabel ?? t('transfer.fromWarehouse')}
              </label>
              <SearchableSelect
                id="t-from-wh"
                className="app-select"
                searchInDropdown
                value={fromWarehouse}
                onChange={(e) => setFromWarehouse(e.target.value)}
                disabled={availableFromWarehouses.length === 0}
                placeholder={stageMeta?.fromLabel ?? t('transfer.fromWarehouse')}
              >
                <option value="">
                  {availableFromWarehouses.length === 0
                    ? t('transfer.noWarehousesAvailable')
                    : t('transfer.selectSourceWarehouse')}
                </option>
                {availableFromWarehouses.map((w) => (
                  <option key={w.code} value={w.code} data-search={[w.name, w.name_ar, w.name_en].filter(Boolean).join(' ')}>
                    {w.code} - {w.name}
                  </option>
                ))}
              </SearchableSelect>
            </div>

            {fromBinRequired && !sourcePalletPositionRequired && (
              <div className="form-field">
                <label htmlFor="t-from-bin">{t('transfer.fromBin')}</label>
                <SearchableSelect
                  id="t-from-bin"
                  className="app-select"
                  searchSource={{ ...binSearch(fromWarehouse), mapOption: (row) => ({ value: row.code, label: `${row.code} - ${row.name}`,
                    disabled: !fromBins.includes(row.code) }) }}
                  value={fromBin}
                  onChange={(e) => setFromBin(e.target.value)}
                  disabled={!fromWarehouse || fromBins.length === 0}
                >
                  <option value="">{t('transfer.selectSourceBin')}</option>
                  {fromBins.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </SearchableSelect>
              </div>
            )}

            {/* Outbound Fridge Map Integration for Stage 3 */}
            {sourcePalletPositionRequired && fromWarehouse && (
              <div className="transfer-bin-selection-wrap" style={{ gridColumn: '1 / -1' }}>
                <div className="transfer-view-mode-toggle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label htmlFor="t-from-bin" style={{ margin: 0, fontWeight: 600 }}>
                    {t('transfer.fromBin')}
                  </label>
                  <div className="transfer-toggle-group" style={{ display: 'inline-flex', gap: '4px', background: 'var(--color-surface-muted, #f1f5f9)', padding: '2px', borderRadius: '6px', border: '1px solid var(--color-border, #cbd5e1)' }}>
                    <button
                      type="button"
                      className={`transfer-toggle-btn ${sourceViewMode === 'map' ? 'transfer-toggle-btn--active' : ''}`}
                      onClick={() => setSourceViewMode('map')}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        background: sourceViewMode === 'map' ? 'var(--color-primary, #0f5ca8)' : 'transparent',
                        color: sourceViewMode === 'map' ? '#ffffff' : 'var(--color-text, #334155)',
                      }}
                    >
                      🗺️ {t('transfer.mapView') || 'Visual Map'}
                    </button>
                    <button
                      type="button"
                      className={`transfer-toggle-btn ${sourceViewMode === 'dropdown' ? 'transfer-toggle-btn--active' : ''}`}
                      onClick={() => setSourceViewMode('dropdown')}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        background: sourceViewMode === 'dropdown' ? 'var(--color-primary, #0f5ca8)' : 'transparent',
                        color: sourceViewMode === 'dropdown' ? '#ffffff' : 'var(--color-text, #334155)',
                      }}
                    >
                      📋 {t('transfer.dropdownView') || 'Dropdown'}
                    </button>
                  </div>
                </div>

                {sourceViewMode === 'dropdown' && (
                  <div className="form-field">
                    <SearchableSelect
                      id="t-from-bin"
                      className="app-select"
                      searchSource={{ ...binSearch(fromWarehouse), mapOption: (row) => ({ value: row.code, label: `${row.code} - ${row.name}`,
                    disabled: !fromBins.includes(row.code) }) }}
                  value={fromBin}
                      onChange={(e) => setFromBin(e.target.value)}
                      disabled={!fromWarehouse || fromBins.length === 0}
                    >
                      <option value="">{t('transfer.selectSourceBin')}</option>
                      {fromBins.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </SearchableSelect>
                  </div>
                )}

                {sourceViewMode === 'map' && (
                  <div className="transfer-map-container" style={{ marginTop: '8px' }}>
                    <ColdStorageMap
                      warehouseCode={fromWarehouse}
                      allowedBinCodes={allowedSourceMapBins}
                      selectedBin={fromBin}
                      selectedPositionId={sourcePalletPositionId}
                      isTransferMode={true}
                      mode="OUTBOUND"
                      refreshTrigger={mapRefreshTrigger}
                      onBinSelect={(bin) => {
                        if (bin && bin.position_id) {
                          setFromBin(bin.bin_code || '');
                          setSourcePalletPosition({
                            id: bin.position_id,
                            code: bin.position_code,
                            bin_code: bin.bin_code,
                            abs_entry: bin.abs_entry,
                          });
                          if (bin.batch_number) {
                            setSourceBatchCandidate(bin.batch_number);
                          }
                        } else if (bin) {
                          setFromBin(bin.bin_code || '');
                          setSourcePalletPosition(null);
                        } else {
                          setFromBin('');
                          setSourcePalletPosition(null);
                        }
                      }}
                    />

                    {sourcePalletPositionCode ? (
                      <div
                        className="transfer-selected-position-badge"
                        style={{
                          marginTop: '10px',
                          padding: '10px 14px',
                          background: 'rgba(15, 92, 168, 0.08)',
                          border: '1px solid rgba(15, 92, 168, 0.25)',
                          borderRadius: '8px',
                          fontSize: '0.875rem',
                          color: 'var(--color-primary, #0f5ca8)',
                          fontWeight: 600,
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span>📍</span>
                          <span>
                            {t('transfer.sourcePalletPosition')}:{' '}
                            <strong style={{ fontFamily: 'monospace' }}>{sourcePalletPositionCode}</strong>
                          </span>
                        </div>
                        {fromBin && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-text, #334155)', fontSize: '0.82rem' }}>
                            <span>•</span>
                            <span>{t('transfer.fromBin')}: <strong style={{ fontFamily: 'monospace' }}>{fromBin}</strong></span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        className="feedback-message feedback-message--warning transfer-position-hint"
                        style={{ marginTop: '10px' }}
                      >
                        ℹ️ {t('transfer.pleaseSelectSourcePalletPosition')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Batches ────────────────────────────────────────── */}
        {currentStep === STEP_BATCHES && (
          <>

            <div className="transfer-scan-bar">
              <input
                ref={scanRef}
                id="t-batch-scan"
                className="app-input transfer-scan-input"
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleScanBatch();
                  }
                }}
                placeholder={t('transfer.scanPlaceholder')}
                autoComplete="off"
              />
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={handleScanBatch}
                disabled={isPhysicalStage ? physicalScanStatus === TransferStatus.LOADING : scanStatus === TransferStatus.LOADING}
              >
                {(isPhysicalStage ? physicalScanStatus === TransferStatus.LOADING : scanStatus === TransferStatus.LOADING)
                  ? t('transfer.lookingUp')
                  : t('transfer.addBatch')}
              </button>
            </div>

            {(isPhysicalStage ? physicalScanError : scanError) && (
              <div className="feedback-message feedback-message--error transfer-scan-error">
                {isPhysicalStage ? physicalScanError : scanError}
              </div>
            )}

            {isPhysicalStage ? (
              physicalBatchLines.length > 0 ? (
                <div className="transfer-lines-wrapper">
                  <table className="transfer-lines-table">
                    <thead>
                      <tr>
                        <th>{t('transfer.colBatchNumber')}</th>
                        <th>{t('physicalTransfer.currentLocation')}</th>
                        <th>{t('physicalTransfer.currentState')}</th>
                        <th>{t('physicalTransfer.status')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {physicalBatchLines.map((line) => (
                        <tr key={line.batchNumber}>
                          <td className="transfer-lines-mono">{line.batchNumber}</td>
                          <td>{line.currentLocation}</td>
                          <td>
                            <span className="transfer-source-badge transfer-source-badge--info">
                              {line.state}
                            </span>
                          </td>
                          <td>
                            {line.warningMessage ? (
                              <span className="feedback-message feedback-message--warning" style={{ margin: 0, padding: '4px 8px', display: 'inline-block' }}>
                                {line.warningMessage}
                              </span>
                            ) : (
                              <span className="transfer-source-badge transfer-source-badge--success">
                                {t('common.ready')}
                              </span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="transfer-remove-btn"
                              onClick={() => {
                                setPhysicalBatchLines([]);
                                setPhysicalScanError('');
                              }}
                              title={t('transfer.removeLine')}
                              aria-label={t('transfer.removeBatch', line.batchNumber)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="transfer-empty-hint">
                  {t('transfer.noBatches')}
                </p>
              )
            ) : batchLines.length > 0 ? (
              <>
              <div className="transfer-lines-wrapper">
                <table className="transfer-lines-table">
                  <thead>
                    <tr>
                      <th>{t('transfer.colBatchNumber')}</th>
                      <th>{t('transfer.colItemCode')}</th>
                      <th>{t('transfer.colItemName')}</th>
                      <th>{t('transfer.colSourceStatus')}</th>
                      <th>{t('transfer.colAvailable')}</th>
                      <th>{t('transfer.colUom')}</th>
                      <th>{t('transfer.colExpiry')}</th>
                      <th>{t('transfer.colQtyToTransfer')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchLines.map((line) => (
                      <tr key={line.batchNumber} className={line.mock ? 'transfer-line--mock' : ''}>
                        <td className="transfer-lines-mono">{line.batchNumber}<div>{lang === 'ar' ? 'نوع البالتة' : 'Pallet type'}: {line.withoutPallet ? (lang === 'ar' ? 'بدون بالتات' : 'No pallets') : line.productionPalletTypeName || '—'}</div></td>
                        <td>{line.itemCode}</td>
                        <td>{line.itemName}</td>
                        <td>
                          <span className={`transfer-source-badge transfer-source-badge--${sourceStatusTone(line)}`}>
                            {sourceStatusLabel(line, t)}
                          </span>
                          {line.sourceMessage && (
                            <span className="transfer-source-note">{line.sourceMessage}</span>
                          )}
                        </td>
                        <td className="transfer-lines-num">
                          {line.canPostToSap ? line.availableQuantity : '-'}
                        </td>
                        <td>{line.uom}</td>
                        <td>{line.expiryDate || '-'}</td>
                        <td className="transfer-lines-qty-cell">
                          <span className="transfer-qty-display">
                            {line.quantity} {line.uom}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="transfer-remove-btn"
                            onClick={() => removeLine(line.batchNumber)}
                            title={t('transfer.removeLine')}
                            aria-label={t('transfer.removeBatch', line.batchNumber)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasLocalReceiptLines && (
                <div className="feedback-message feedback-message--warning transfer-source-warning">
                  {t('transfer.localReceiptWarning')}
                </div>
              )}
              </>
            ) : (
              <p className="transfer-empty-hint">
                {t('transfer.noBatches')}
              </p>
            )}

            {simplifiedFlow && toBinRequired && (
              <div className="transfer-inline-bin">
                <div className="form-field">
                  <label htmlFor="t-to-bin-simple">{t(stage === TransferStage.STAGE_3_FROM_FRIDGE ? 'transfer.destinationSapBin' : 'transfer.toBin')}</label>
                  <SearchableSelect
                    id="t-to-bin-simple"
                    className="app-select"
                    searchSource={{ ...binSearch(toWarehouse), mapOption: (row) => ({ value: row.code, label: `${row.code} - ${row.name}`,
                    disabled: !toBins.includes(row.code) }) }}
                  value={toBin}
                    onChange={(e) => setToBin(e.target.value)}
                    disabled={!toWarehouse || toBins.length === 0}
                  >
                    <option value="">{t('transfer.selectDestinationBin')}</option>
                    {toBins.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </SearchableSelect>
                </div>
              </div>
            )}

            {simplifiedFlow && submitError && (
              <div className="feedback-message feedback-message--error">
                {submitError}
              </div>
            )}
          </>
        )}

        {/* ── Step 3: Destination (Physical Stage 5 - Shipping Container) ─ */}
        {currentStep === STEP_DESTINATION && isPhysicalStage && (
          <div className="transfer-destination-wrap">
            <div
              className="feedback-message feedback-message--info"
              style={{
                marginBottom: '1.25rem',
                maxWidth: '520px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 500,
              }}
            >
              <span>ℹ️</span>
              <span>{t('transfer.containerNotSapWarehouseNotice')}</span>
            </div>

            <div className="transfer-form-grid">
              <div className="form-field" style={{ gridColumn: '1 / -1', maxWidth: '420px' }}>
                <label htmlFor="t-container-num">{t('transfer.containerNumber')}</label>
                <input
                  id="t-container-num"
                  type="text"
                  className="app-input"
                  value={containerNumber}
                  onChange={(e) => setContainerNumber(e.target.value)}
                  placeholder={t('transfer.enterContainerNumber')}
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Destination (Standard SAP Stages) ──────────────── */}
        {currentStep === STEP_DESTINATION && !isPhysicalStage && (
          <div className="transfer-destination-wrap">

            {/* Destination type selector - Stage 2 only */}
            {stage === TransferStage.STAGE_2_TO_FRIDGE && (
              <div className="transfer-dest-type-section">
                <p className="transfer-dest-type-label">{t('transfer.destinationType')}</p>
                <div className="transfer-dest-type-grid">
                  <button
                    type="button"
                    className={[
                      'transfer-stage-btn',
                      toDestType === 'intermediate' ? 'transfer-stage-btn--active' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setToDestType('intermediate')}
                  >
                    <span className="transfer-stage-badge">{t('transfer.option1')}</span>
                    <span className="transfer-stage-label">{t('transfer.intermediateWarehouse')}</span>
                    <span className="transfer-stage-desc">
                      {t('transfer.intermediateDesc')}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={[
                      'transfer-stage-btn',
                      toDestType === 'fridge' ? 'transfer-stage-btn--active' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setToDestType('fridge')}
                  >
                    <span className="transfer-stage-badge">{t('transfer.option2')}</span>
                    <span className="transfer-stage-label">{t('transfer.fridgeStockingWarehouse')}</span>
                    <span className="transfer-stage-desc">
                      {t('transfer.fridgeDesc')}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Warehouse + bin dropdowns - shown once type is selected (or always for Stage 1) */}
            {(stage !== TransferStage.STAGE_2_TO_FRIDGE || toDestType) && (
              <div className="transfer-form-grid">
                <div className="form-field">
                  <label htmlFor="t-to-wh">
                    {toDestType === 'intermediate'
                      ? t('transfer.toIntermediate')
                      : toDestType === 'fridge'
                      ? t('transfer.toFridgeStocking')
                      : (stageMeta?.toLabel ?? t('transfer.toWarehouse'))}
                  </label>
                  <SearchableSelect
                    id="t-to-wh"
                    className="app-select"
                    searchInDropdown
                    value={toWarehouse}
                    onChange={(e) => setToWarehouse(e.target.value)}
                    disabled={availableToWarehouses.length === 0}
                    placeholder={toDestType === 'intermediate'
                      ? t('transfer.toIntermediate')
                      : toDestType === 'fridge'
                      ? t('transfer.toFridgeStocking')
                      : (stageMeta?.toLabel ?? t('transfer.toWarehouse'))}
                  >
                    <option value="">
                      {availableToWarehouses.length === 0
                        ? t('transfer.noWarehousesAvailable')
                        : t('transfer.selectDestinationWarehouse')}
                    </option>
                    {availableToWarehouses.map((w) => (
                      <option key={w.code} value={w.code} data-search={[w.name, w.name_ar, w.name_en].filter(Boolean).join(' ')}>
                        {w.code} - {w.name}
                      </option>
                    ))}
                  </SearchableSelect>
                </div>

                {toBinRequired && (
                  <div className="transfer-bin-selection-wrap" style={{ gridColumn: '1 / -1' }}>
                    {/* View Mode Toggle when destination is fridge */}
                    {toDestType === 'fridge' && (
                      <div className="transfer-view-mode-toggle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label htmlFor="t-to-bin" style={{ margin: 0, fontWeight: 600 }}>
                          {t('transfer.toBin')}
                        </label>
                        <div className="transfer-toggle-group" style={{ display: 'inline-flex', gap: '4px', background: 'var(--color-surface-muted, #f1f5f9)', padding: '2px', borderRadius: '6px', border: '1px solid var(--color-border, #cbd5e1)' }}>
                          <button
                            type="button"
                            className={`transfer-toggle-btn ${destinationViewMode === 'map' ? 'transfer-toggle-btn--active' : ''}`}
                            onClick={() => setDestinationViewMode('map')}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              background: destinationViewMode === 'map' ? 'var(--color-primary, #0f5ca8)' : 'transparent',
                              color: destinationViewMode === 'map' ? '#ffffff' : 'var(--color-text, #334155)',
                            }}
                          >
                            🗺️ {t('transfer.mapView') || 'Visual Map'}
                          </button>
                          <button
                            type="button"
                            className={`transfer-toggle-btn ${destinationViewMode === 'dropdown' ? 'transfer-toggle-btn--active' : ''}`}
                            onClick={() => setDestinationViewMode('dropdown')}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              background: destinationViewMode === 'dropdown' ? 'var(--color-primary, #0f5ca8)' : 'transparent',
                              color: destinationViewMode === 'dropdown' ? '#ffffff' : 'var(--color-text, #334155)',
                            }}
                          >
                            📋 {t('transfer.dropdownView') || 'Dropdown'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Mode 1: Dropdown */}
                    {(destinationViewMode === 'dropdown' || toDestType !== 'fridge') && (
                      <div className="form-field">
                        {toDestType !== 'fridge' && <label htmlFor="t-to-bin">{t(stage === TransferStage.STAGE_3_FROM_FRIDGE ? 'transfer.destinationSapBin' : 'transfer.toBin')}</label>}
                        <SearchableSelect
                          id="t-to-bin"
                          className="app-select"
                          searchSource={{ ...binSearch(toWarehouse), mapOption: (row) => ({ value: row.code, label: `${row.code} - ${row.name}`,
                    disabled: !toBins.includes(row.code) }) }}
                  value={toBin}
                          onChange={(e) => setToBin(e.target.value)}
                          disabled={!toWarehouse || toBins.length === 0}
                        >
                          <option value="">{t('transfer.selectDestinationBin')}</option>
                          {toBins.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </SearchableSelect>
                      </div>
                    )}

                    {/* Mode 2: Cold Storage Visual Map */}
                    {destinationViewMode === 'map' && toDestType === 'fridge' && toWarehouse && (
                      <div className="transfer-map-container" style={{ marginTop: '8px' }}>
                        <ColdStorageMap
                          warehouseCode={toWarehouse}
                          quickPlacement={true}
                          allowedBinCodes={allowedDestinationMapBins}
                          selectedBin={toBin}
                          selectedPositionId={palletPositionId}
                          isTransferMode={true}
                          refreshTrigger={mapRefreshTrigger}
                          onBinSelect={(bin) => {
                            if (bin && bin.position_id) {
                              setToBin(bin.bin_code || '');
                              setPalletPosition({
                                id: bin.position_id,
                                code: bin.position_code,
                                bin_code: bin.bin_code,
                                abs_entry: bin.abs_entry,
                              });
                            } else if (bin) {
                              setToBin(bin.bin_code || '');
                              setPalletPosition(null);
                            } else {
                              setToBin('');
                              setPalletPosition(null);
                            }
                          }}
                        />

                        {/* Selected Position Details or Missing Position Warning */}
                        {palletPositionCode ? (
                          <div
                            className="transfer-selected-position-badge"
                            style={{
                              marginTop: '10px',
                              padding: '10px 14px',
                              background: 'rgba(15, 92, 168, 0.08)',
                              border: '1px solid rgba(15, 92, 168, 0.25)',
                              borderRadius: '8px',
                              fontSize: '0.875rem',
                              color: 'var(--color-primary, #0f5ca8)',
                              fontWeight: 600,
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: '12px',
                            }}
                          >
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span>📍</span>
                              <span>
                                {t('transfer.selectedPalletPosition')}:{' '}
                                <strong style={{ fontFamily: 'monospace' }}>{palletPositionCode}</strong>
                              </span>
                            </div>
                            {toBin && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-text, #334155)', fontSize: '0.82rem' }}>
                                <span>•</span>
                                <span>{t('transfer.toBin')}: <strong style={{ fontFamily: 'monospace' }}>{toBin}</strong></span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div
                            className="feedback-message feedback-message--warning transfer-position-hint"
                            style={{ marginTop: '10px' }}
                          >
                            ℹ️ {t('transfer.pleaseSelectPalletPosition')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* ── Step 4: Review ─────────────────────────────────────────── */}
        {currentStep === STEP_REVIEW && (
          <div className="transfer-review">
            <div className="transfer-review-grid">
              <div className="transfer-review-block">
                <span className="transfer-review-label">
                  <span className="meta-label-icon" aria-hidden="true">🔄</span>
                  {t('transfer.transferStage')}
                </span>
                <span className="transfer-review-value">
                  {stageMeta ? (
                    <>
                      <span className="transfer-stage-badge">{stageMeta.badge}</span>
                      {' '}{stageMeta.title}
                    </>
                  ) : stage}
                </span>
              </div>

              <div className="transfer-review-block">
                <span className="transfer-review-label">
                  <span className="meta-label-icon" aria-hidden="true">🏭</span>
                  {t('transfer.fromWarehouse')}
                </span>
                <span className="transfer-review-value transfer-lines-mono">{displayFromWarehouse}</span>
              </div>

              {!isPhysicalStage && fromBinRequired && fromBin && (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <span className="meta-label-icon" aria-hidden="true">📍</span>
                    {t('transfer.fromBin')}
                  </span>
                  <span className="transfer-review-value transfer-lines-mono">{fromBin}</span>
                </div>
              )}

              {!isPhysicalStage && toDestType && (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <span className="meta-label-icon" aria-hidden="true">🏭</span>
                    {t('transfer.destinationType')}
                  </span>
                  <span className="transfer-review-value">
                    {toDestType === 'fridge' ? t('transfer.fridgeStockingWarehouse') : t('transfer.intermediateWarehouse')}
                  </span>
                </div>
              )}

              {isPhysicalStage ? (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <span className="meta-label-icon" aria-hidden="true">🚚</span>
                    {t('transfer.toContainer')}
                  </span>
                  <span className="transfer-review-value transfer-lines-mono">
                    🚢 {containerNumber.trim()}
                    <span className="transfer-source-badge transfer-source-badge--info" style={{ marginLeft: '8px', fontSize: '0.75rem' }}>
                      Physical Custody
                    </span>
                  </span>
                </div>
              ) : (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <span className="meta-label-icon" aria-hidden="true">🏭</span>
                    {t('transfer.toWarehouse')}
                  </span>
                  <span className="transfer-review-value transfer-lines-mono">{displayToWarehouse}</span>
                </div>
              )}

              {!isPhysicalStage && toBinRequired && toBin && (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <span className="meta-label-icon" aria-hidden="true">📍</span>
                    {t('transfer.toBin')}
                  </span>
                  <span className="transfer-review-value transfer-lines-mono">{toBin}</span>
                </div>
              )}

              {!isPhysicalStage && sourcePalletPositionCode && (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <MapPin size={13} className="meta-label-icon" aria-hidden="true" />
                    {t('transfer.sourcePalletPosition')}
                  </span>
                  <span className="transfer-review-value transfer-lines-mono">
                    📍 {sourcePalletPositionCode}
                  </span>
                </div>
              )}

              {!isPhysicalStage && palletPositionCode && (
                <div className="transfer-review-block">
                  <span className="transfer-review-label">
                    <MapPin size={13} className="meta-label-icon" aria-hidden="true" />
                    {t('transfer.physicalPosition')}
                  </span>
                  <span className="transfer-review-value transfer-lines-mono">
                    📍 {palletPositionCode}
                  </span>
                </div>
              )}
            </div>

            <div className="transfer-lines-wrapper">
              <table className="transfer-lines-table">
                <thead>
                  {isPhysicalStage ? (
                    <tr>
                      <th>{t('transfer.colBatchNumber')}</th>
                      <th>{t('physicalTransfer.currentLocation')}</th>
                      <th>{t('physicalTransfer.currentState')}</th>
                      <th>{t('physicalTransfer.status')}</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>{t('transfer.colBatchNumber')}</th>
                      <th>{t('transfer.colItemCode')}</th>
                      <th>{t('transfer.colItemName')}</th>
                      <th>{t('transfer.colSourceStatus')}</th>
                      <th>{t('transfer.colUom')}</th>
                      <th>{t('transfer.colQtyToTransfer')}</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {isPhysicalStage ? (
                    physicalBatchLines.map((line) => (
                      <tr key={line.batchNumber}>
                        <td className="transfer-lines-mono">{line.batchNumber}</td>
                        <td>{line.currentLocation}</td>
                        <td>
                          <span className="transfer-source-badge transfer-source-badge--info">
                            {line.state}
                          </span>
                        </td>
                        <td>
                          {line.warningMessage ? (
                            <span className="feedback-message feedback-message--warning" style={{ margin: 0, padding: '4px 8px', display: 'inline-block' }}>
                              {line.warningMessage}
                            </span>
                          ) : (
                            <span className="transfer-source-badge transfer-source-badge--success">
                              {t('common.ready')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    batchLines.map((line) => (
                      <tr key={line.batchNumber}>
                        <td className="transfer-lines-mono">{line.batchNumber}</td>
                        <td>{line.itemCode}</td>
                        <td>
                          <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.itemName || line.itemCode)}</span>{' '}
                          {line.itemName}
                        </td>
                        <td>
                          <span className={`transfer-source-badge transfer-source-badge--${sourceStatusTone(line)}`}>
                            {sourceStatusLabel(line, t)}
                          </span>
                        </td>
                        <td>{line.uom}</td>
                        <td className="transfer-lines-num">
                          {line.quantity} {line.uom}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {activeSubmitError && (
              <div className="feedback-message feedback-message--error">
                {activeSubmitError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Done ───────────────────────────────────────────── */}
        {currentStep === STEP_DONE && activeTransferResult && (
          <div className="feedback-message feedback-message--success transfer-success-block">
            <p className="transfer-success-title">
              {activeTransferResult.isPhysical
                ? t('transfer.localLoadingRecorded')
                : activeTransferResult.pending
                  ? (activeTransferResult.message || t('transfer.submittedForReview'))
                  : activeTransferResult.mock
                    ? t('transfer.mockCreated')
                    : t('transfer.postedSuccessfully')}
            </p>

            <div className="transfer-success-meta">
              {activeTransferResult.stage && stageMeta && (
                <span><strong>{t('transfer.stage')}:</strong> {stageMeta.title}</span>
              )}
              {activeTransferResult.isPhysical ? (
                <>
                  {activeTransferResult.reference && (
                    <span><strong>{t('transfer.movementReference')}:</strong> {activeTransferResult.reference}</span>
                  )}
                  {activeTransferResult.containerNumber && (
                    <span><strong>{t('transfer.containerNumber')}:</strong> {activeTransferResult.containerNumber}</span>
                  )}
                </>
              ) : activeTransferResult.pending ? (
                <span><strong>{t('transfer.reviewId')}:</strong> #{activeTransferResult.pendingTransferId}</span>
              ) : (
                <>
                  <span><strong>{t('transfer.docEntry')}:</strong> {activeTransferResult.docEntry}</span>
                  <span><strong>{t('transfer.docNum')}:</strong> {activeTransferResult.docNum}</span>
                </>
              )}
              <span>
                <strong>{t('transfer.from')}:</strong> {activeTransferResult.fromWarehouse}
                {activeTransferResult.fromBin ? ` / ${activeTransferResult.fromBin}` : ''}
                {activeTransferResult.sourcePalletPositionCode ? ` (${activeTransferResult.sourcePalletPositionCode})` : ''}
              </span>
              <span>
                <strong>{isPhysicalStage ? t('transfer.toContainer') : t('transfer.to')}:</strong> {isPhysicalStage ? activeTransferResult.destinationLocation : activeTransferResult.toWarehouse}
                {activeTransferResult.toBin ? ` / ${activeTransferResult.toBin}` : ''}
                {activeTransferResult.palletPositionCode ? ` (${activeTransferResult.palletPositionCode})` : ''}
              </span>
            </div>

            <div className="table-scroll-wrap">
            <table className="transfer-success-lines-table">
              <thead>
                <tr>
                  <th>{t('transfer.colBatchNumber')}</th>
                  {!activeTransferResult.isPhysical && <th>{t('transfer.colItemCode')}</th>}
                  {!activeTransferResult.isPhysical && <th>{t('transfer.colItemName')}</th>}
                  <th>{t('transfer.qtyTransferred')}</th>
                  <th>{t('transfer.colUom')}</th>
                </tr>
              </thead>
              <tbody>
                {activeTransferResult.lines.map((l) => (
                  <tr key={l.batchNumber}>
                    <td className="transfer-lines-mono">{l.batchNumber}</td>
                    {!activeTransferResult.isPhysical && <td>{l.itemCode}</td>}
                    {!activeTransferResult.isPhysical && <td>{l.itemName}</td>}
                    <td className="transfer-lines-num">{l.quantity}</td>
                    <td>{l.uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ── Navigation ─────────────────────────────────────────────── */}
        <div className="wizard-nav-row">
          {!simplifiedFlow && currentStep > STEP_STAGE && currentStep < STEP_DONE && (
            <button
              type="button"
              className="app-button app-button--secondary wizard-nav-btn"
              onClick={back}
            >
              {t('transfer.back')}
            </button>
          )}

          {!simplifiedFlow && currentStep > STEP_STAGE && currentStep < STEP_REVIEW && (
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn"
              onClick={next}
              disabled={!stepValid[currentStep]}
            >
              {t('transfer.next')}
            </button>
          )}

          {simplifiedFlow && currentStep === STEP_BATCHES && (
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn transfer-submit-btn"
              onClick={activeSubmit}
              disabled={!activeCanSubmit || activeSubmitStatus === TransferStatus.LOADING}
            >
              {activeSubmitStatus === TransferStatus.LOADING
                ? loadingButtonText
                : submitButtonText}
            </button>
          )}

          {currentStep === STEP_REVIEW && (
            <button
              type="button"
              className="app-button app-button--primary wizard-nav-btn transfer-submit-btn"
              onClick={activeSubmit}
              disabled={!activeCanSubmit || activeSubmitStatus === TransferStatus.LOADING}
            >
              {activeSubmitStatus === TransferStatus.LOADING
                ? loadingButtonText
                : submitButtonText}
            </button>
          )}

          {currentStep === STEP_DONE && (
            <button
              type="button"
              className="app-button app-button--secondary wizard-nav-btn"
              onClick={handleReset}
            >
              {t('transfer.newTransfer')}
            </button>
          )}
        </div>

      </section>
    </div>
  );
}

export default TransferPage;
