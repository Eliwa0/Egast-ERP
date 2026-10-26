import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import {
  fetchColdStorageLayout,
  reservePalletPosition,
  releasePalletPosition,
  previewSequentialAllocation,
  allocateSequentially,
} from '../services/transferService';
import './ColdStorageMap.css';
import { filterPolicyHierarchy } from '../services/transferPolicy';

/**
 * Helper to recursively count physical (non-system) bins under any node.
 */
function countPhysicalBins(node) {
  if (!node) return 0;
  let count = (node.bins || []).filter((b) => !b.is_system_bin).length;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countPhysicalBins(child);
    }
  }
  return count;
}

/**
 * Helper to recursively sum total capacity under any node.
 */
function sumNodeCapacity(node) {
  if (!node) return 0;
  let total = (node.bins || []).reduce((acc, b) => acc + (b.is_system_bin ? 0 : (b.capacity || 1)), 0);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      total += sumNodeCapacity(child);
    }
  }
  return total;
}

/**
 * Helper to search the hierarchy tree for a bin by its bin_code or abs_entry.
 */
function findBinInTree(nodes, target, currentPath = []) {
  if (!nodes || target === null || target === undefined) return null;
  const isTargetNum = typeof target === 'number' || /^\d+$/.test(String(target));
  const normalizedStr = String(target).trim().toUpperCase();

  for (const node of nodes) {
    const nextPath = [...currentPath, node.code];
    if (Array.isArray(node.bins)) {
      for (const b of node.bins) {
        if (
          (isTargetNum && b.abs_entry === Number(target)) ||
          String(b.bin_code).trim().toUpperCase() === normalizedStr
        ) {
          return { ...b, path: nextPath };
        }
      }
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const found = findBinInTree(node.children, target, nextPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Dynamic Cold Storage Visual Map with Physical Pallet Position Layer.
 *
 * Implements:
 * 1. Progressive drilldown: Storage Area -> Chamber -> Rack -> Shelf/Bin -> Pallet Positions (Bus-seat style)
 * 2. Visual occupancy states: AVAILABLE, SELECTED, RESERVED, OCCUPIED, MAINTENANCE
 * 3. Concurrency-safe atomic reservations with 409 conflict handling
 * 4. Single-source-of-truth callback binding: bin_code + abs_entry + position_code + position_id
 */
export default function ColdStorageMap({
  warehouseCode,
  selectedBin,
  selectedPositionId = null,
  onBinSelect,
  className = '',
  isTransferMode = false,
  refreshTrigger = 0,
  mode = 'INBOUND',
  allowedBinCodes = null,
  quickPlacement = false,
}) {
  const { t, lang } = useI18n();
  const [locationScan, setLocationScan] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [showLocations, setShowLocations] = useState(false);

  useEffect(() => {
    setLocationScan('');
    setShowLocations(false);
    setShowMap(false);
  }, [warehouseCode]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [layoutData, setLayoutData] = useState(null);
  const [currentPath, setCurrentPath] = useState([]); // e.g. ['F01'], ['F01', 'R01'], ['F01', 'R01', 'C01', 'RA']
  const [activeChannelBin, setActiveChannelBin] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const [seqPalletCount, setSeqPalletCount] = useState(1);
  const [seqPreviewData, setSeqPreviewData] = useState(null);
  const [seqActionLoading, setSeqActionLoading] = useState(false);

  const selectedBinCode = useMemo(() => {
    if (!selectedBin) return '';
    return typeof selectedBin === 'object' ? selectedBin.bin_code || '' : String(selectedBin);
  }, [selectedBin]);

  // Load layout and physical capacity data from backend
  const loadLayout = useCallback(
    async (refresh = false) => {
      if (!warehouseCode) {
        setLayoutData(null);
        return;
      }
      setLoading(true);
      setError(null);
      setFeedback(null);
      try {
        const data = await fetchColdStorageLayout(warehouseCode, refresh);
        if (!data || !data.hierarchy) {
          throw new Error(t('transfer.emptyHierarchy') || 'No storage layout found');
        }
        setLayoutData({ ...data, hierarchy: filterPolicyHierarchy(data.hierarchy, allowedBinCodes) });
      } catch (err) {
        console.error('[ColdStorageMap] Failed to load layout:', err);
        setError(err.message || t('transfer.errorLoadingHierarchy') || 'Failed to load storage layout');
      } finally {
        setLoading(false);
      }
    },
    [warehouseCode, t, allowedBinCodes],
  );

  useEffect(() => {
    loadLayout(false);
  }, [loadLayout]);

  // Support targeted refresh from parent (e.g. after conflict or reservation)
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadLayout(true);
    }
  }, [refreshTrigger, loadLayout]);

  // Keep selectedPosition in sync with selectedPositionId prop
  useEffect(() => {
    if (!selectedPositionId) {
      setSelectedPosition(null);
      return;
    }
    if (activeChannelBin?.positions) {
      const match = activeChannelBin.positions.find((p) => p.id === selectedPositionId);
      if (match) {
        setSelectedPosition(match);
      }
    }
  }, [selectedPositionId, activeChannelBin]);

  // If a selectedBin is passed initially, auto-navigate to its location
  useEffect(() => {
    if (!selectedBinCode || !layoutData?.hierarchy) return;
    const found = findBinInTree(layoutData.hierarchy, selectedBinCode);
    if (found?.path && currentPath.length === 0) {
      if (found.path.length >= 4) {
        setCurrentPath(found.path);
        setActiveChannelBin(found);
      } else if (found.path.length >= 2) {
        setCurrentPath(found.path.slice(0, 2));
      }
    }
  }, [selectedBinCode, layoutData, currentPath.length]);

  // Find metadata for the currently selected bin
  const selectedBinDetails = useMemo(() => {
    if (!selectedBinCode || !layoutData?.hierarchy) return null;
    return findBinInTree(layoutData.hierarchy, selectedBinCode);
  }, [selectedBinCode, layoutData]);

  // Filter root hierarchy nodes (exclude pure system bins from selectable navigation)
  const rootNodes = useMemo(() => {
    if (!layoutData?.hierarchy) return [];
    return layoutData.hierarchy.filter((node) => {
      const isSystem =
        node.code.toUpperCase().includes('SYSTEM') ||
        (node.bins && node.bins.length > 0 && node.bins.every((b) => b.is_system_bin) && (!node.children || node.children.length === 0));
      return !isSystem;
    });
  }, [layoutData]);

  // Find currently active node based on currentPath
  const currentNode = useMemo(() => {
    if (!layoutData?.hierarchy || currentPath.length === 0) return null;
    let curr = layoutData.hierarchy.find((n) => n.code === currentPath[0]);
    for (let i = 1; i < currentPath.length; i++) {
      if (!curr?.children) return null;
      curr = curr.children.find((c) => c.code === currentPath[i]);
    }
    return curr;
  }, [layoutData, currentPath]);

  // Handle drilldown into channel depth view (Physical Pallet Positions)
  const handleOpenChannel = (binObj, path = []) => {
    if (!binObj || binObj.is_system_bin) return;
    setActiveChannelBin(binObj);
    setCurrentPath(path);
    setSeqPreviewData(null);
    setFeedback(null);
  };

  // Handle selecting an individual pallet position (AVAILABLE for INBOUND, OCCUPIED for OUTBOUND)
  const handleSelectPosition = (pos, binObj, path = []) => {
    if (!pos) return;
    const isOutbound = mode === 'OUTBOUND';
    const targetStatus = isOutbound ? 'OCCUPIED' : 'AVAILABLE';
    if (pos.status !== targetStatus) return;

    const alloc = binObj?.allocation_type;
    if (alloc && alloc !== 'ALLOCATABLE') {
      setFeedback({
        type: 'error',
        text:
          alloc === 'STAGING_ONLY'
            ? (t('transfer.binStagingOnlyNotice') || 'This location is for transit/staging only and cannot be allocated for storage.')
            : alloc === 'NON_ALLOCATABLE'
            ? (t('transfer.binNonAllocatableNotice') || 'This location is non-allocatable.')
            : (t('transfer.binUnconfiguredNotice') || 'This location is unconfigured and requires capacity configuration before allocation.'),
      });
      return;
    }
    setSelectedPosition(pos);
    setFeedback(null);

    if (onBinSelect) {
      onBinSelect({
        bin_code: binObj.bin_code,
        abs_entry: binObj.abs_entry,
        warehouse: warehouseCode,
        position_id: pos.id,
        position_code: pos.position_code,
        position_index: pos.position_index,
        position_status: pos.status,
        batch_number: pos.current_batch_number || null,
        transfer_reference: pos.transfer_reference || null,
        allocation_type: alloc || 'ALLOCATABLE',
        sublevel1: path[0] || null,
        sublevel2: path[1] || null,
        sublevel3: path[2] || null,
        sublevel4: path[3] || null,
        description: binObj.description || '',
        inactive: Boolean(binObj.inactive),
        is_system_bin: false,
      });
    }
  };

  // Handle direct selection of a bin (e.g. bulk bin or header bin)
  const handleSelectBinDirectly = (binObj, path = []) => {
    if (!binObj || binObj.is_system_bin) return;
    if (mode === 'OUTBOUND') {
      handleOpenChannel(binObj, path);
      return;
    }
    const alloc = binObj?.allocation_type;
    if (alloc && alloc !== 'ALLOCATABLE') {
      setFeedback({
        type: 'error',
        text:
          alloc === 'STAGING_ONLY'
            ? (t('transfer.binStagingOnlyNotice') || 'This location is for transit/staging only and cannot be allocated for storage.')
            : alloc === 'NON_ALLOCATABLE'
            ? (t('transfer.binNonAllocatableNotice') || 'This location is non-allocatable.')
            : (t('transfer.binUnconfiguredNotice') || 'This location is unconfigured and requires capacity configuration before allocation.'),
      });
      return;
    }
    const defaultPos = binObj.positions?.[0] || null;
    setSelectedPosition(defaultPos);
    setFeedback(null);

    if (onBinSelect) {
      onBinSelect({
        bin_code: binObj.bin_code,
        abs_entry: binObj.abs_entry,
        warehouse: warehouseCode,
        position_id: defaultPos?.id || null,
        position_code: defaultPos?.position_code || null,
        allocation_type: alloc || 'ALLOCATABLE',
        sublevel1: path[0] || null,
        sublevel2: path[1] || null,
        sublevel3: path[2] || null,
        sublevel4: path[3] || null,
        description: binObj.description || '',
        inactive: Boolean(binObj.inactive),
        is_system_bin: false,
      });
    }
  };

  // Handle reservation of selected position
  const handleReservePosition = async () => {
    if (!selectedPosition) return;
    if (activeChannelBin?.allocation_type && activeChannelBin.allocation_type !== 'ALLOCATABLE') {
      setFeedback({
        type: 'error',
        text:
          activeChannelBin.allocation_type === 'STAGING_ONLY'
            ? (t('transfer.binStagingOnlyNotice') || 'This location is for transit/staging only and cannot be allocated for storage.')
            : (t('transfer.binNonAllocatableNotice') || 'This location is not allocatable for pallet storage.'),
      });
      return;
    }
    setActionLoading(true);
    setFeedback(null);
    try {
      const updated = await reservePalletPosition(selectedPosition.id, 'Transfer Selection');
      setSelectedPosition(updated);
      setFeedback({
        type: 'success',
        text: t('transfer.positionReservedSuccess') || 'Pallet position reserved successfully',
      });
      // Refresh layout data in background to update occupancy numbers
      loadLayout(true);
    } catch (err) {
      console.error('[ColdStorageMap] Reservation failed:', err);
      const isConflict = err?.response?.status === 409;
      setFeedback({
        type: 'error',
        text: isConflict
          ? t('transfer.positionConflictError') || 'This pallet position is already reserved or occupied. Please pick another position.'
          : err?.response?.data?.error || err.message || 'Failed to reserve position',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle releasing reservation of selected position
  const handleReleasePosition = async () => {
    if (!selectedPosition) return;
    setActionLoading(true);
    setFeedback(null);
    try {
      const updated = await releasePalletPosition(selectedPosition.id);
      setSelectedPosition(updated);
      setFeedback({
        type: 'success',
        text: 'Reservation released successfully',
      });
      loadLayout(true);
    } catch (err) {
      console.error('[ColdStorageMap] Release failed:', err);
      setFeedback({
        type: 'error',
        text: err?.response?.data?.error || err.message || 'Failed to release reservation',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearSelection = useCallback(() => {
    setSelectedPosition(null);
    setActiveChannelBin(null);
    setSeqPreviewData(null);
    setFeedback(null);
    if (onBinSelect) {
      onBinSelect(null);
    }
  }, [onBinSelect]);

  // Sequential pallet allocation handlers
  const handlePreviewSequential = async () => {
    if (!activeChannelBin?.abs_entry) return;
    setSeqActionLoading(true);
    setFeedback(null);
    try {
      const count = Math.max(1, parseInt(seqPalletCount, 10) || 1);
      const data = await previewSequentialAllocation({
        warehouse_code: warehouseCode,
        abs_entry: activeChannelBin.abs_entry,
        pallet_count: count,
      });
      setSeqPreviewData(data);
      if (data.shortage > 0) {
        setFeedback({
          type: 'error',
          text: `⚠️ عجز في السعة: متاح ${data.available_count} فقط، والمطلوب ${data.required_count} (عجز ${data.shortage} بالته).`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: `✅ السعة كافية: سيتم التسكين بالترتيب المتتابع داخل: ${Array.isArray(data?.planned_allocations) ? data.planned_allocations.map((p) => p.position_code).join(', ') : ''}.`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err?.response?.data?.error || err.message || 'فشل حساب التسكين المتتابع.',
      });
    } finally {
      setSeqActionLoading(false);
    }
  };

  const handleAllocateSequential = async () => {
    if (!activeChannelBin?.abs_entry) return;
    setSeqActionLoading(true);
    setFeedback(null);
    try {
      const count = Math.max(1, parseInt(seqPalletCount, 10) || 1);
      const res = await allocateSequentially({
        warehouse_code: warehouseCode,
        abs_entry: activeChannelBin.abs_entry,
        pallet_count: count,
        mode: 'OCCUPY',
      });
      setFeedback({
        type: 'success',
        text: `✅ تم تسكين ${res?.allocated_count ?? count} بالته بالترتيب المتتابع بنجاح.`,
      });
      setSeqPreviewData(null);
      await loadLayout(true);
    } catch (err) {
      const errData = err?.response?.data;
      if (errData?.code === 'INSUFFICIENT_CAPACITY') {
        setFeedback({
          type: 'error',
          text: `⚠️ عجز في السعة: المطلوب ${errData.required}، المتاح ${errData.available} (نقص ${errData.shortage} بالته).`,
        });
      } else {
        setFeedback({
          type: 'error',
          text: errData?.error || err.message || 'فشل التسكين المتتابع.',
        });
      }
    } finally {
      setSeqActionLoading(false);
    }
  };

  // Navigation handlers
  const handleNavigateTo = (index) => {
    if (index === -1) {
      setCurrentPath([]);
      setActiveChannelBin(null);
    } else {
      const nextPath = currentPath.slice(0, index + 1);
      setCurrentPath(nextPath);
      if (nextPath.length < 4) {
        setActiveChannelBin(null);
      }
    }
    setSeqPreviewData(null);
    setFeedback(null);
  };

  const handleDrillDown = (code) => {
    setCurrentPath([...currentPath, code]);
    setSeqPreviewData(null);
    setFeedback(null);
  };

  const handleBack = () => {
    if (activeChannelBin) {
      setActiveChannelBin(null);
      setCurrentPath(currentPath.slice(0, -1));
    } else if (currentPath.length > 0) {
      setCurrentPath(currentPath.slice(0, -1));
    }
    setSeqPreviewData(null);
    setFeedback(null);
  };

  if (quickPlacement && !showMap) {
    const ar = lang === 'ar';
    const bins = [];
    const collect = (nodes, path = []) => {
      for (const node of nodes || []) {
        const nextPath = [...path, node.code];
        for (const bin of node.bins || []) {
          if (!bin.is_system_bin && !bin.inactive && bin.allocation_type === 'ALLOCATABLE') {
            bins.push({ ...bin, path: nextPath });
          }
        }
        collect(node.children, nextPath);
      }
    };
    collect(layoutData?.hierarchy);
    const query = locationScan.trim().toUpperCase();
    const available = bins.flatMap((bin) => (bin.positions || [])
      .filter((pos) => pos.status === 'AVAILABLE')
      .map((pos) => ({ bin, pos })));
    const matches = available.filter(({ bin, pos }) => !query ||
      String(bin?.bin_code || '').toUpperCase().includes(query) ||
      String(pos?.position_code || '').toUpperCase().includes(query));
    const scanLocation = (event) => {
      event.preventDefault();
      if (!query || loading) return;
      const exact = available.filter(({ pos }) => String(pos?.position_code || '').toUpperCase() === query);
      if (exact.length === 1) {
        const { bin, pos } = exact[0];
        handleSelectPosition(pos, bin, bin.path);
        setLocationScan('');
        setShowLocations(false);
        return;
      }
      const bin = bins.find((entry) => String(entry?.bin_code || '').toUpperCase() === query);
      const positions = bin?.positions?.filter((pos) => pos.status === 'AVAILABLE') || [];
      if (positions.length === 1) {
        handleSelectPosition(positions[0], bin, bin.path);
        setLocationScan('');
        setShowLocations(false);
        return;
      }
      setShowLocations(true);
      setFeedback(positions.length > 1 || exact.length > 1 ? null : {
        type: 'error',
        text: ar ? 'المكان غير متاح للتسكين. راجع الكود أو اختر مكانًا متاحًا.' : 'Location unavailable. Check the code or choose an available position.',
      });
    };
    return (
      <section className="cs-map cs-map--quick" aria-label={ar ? 'حدد مكان البالتة' : 'Choose pallet location'}>
        <h3>{ar ? 'حدد مكان البالتة' : 'Choose pallet location'}</h3>
        <p>{ar ? 'امسح باركود الموضع. لو مسحت كود القناة، اختر الموضع المتاح داخلها.' : 'Scan the position barcode. For a channel barcode, choose an available position inside it.'}</p>
        <form onSubmit={scanLocation} className="cs-map__quick-scan">
          <label htmlFor={`location-scan-${warehouseCode}`}>{ar ? 'باركود المكان' : 'Location barcode'}</label>
          <input id={`location-scan-${warehouseCode}`} value={locationScan} onChange={(event) => { setLocationScan(event.target.value); setFeedback(null); }} autoComplete="off" dir="ltr" disabled={loading || !layoutData || Boolean(error)} placeholder={ar ? 'امسح أو اكتب كود المكان' : 'Scan or enter location code'} />
          <button type="submit" className="cs-map__btn cs-map__btn--primary" disabled={loading || !query || Boolean(error)}>{ar ? 'تحديد المكان' : 'Find location'}</button>
        </form>
        {loading && <p role="status">{t('transfer.loadingLayout')}</p>}
        {error && <p role="alert">{error}</p>}
        {feedback && <p role="alert">{typeof feedback.text === 'string' ? feedback.text : JSON.stringify(feedback.text)}</p>}
        {selectedBinCode && <div className="cs-map__quick-selected" role="status">
          <span>{ar ? 'المكان المختار' : 'Selected location'}</span>
          <strong dir="ltr">{selectedPosition?.position_code || selectedBinCode}</strong>
          <span dir="ltr">{selectedBinCode}</span>
          <button type="button" className="cs-map__btn" onClick={handleClearSelection}>{ar ? 'تغيير المكان' : 'Change location'}</button>
        </div>}
        <div className="cs-map__quick-actions">
          <button type="button" className="cs-map__btn" aria-expanded={showLocations} onClick={() => setShowLocations(!showLocations)}>{ar ? 'اختيار مكان متاح' : 'Choose available location'}</button>
          <button type="button" className="cs-map__btn" onClick={() => setShowMap(true)}>{t('transfer.mapView')}</button>
          <button type="button" className="cs-map__btn" disabled={loading} onClick={() => loadLayout(true)}>{t('transfer.refreshMap')}</button>
        </div>
        {showLocations && !loading && !error && <div className="cs-map__quick-locations">
          {!matches.length && <p>{ar ? 'لا توجد مواضع متاحة تطابق الكود.' : 'No available positions match this code.'}</p>}
          {matches.slice(0, 40).map(({ bin, pos }) => <button type="button" className={`cs-map__quick-location ${selectedPositionId === pos.id ? 'cs-map__quick-location--selected' : ''}`} key={pos.id} onClick={() => { handleSelectPosition(pos, bin, bin.path); setShowLocations(false); setLocationScan(''); }}>
            <strong dir="ltr">{pos.position_code}</strong><span dir="ltr">{bin.bin_code}</span><span>{ar ? 'متاح' : 'Available'}</span>
          </button>)}
          {matches.length > 40 && <p>{ar ? 'اكتب كود الثلاجة أو المكان لتضييق النتائج.' : 'Enter a chamber or location code to narrow the results.'}</p>}
        </div>}
      </section>
    );
  }

  return (
    <div className={`cs-map ${mode === 'OUTBOUND' ? 'cs-map--outbound' : ''} ${className}`}>
      {quickPlacement && <button type="button" className="cs-map__btn" onClick={() => setShowMap(false)}>{lang === 'ar' ? 'العودة لمسح المكان' : 'Back to location scan'}</button>}
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="cs-map__header">
        <div className="cs-map__title-group">
          <span className="cs-map__title-icon" aria-hidden="true">❄️</span>
          <h4 className="cs-map__title">
            {t('transfer.storageMapTitle') || 'Cold Storage Visual Map'}
          </h4>
          {layoutData && (
            <span className="cs-map__badge">
              {layoutData.total_capacity || layoutData.physical_bins}{' '}
              {t('transfer.palletPositions') || 'Pallet Capacity'}
            </span>
          )}
        </div>

        <div className="cs-map__header-actions">
          <button
            type="button"
            className="cs-map__btn cs-map__btn--sm"
            onClick={() => loadLayout(true)}
            disabled={loading}
            title={t('transfer.refreshMap') || 'Refresh Map'}
          >
            {loading ? '⏳' : '⟳'} {t('transfer.refreshMap') || 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Selected Location Banner ───────────────────────────────────── */}
      <div className="cs-map__selected-banner">
        <div className="cs-map__selected-info">
          <span className="cs-map__selected-header">
            📍 {t('transfer.selectedLocation') || 'Selected Location'}
          </span>
          {selectedBinCode ? (
            <>
              <span className="cs-map__selected-code">
                {selectedBinCode}
                {selectedPosition && (
                  <span style={{ color: 'var(--color-primary, #0f5ca8)', marginInlineStart: '8px' }}>
                    / {t('transfer.position') || 'Pos'} {selectedPosition.position_code}
                  </span>
                )}
              </span>
              <div className="cs-map__selected-meta">
                {selectedBinDetails?.abs_entry && (
                  <span className="cs-map__meta-tag">
                    {t('transfer.absEntry') || 'SAP AbsEntry'}: #{selectedBinDetails.abs_entry}
                  </span>
                )}
                {selectedPosition?.id && (
                  <span className="cs-map__meta-tag">
                    Pos ID: #{selectedPosition.id} ({selectedPosition.status})
                  </span>
                )}
                {selectedPosition?.current_batch_number && (
                  <span className="cs-map__meta-tag">
                    {t('transfer.batchNumber') || 'Batch'}: {selectedPosition.current_batch_number}
                  </span>
                )}
                {selectedPosition?.transfer_reference && (
                  <span className="cs-map__meta-tag">
                    {t('transfer.transferRef') || 'Ref'}: {selectedPosition.transfer_reference}
                  </span>
                )}
                {selectedBinDetails?.path && selectedBinDetails.path.length > 0 && (
                  <span className="cs-map__meta-tag">
                    {selectedBinDetails.path.join(' › ')}
                    {selectedPosition && ` › ${selectedPosition.position_code}`}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="cs-map__selected-meta">
              {t('transfer.noLocationSelected') || 'No location selected. Click a storage bin or pallet position on the map below.'}
            </span>
          )}
        </div>

        {selectedBinCode && (
          <button
            type="button"
            className="cs-map__btn cs-map__btn--sm"
            onClick={handleClearSelection}
            title={t('transfer.clearSelection') || 'Clear Selection'}
          >
            ✕ {t('transfer.clearSelection') || 'Clear'}
          </button>
        )}
      </div>

      {/* ── Feedback Message Banner (Conflict / Success) ────────────────── */}
      {feedback && (
        <div
          className={`feedback-message feedback-message--${feedback.type === 'error' ? 'error' : 'success'}`}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontWeight: 600,
            background: feedback.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
            color: feedback.type === 'error' ? '#b91c1c' : '#047857',
            border: `1px solid ${feedback.type === 'error' ? '#ef4444' : '#10b981'}`,
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* ── Navigation / Breadcrumbs ────────────────────────────────────── */}
      <nav className="cs-map__nav-bar" aria-label="Storage Breadcrumb">
        <ol className="cs-map__breadcrumbs">
          <li className="cs-map__crumb">
            {currentPath.length > 0 ? (
              <button
                type="button"
                className="cs-map__crumb-btn"
                onClick={() => handleNavigateTo(-1)}
              >
                {t('transfer.allAreas') || 'All Areas'}
              </button>
            ) : (
              <span className="cs-map__crumb-current">
                {t('transfer.allAreas') || 'All Areas'}
              </span>
            )}
          </li>

          {currentPath.map((segment, idx) => {
            const isLast = idx === currentPath.length - 1;
            return (
              <li key={segment} className="cs-map__crumb">
                <span className="cs-map__crumb-sep">›</span>
                {isLast ? (
                  <span className="cs-map__crumb-current">{segment}</span>
                ) : (
                  <button
                    type="button"
                    className="cs-map__crumb-btn"
                    onClick={() => handleNavigateTo(idx)}
                  >
                    {segment}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {currentPath.length > 0 && (
          <button
            type="button"
            className="cs-map__btn cs-map__btn--sm"
            onClick={handleBack}
            title={t('common.back') || 'Back'}
          >
            ← {t('common.back') || 'Back'}
          </button>
        )}
      </nav>

      {/* ── Loading Skeleton / Spinner ─────────────────────────────────── */}
      {loading && (
        <div className="cs-map__status-box">
          <div className="cs-map__spinner" />
          <p className="cs-map__status-text">
            {t('transfer.loadingLayout') || 'Loading physical layout and pallet positions...'}
          </p>
        </div>
      )}

      {/* ── Error State ────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="cs-map__status-box">
          <p className="cs-map__error-text">⚠️ {typeof error === 'string' ? error : JSON.stringify(error)}</p>
          <button
            type="button"
            className="cs-map__btn cs-map__btn--primary"
            onClick={() => loadLayout(true)}
          >
            {t('transfer.retry') || 'Retry'}
          </button>
        </div>
      )}

      {/* ── Content View ───────────────────────────────────────────────── */}
      {!loading && !error && layoutData && (
        <div className="cs-map__content">
          {/* LEVEL 0: Root Sublevel 1 (e.g. F01, F02) */}
          {currentPath.length === 0 && (
            <div className="cs-map__grid">
              {rootNodes.map((node) => {
                const physicalBins = countPhysicalBins(node);
                const capacity = sumNodeCapacity(node);
                const sectionsCount = node.children?.length || 0;
                return (
                  <button
                    key={node.code}
                    type="button"
                    className="cs-map__card"
                    onClick={() => handleDrillDown(node.code)}
                  >
                    <div className="cs-map__card-header">
                      <span className="cs-map__card-code">{node.code}</span>
                      <span className="cs-map__card-pill">
                        {sectionsCount} {t('transfer.sectionsCount', sectionsCount) || 'sections'}
                      </span>
                    </div>
                    <p className="cs-map__card-desc">
                      {node.description || `${t('transfer.storageMapTitle') || 'Refrigerator'} ${node.code}`}
                    </p>
                    <div className="cs-map__card-footer">
                      <span>{capacity} {t('transfer.palletPositions') || 'Pallets'} ({physicalBins} {t('transfer.binsCount', physicalBins) || 'bins'})</span>
                      <span>→</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* LEVEL 1: Sublevel 2 (Chambers under Sublevel 1, e.g. R01..R10, RP1 under F01) */}
          {currentPath.length === 1 && currentNode && (
            <div className="cs-map__grid">
              {currentNode.children?.map((chamber) => {
                const hasRacks = chamber.children && chamber.children.length > 0;
                const physicalBins = countPhysicalBins(chamber);
                const capacity = sumNodeCapacity(chamber);
                const isSelected = chamber.bins?.some((b) => b.bin_code === selectedBinCode);

                // Irregular chamber with no child racks (e.g. R04, R05) -> Direct selectable bulk bin tile
                if (!hasRacks && chamber.bins && chamber.bins.length > 0) {
                  const bulkBin = chamber.bins[0];
                  const active = bulkBin.bin_code === selectedBinCode;
                  return (
                    <button
                      key={chamber.code}
                      type="button"
                      className={`cs-map__card ${active ? 'cs-map__card--active' : ''}`}
                      onClick={() => handleOpenChannel(bulkBin, [...currentPath, chamber.code])}
                    >
                      <div className="cs-map__card-header">
                        <span className="cs-map__card-code">{chamber.code}</span>
                        <span className="cs-map__card-pill">
                          📦 {t('transfer.directBin') || 'Bulk Storage'} ({bulkBin.sap_bin_classification === 'BULK_OR_GENERAL' ? (t('transfer.sapBinOnly') || 'SAP Bin') : `${bulkBin.capacity || 1} ${t('transfer.palletPositions') || 'plts'}`})
                        </span>
                      </div>
                      <p className="cs-map__card-desc">
                        {bulkBin.bin_code}
                      </p>
                      <div className="cs-map__card-footer">
                        <span>#{bulkBin.abs_entry}</span>
                        <span>{active ? '✓ ' + (t('transfer.selectedLocation') || 'Selected') : 'View Positions →'}</span>
                      </div>
                    </button>
                  );
                }

                // Regular chamber with child racks -> Click to drill down into chamber
                return (
                  <button
                    key={chamber.code}
                    type="button"
                    className={`cs-map__card ${isSelected ? 'cs-map__card--active' : ''}`}
                    onClick={() => handleDrillDown(chamber.code)}
                  >
                    <div className="cs-map__card-header">
                      <span className="cs-map__card-code">{chamber.code}</span>
                      <span className="cs-map__card-pill">
                        {chamber.children?.length || 0} {t('transfer.rack') || 'racks'}
                      </span>
                    </div>
                    <p className="cs-map__card-desc">
                      {chamber.description || `${t('transfer.chamber') || 'Chamber'} ${chamber.code}`}
                    </p>
                    <div className="cs-map__card-footer">
                      <span>{capacity} {t('transfer.palletPositions') || 'Pallets'} ({physicalBins} {t('transfer.binsCount', physicalBins) || 'bins'})</span>
                      <span>→</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* LEVEL 2: Sublevel 3 & 4 (Racks and Levels inside a Chamber, e.g. R01) */}
          {currentPath.length >= 2 && !activeChannelBin && currentNode && (
            <div className="cs-map__content">
              {/* General Chamber / Floor Bin (e.g. 20201-F01-R01) */}
              {currentNode.bins && currentNode.bins.length > 0 && (
                <div className="cs-map__chamber-general">
                  <div className="cs-map__chamber-general-info">
                    <span className="cs-map__chamber-general-title">
                      🏷️ {t('transfer.directBin') || 'Direct / Bulk Storage Bin'}:
                    </span>
                    <span className="cs-map__selected-code">
                      {currentNode.bins[0].bin_code}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #64748b)' }}>
                      AbsEntry: #{currentNode.bins[0].abs_entry} · {currentNode.bins[0].capacity || 1} {t('transfer.palletPositions') || 'Pallets'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="cs-map__btn cs-map__btn--sm"
                      onClick={() => handleOpenChannel(currentNode.bins[0], [...currentPath, currentNode.code])}
                    >
                      {t('transfer.palletPositions') || 'Positions'} →
                    </button>
                    <button
                      type="button"
                      className={`cs-map__btn cs-map__btn--sm ${
                        currentNode.bins[0].bin_code === selectedBinCode
                          ? 'cs-map__btn--primary'
                          : ''
                      }`}
                      onClick={() => handleSelectBinDirectly(currentNode.bins[0], currentPath)}
                    >
                      {currentNode.bins[0].bin_code === selectedBinCode
                        ? `✓ ${t('transfer.selectedLocation') || 'Selected'}`
                        : `+ ${t('transfer.selectDestinationBin') || 'Select'}`}
                    </button>
                  </div>
                </div>
              )}

              {/* Racks Grid */}
              <div className="cs-map__racks-grid">
                {currentNode.children?.map((rackNode) => {
                  const hasLevels = rackNode.children && rackNode.children.length > 0;

                  // Case 1: Standard Rack with vertical shelf levels (RA, RB, RC, RD)
                  if (hasLevels) {
                    // Reverse levels so highest tier (e.g. RD) is displayed at the top
                    const sortedLevels = [...rackNode.children].reverse();
                    return (
                      <div key={rackNode.code} className="cs-map__rack-frame">
                        <div className="cs-map__rack-header">
                          <span>{rackNode.code}</span>
                          <span className="cs-map__card-pill">
                            {rackNode.children.length} {t('transfer.level') || 'levels'}
                          </span>
                        </div>
                        <div className="cs-map__rack-shelves">
                          {sortedLevels.map((levelNode) => {
                            const binObj = levelNode.bins?.[0];
                            if (!binObj) return null;
                            const isActive = binObj.bin_code === selectedBinCode;
                            const capacity = binObj.capacity || 1;
                            const availCount = binObj.occupancy?.available ?? capacity;

                            return (
                              <button
                                key={levelNode.code}
                                type="button"
                                className={`cs-map__shelf-btn ${
                                  isActive ? 'cs-map__shelf-btn--active' : ''
                                }`}
                                onClick={() =>
                                  handleOpenChannel(binObj, [
                                    ...currentPath,
                                    rackNode.code,
                                    levelNode.code,
                                  ])
                                }
                                title={`${binObj.bin_code} (AbsEntry: #${binObj.abs_entry}) - ${availCount}/${capacity} Available`}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span className="cs-map__shelf-code">
                                    {levelNode.code}
                                  </span>
                                  <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
                                    {binObj.capacity_source === 'UNCONFIGURED'
                                      ? (t('transfer.unconfiguredCapacity') || 'Unconfigured Depth')
                                      : `${capacity} ${t('transfer.palletPositions') || 'plts'}`}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                  <span className="cs-map__shelf-abs">
                                    #{binObj.abs_entry}
                                  </span>
                                  {binObj.capacity_source === 'UNCONFIGURED' ? (
                                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-warning, #f59e0b)' }}>
                                      {t('transfer.unconfigured') || 'Unset'}
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: availCount > 0 ? '#10b981' : '#ef4444' }}>
                                      {availCount}/{capacity}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  // Case 2: Corridor / Aisle Bin (e.g. B01)
                  if (rackNode.bins && rackNode.bins.length > 0) {
                    const aisleBin = rackNode.bins[0];
                    const isActive = aisleBin.bin_code === selectedBinCode;
                    return (
                      <button
                        key={rackNode.code}
                        type="button"
                        className={`cs-map__direct-bin-card ${
                          isActive ? 'cs-map__direct-bin-card--active' : ''
                        }`}
                        onClick={() =>
                          handleOpenChannel(aisleBin, [
                            ...currentPath,
                            rackNode.code,
                          ])
                        }
                      >
                        <div className="cs-map__chamber-general-info">
                          <span className="cs-map__shelf-code">{rackNode.code}</span>
                          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                            {t('transfer.corridorBin') || 'Corridor'} ({t('transfer.sapBinOnly') || 'SAP Bin'})
                          </span>
                        </div>
                        <span className="cs-map__shelf-abs">#{aisleBin.abs_entry}</span>
                      </button>
                    );
                  }

                  return null;
                })}
              </div>
            </div>
          )}

          {/* LEVEL 3: Physical Pallet Positions (Channel Depth View / Bus-Seat Grid) */}
          {activeChannelBin && (
            <div className="cs-map__channel-view">
              <div className="cs-map__channel-header">
                <div className="cs-map__channel-title-group">
                  <h5 className="cs-map__channel-title">
                    <span>📦 {t('transfer.palletPositions') || 'Pallet Positions'}:</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--color-primary, #0f5ca8)' }}>
                      {activeChannelBin.bin_code}
                    </span>
                  </h5>
                  <div className="cs-map__channel-subtitle">
                    <span>{t('transfer.absEntry') || 'SAP AbsEntry'}: #{activeChannelBin.abs_entry}</span>
                    <span>•</span>
                    {activeChannelBin.capacity_source === 'UNCONFIGURED' ? (
                      <span style={{ color: 'var(--color-warning, #f59e0b)', fontWeight: 600 }}>
                        ⚠️ {t('transfer.unconfiguredCapacity') || 'Unconfigured Depth'} ({t('transfer.sapBinOnly') || 'SAP Bin'})
                      </span>
                    ) : (
                      <span>
                        {t('transfer.physicalCapacity') || 'Physical Capacity'}: {activeChannelBin.capacity || activeChannelBin.positions?.length || 1} {t('transfer.palletPositions') || 'pallets'}
                      </span>
                    )}
                    <span>•</span>
                    <span className={`cs-map__alloc-pill cs-map__alloc-pill--${String(activeChannelBin.allocation_type || 'unconfigured').toLowerCase()}`}>
                      {activeChannelBin.allocation_type === 'ALLOCATABLE' && '✅ ' + (t('transfer.allocatable') || 'Allocatable')}
                      {activeChannelBin.allocation_type === 'STAGING_ONLY' && '🚚 ' + (t('transfer.stagingOnly') || 'Staging Only')}
                      {activeChannelBin.allocation_type === 'NON_ALLOCATABLE' && '⛔ ' + (t('transfer.nonAllocatable') || 'Non-Allocatable')}
                      {(!activeChannelBin.allocation_type || activeChannelBin.allocation_type === 'UNCONFIGURED') && '⚙️ ' + (t('transfer.unconfigured') || 'Unconfigured')}
                    </span>
                    <span>•</span>
                    <span>
                      {activeChannelBin.occupancy?.available ?? activeChannelBin.positions?.length ?? 1} {t('transfer.statusAvailable') || 'Available'}
                    </span>
                  </div>
                </div>

                <div className="cs-map__channel-actions">
                  {mode !== 'OUTBOUND' && !isTransferMode && selectedPosition && selectedPosition.status === 'AVAILABLE' && activeChannelBin.allocation_type === 'ALLOCATABLE' && (
                    <button
                      type="button"
                      className="cs-map__btn cs-map__btn--primary cs-map__btn--sm"
                      onClick={handleReservePosition}
                      disabled={actionLoading}
                    >
                      {actionLoading ? '⏳' : '📌'} {t('transfer.reservePosition') || 'Reserve'} #{selectedPosition.position_code}
                    </button>
                  )}

                  {mode !== 'OUTBOUND' && !isTransferMode && selectedPosition && selectedPosition.status === 'RESERVED' && (
                    <button
                      type="button"
                      className="cs-map__btn cs-map__btn--sm"
                      onClick={handleReleasePosition}
                      disabled={actionLoading}
                    >
                      {actionLoading ? '⏳' : '✕'} {t('transfer.releaseReservation') || 'Release'} #{selectedPosition.position_code}
                    </button>
                  )}

                  <button
                    type="button"
                    className="cs-map__btn cs-map__btn--sm"
                    onClick={handleBack}
                  >
                    {t('transfer.backToRacks') || '← Back to Racks'}
                  </button>
                </div>
              </div>

              {/* Sequential Pallet Placement Toolbar */}
              {mode !== 'OUTBOUND' && activeChannelBin.allocation_type === 'ALLOCATABLE' && (
                <div className="cs-map__seq-bar">
                  <div className="cs-map__seq-controls">
                    <span className="cs-map__seq-label">
                      🔢 {t('transfer.sequentialPalletCount') || 'التسكين بالترتيب المتتابع (عدد البالتات):'}
                    </span>
                    <input
                      type="number"
                      min="1"
                      max={activeChannelBin.capacity || 20}
                      value={seqPalletCount}
                      onChange={(e) => setSeqPalletCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="cs-map__seq-input"
                      disabled={seqActionLoading}
                    />
                    <button
                      type="button"
                      className="cs-map__btn cs-map__btn--sm"
                      onClick={handlePreviewSequential}
                      disabled={seqActionLoading}
                    >
                      {seqActionLoading ? '⏳' : '🔍'} {t('transfer.previewSequential') || 'معاينة الترتيب'}
                    </button>
                    <button
                      type="button"
                      className="cs-map__btn cs-map__btn--primary cs-map__btn--sm"
                      onClick={handleAllocateSequential}
                      disabled={seqActionLoading || (seqPreviewData && seqPreviewData.shortage > 0)}
                    >
                      {seqActionLoading ? '⏳' : '⚡'} {t('transfer.confirmSequential') || 'تأكيد التسكين المتتابع'}
                    </button>
                  </div>

                  {seqPreviewData && (
                    <div className={`cs-map__seq-summary ${seqPreviewData.shortage > 0 ? 'cs-map__seq-summary--warning' : 'cs-map__seq-summary--success'}`}>
                      <span>
                        {seqPreviewData.shortage > 0 ? '⚠️' : '✅'}
                        {' '}
                        {t('transfer.required') || 'المطلوب'}: <strong>{seqPreviewData.required_count}</strong>
                        {' | '}
                        {t('transfer.available') || 'المتاح'}: <strong>{seqPreviewData.available_count}</strong>
                        {seqPreviewData.shortage > 0 && (
                          <>
                            {' | '}
                            <strong style={{ color: '#ef4444' }}>
                              {t('transfer.shortage') || 'العجز'}: {seqPreviewData.shortage}
                            </strong>
                          </>
                        )}
                      </span>
                      {seqPreviewData.planned_allocations?.length > 0 && (
                        <div className="cs-map__seq-sequence-list">
                          <span>{t('transfer.sequenceOrder') || 'الترتيب المتتابع'}:</span>
                          {seqPreviewData.planned_allocations.map((p) => (
                            <span key={p.position_id} className="cs-map__seq-badge">
                              #{p.pallet_seq} ➔ {p.position_code}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Occupancy Legend */}
              <div className="cs-map__legend">
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--available" />
                  {t('transfer.statusAvailable') || 'Available'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--selected" />
                  {t('transfer.statusSelected') || 'Selected'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--reserved" />
                  {t('transfer.statusReserved') || 'Reserved'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--reserved-outbound" />
                  {t('transfer.statusReservedOutbound') || 'Reserved Outbound'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--occupied" />
                  {t('transfer.statusOccupied') || 'Occupied'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--maintenance" />
                  {t('transfer.statusMaintenance') || 'Maintenance'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--staging" />
                  {t('transfer.stagingOnly') || 'Staging'}
                </span>
                <span className="cs-map__legend-item">
                  <span className="cs-map__legend-dot cs-map__legend-dot--non-allocatable" />
                  {t('transfer.nonAllocatable') || 'Non-Allocatable'}
                </span>
              </div>

              {/* Grid of Physical Positions */}
              <div className="cs-map__positions-grid">
                {(activeChannelBin.positions || []).map((pos) => {
                  const isSelected = selectedPosition?.id === pos.id || (selectedPositionId && pos.id === selectedPositionId);
                  const isAvailable = pos.status === 'AVAILABLE';
                  const isReserved = pos.status === 'RESERVED';
                  const isReservedOutbound = pos.status === 'RESERVED_OUTBOUND';
                  const isOccupied = pos.status === 'OCCUPIED';
                  const isMaintenance = pos.status === 'MAINTENANCE';
                  const showsBatchDetails = isOccupied || isReserved;
                  const batchNumber = String(pos.current_batch_number || '').trim();
                  const batchSize = String(pos.current_batch_size || '').trim();
                  const allocType = activeChannelBin.allocation_type || 'ALLOCATABLE';
                  const isAllocatable = allocType === 'ALLOCATABLE';
                  const isOutbound = mode === 'OUTBOUND';
                  const plannedAlloc = seqPreviewData?.planned_allocations?.find((a) => a.position_id === pos.id);

                  let statusCls = 'cs-map__pos-cell--available';
                  let icon = '🟢';
                  if (isSelected) {
                    statusCls = 'cs-map__pos-cell--selected';
                    icon = '⭐';
                  } else if (isReservedOutbound) {
                    statusCls = 'cs-map__pos-cell--reserved-outbound';
                    icon = '🔒';
                  } else if (isReserved) {
                    statusCls = 'cs-map__pos-cell--reserved';
                    icon = '⏳';
                  } else if (isOccupied) {
                    statusCls = 'cs-map__pos-cell--occupied';
                    icon = '📦';
                  } else if (isMaintenance) {
                    statusCls = 'cs-map__pos-cell--maintenance';
                    icon = '⚠️';
                  } else if (allocType === 'STAGING_ONLY') {
                    statusCls = 'cs-map__pos-cell--staging';
                    icon = '🚚';
                  } else if (allocType === 'NON_ALLOCATABLE') {
                    statusCls = 'cs-map__pos-cell--non-allocatable';
                    icon = '⛔';
                  } else if (allocType === 'UNCONFIGURED') {
                    statusCls = 'cs-map__pos-cell--unconfigured';
                    icon = '⚙️';
                  }

                  if (plannedAlloc) {
                    statusCls += ' cs-map__pos-cell--planned-seq';
                  }

                  const disabled = isOutbound
                    ? (!isOccupied || !isAllocatable)
                    : (!isAvailable || !isAllocatable);

                  return (
                    <button
                      key={pos.id || pos.position_index}
                      type="button"
                      className={`cs-map__pos-cell ${statusCls}`}
                      onClick={() => handleSelectPosition(pos, activeChannelBin, currentPath)}
                      disabled={disabled && !isSelected}
                      title={`Position ${pos.position_code} [${pos.status}] - SAP Bin: ${activeChannelBin.bin_code}${pos.current_batch_number ? ` - Batch: ${pos.current_batch_number}` : ''}`}
                    >
                      {plannedAlloc && (
                        <span className="cs-map__pos-seq-indicator" title={`Pallet #${plannedAlloc.pallet_seq}`}>
                          #{plannedAlloc.pallet_seq}
                        </span>
                      )}
                      <span className="cs-map__pos-icon">{icon}</span>
                      <span className="cs-map__pos-code">{pos.position_code}</span>
                      <span className="cs-map__pos-status-text">
                        {isSelected
                          ? (t('transfer.statusSelected') || 'Selected')
                          : !isAllocatable
                          ? (t(`transfer.${allocType === 'STAGING_ONLY' ? 'stagingOnly' : allocType === 'NON_ALLOCATABLE' ? 'nonAllocatable' : 'unconfigured'}`) || allocType)
                          : isReservedOutbound
                          ? (t('transfer.statusReservedOutbound') || 'Reserved Outbound')
                          : (pos?.status ? (t(`transfer.status${pos.status.charAt(0) + pos.status.slice(1).toLowerCase()}`) || pos.status) : '')}
                      </span>
                      {showsBatchDetails && batchNumber && (
                        <span className="cs-map__pos-batch-meta">
                          <span
                            className="cs-map__pos-batch-line"
                            title={`${t('transfer.batchNumber') || 'Batch Number'}: ${batchNumber}`}
                          >
                            <span className="cs-map__pos-batch-label">{t('transfer.batchNumber') || 'Batch Number'}:</span>
                            <span className="cs-map__pos-batch-value" dir="ltr">{batchNumber}</span>
                          </span>
                          {batchSize && (
                            <span className="cs-map__pos-batch-line">
                              <span className="cs-map__pos-batch-label">{t('wizard.sizeLabel') || 'Size'}:</span>
                              <span className="cs-map__pos-batch-value">{batchSize}</span>
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Selected Position Details Box */}
              {selectedPosition && (
                <div className="cs-map__pos-meta-card">
                  <div className="cs-map__pos-meta-header">
                    <strong>
                      {mode === 'OUTBOUND'
                        ? (t('transfer.sourcePalletPosition') || 'Source Pallet Position')
                        : (t('transfer.selectedPalletPosition') || 'Selected Pallet Position')}: {selectedPosition.position_code}
                    </strong>
                    <span className="cs-map__pos-meta-badge">
                      {selectedPosition.status === 'RESERVED_OUTBOUND'
                        ? (t('transfer.statusReservedOutbound') || 'Reserved Outbound')
                        : (selectedPosition?.status ? (t(`transfer.status${selectedPosition.status.charAt(0) + selectedPosition.status.slice(1).toLowerCase()}`) || selectedPosition.status) : '')}
                    </span>
                  </div>
                  <div className="cs-map__pos-meta-grid">
                    <span>{t('transfer.fromBin') || 'SAP Bin'}: <strong>{activeChannelBin.bin_code}</strong></span>
                    <span>{t('transfer.batchNumber') || 'Batch Number'}: <strong>{selectedPosition.current_batch_number || '—'}</strong></span>
                    <span>{t('transfer.transferRef') || 'Transfer Ref'}: <strong>{selectedPosition.transfer_reference || '—'}</strong></span>
                    <span>{t('transfer.occupancy') || 'Status'}: <strong>{selectedPosition.status}</strong></span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── System Bin Notice (Informational only, non-storable) ─────────── */}
      {layoutData?.system_bins > 0 && (
        <div className="cs-map__system-notice">
          ℹ️ {t('transfer.systemBinNotice') || 'System bin excluded — non-storable'} ({layoutData.system_bins})
        </div>
      )}
    </div>
  );
}
