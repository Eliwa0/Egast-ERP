import { useCallback, useEffect, useMemo, useRef } from 'react';
import API from '../services/api';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import { calculateQualityMetrics } from '../utils/qualityCalculations';
import { adaptInspectionCriteriaCategories, createDefectTemplate } from '../utils/qualityCriteriaAdapter';

const FIRST_SAMPLE_STEP = 2;

const getStepForPhase = (phaseIndex) => {
  if (phaseIndex === 0) return 0;
  if (phaseIndex === 1) return 1;
  if (phaseIndex === 2) return FIRST_SAMPLE_STEP;
  if (phaseIndex === 3) return 200;
  return 201;
};

const getQualityPhase = (step, sampleCount) => {
  if (step === 0) return 0;
  if (step === 1) return 1;
  if (step >= FIRST_SAMPLE_STEP && step < FIRST_SAMPLE_STEP + sampleCount) return 2;
  if (step === 200) return 3;
  if (step === 201 || step === 202) return 4;
  return 4;
};

const pickBatchValue = (batch, keys, fallback = '') => {
  for (const key of keys) {
    const value = batch?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
};

const qualityOptionRequests = new Map();
const itemGroupInitRequests = new Map();
const QUALITY_OPTION_CACHE_MS = 5 * 60 * 1000;
const ITEM_GROUP_RETRY_DELAY_MS = 400;

const getQualityOptionRequest = (key, loader) => {
  const now = Date.now();
  const cached = qualityOptionRequests.get(key);
  if (cached?.promise) return cached.promise;
  if (cached?.expiresAt > now) return Promise.resolve(cached.value);

  const promise = loader()
    .then((value) => {
      qualityOptionRequests.set(key, {
        value,
        expiresAt: Date.now() + QUALITY_OPTION_CACHE_MS,
      });
      return value;
    })
    .catch((error) => {
      qualityOptionRequests.delete(key);
      throw error;
    });

  qualityOptionRequests.set(key, { promise });
  return promise;
};

const wait = (delayMs) => new Promise((resolve) => {
  window.setTimeout(resolve, delayMs);
});

const loadQualityItemGroups = async (workflowId, attempt = 0) => {
  const response = await API.get('/quality/item-groups/', {
    params: {
      workflow: workflowId,
      ...(attempt > 0 ? { retry: attempt } : {}),
    },
  });

  if (!response.data?.success) {
    throw new Error(response.data?.error || 'Failed to load quality item groups.');
  }

  const groups = Array.isArray(response.data.item_groups) ? response.data.item_groups : [];
  if (groups.length === 0 && attempt === 0) {
    await wait(ITEM_GROUP_RETRY_DELAY_MS);
    return loadQualityItemGroups(workflowId, attempt + 1);
  }
  return groups;
};

const getItemGroupInitRequest = (workflowId) => {
  const existing = itemGroupInitRequests.get(workflowId);
  if (existing) return existing;

  const request = loadQualityItemGroups(workflowId)
    .finally(() => {
      itemGroupInitRequests.delete(workflowId);
    });
  itemGroupInitRequests.set(workflowId, request);
  return request;
};

export function useQualityWizardController({ user, workflowConfig, workflowState }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const itemGroupRequestIdRef = useRef(0);
  const tx = useCallback((path, fallback, ...args) => {
    const value = t(path, ...args);
    return value === path ? fallback : value;
  }, [t]);

  const {
    sessionTrucks, setSessionTrucks,
    setPendingScaleDrafts,
    setPendingScaleDraftsLoading,
    setPendingScaleDraftsError,
    vendors = [],
    setVendors,
    setVendorsLoading,
    setContractorsLoading,
    setContractorsError,
    activeTruckId, setActiveTruckId,
    vendorSelectorTruckId, setVendorSelectorTruckId,
    setVendorSearch,
    activeBatchNum, setActiveBatchNum,
    activeBatchId, setActiveBatchId,
    inspectingBatch, setInspectingBatch,
    batchDrafts, setBatchDrafts,
    step, setStep,
    maxReachedStep, setMaxReachedStep,
    searchQuery,
    setIsSearching,
    setIsSubmitting,
    setSubmittedData,
    sampleCount, setSampleCount,
    samples, setSamples,
    defectCategories, setDefectCategories,
    setDefectCategoriesLoading,
    setErrors,
    metadata, setMetadata,
    setItemGroups,
    setSelectedItemGroupCode,
    setSelectedItemCode,
    setIsLoadingItems,
  } = workflowState;

  const getSelectedVendorName = useCallback((vendorCode) => {
    const normalizedCode = String(vendorCode ?? '').trim();
    if (!normalizedCode) return '';
    const vendor = Array.isArray(vendors)
      ? vendors.find((item) => String(item.code) === normalizedCode)
      : null;
    return vendor?.name || normalizedCode;
  }, [vendors]);

  const loadContractors = useCallback(() => {
    setContractorsLoading(false);
    setContractorsError('');
    return Promise.resolve([]);
  }, [setContractorsError, setContractorsLoading]);

  useEffect(() => {
    let active = true;
    setVendorsLoading(true);
    if (workflowConfig.id === 'receiving') {
      setVendorsLoading(false);
      return undefined;
    }
    const farmOptionsRequest = getQualityOptionRequest(`farms:${workflowConfig.id}:grouped-v2`, () => (
      API.get('/batch-udf-metadata/').then((response) => (
        (response.data.data?.fields?.vendor?.valid_values || []).map((item) => ({
          code: item.value,
          name: item.description || item.value,
        }))
      ))
    ));

    farmOptionsRequest
      .then((response) => {
        if (active) {
          setVendors(response);
        }
      })
      .catch((error) => {
        console.error('Failed to load quality farm options:', error?.response?.data || error);
      })
      .finally(() => {
        if (active) setVendorsLoading(false);
    });
    return () => { active = false; };
  }, [setVendors, setVendorsLoading, workflowConfig.id]);

  const loadPendingScaleDrafts = useCallback(({ isActive = () => true } = {}) => {
    if (workflowConfig.id !== 'receiving') {
      setPendingScaleDrafts([]);
      setPendingScaleDraftsLoading(false);
      setPendingScaleDraftsError('');
      return Promise.resolve([]);
    }

    setPendingScaleDraftsLoading(true);
    setPendingScaleDraftsError('');
    return API.get('/scale/quality/pending-drafts/')
      .then((response) => {
        const drafts = Array.isArray(response.data?.data) ? response.data.data : [];
        if (isActive()) setPendingScaleDrafts(drafts);
        return drafts;
      })
      .catch((error) => {
        if (!isActive()) return [];
        console.error('Failed to load pending scale drafts:', error?.response?.data || error);
        setPendingScaleDrafts([]);
        setPendingScaleDraftsError(error?.response?.data?.error || error?.message || 'Failed to load pending scale drafts.');
        return [];
      })
      .finally(() => {
        if (isActive()) setPendingScaleDraftsLoading(false);
      });
  }, [setPendingScaleDrafts, setPendingScaleDraftsError, setPendingScaleDraftsLoading, workflowConfig.id]);

  useEffect(() => {
    let active = true;
    if (user) loadPendingScaleDrafts({ isActive: () => active });
    return () => { active = false; };
  }, [loadPendingScaleDrafts, user]);

  useEffect(() => {
    let active = true;
    loadContractors({ isActive: () => active });
    return () => { active = false; };
  }, [loadContractors]);

  useEffect(() => {
    if (!workflowConfig.dynamicCriteria) {
      setDefectCategories(null);
      setDefectCategoriesLoading(false);
      return undefined;
    }
    if (!workflowConfig.inspectionStageCode) {
      setDefectCategories({});
      setDefectCategoriesLoading(false);
      return undefined;
    }

    let active = true;
    setDefectCategoriesLoading(true);
    const itemCode = String(metadata.item_code || '').trim();
    API.get('/quality/inspection-criteria/', {
      params: {
        inspection_stage: workflowConfig.inspectionStageCode,
        ...(itemCode ? { item_code: itemCode } : {}),
      },
    })
      .then((response) => adaptInspectionCriteriaCategories(response.data?.categories || []))
      .then((categories) => {
        if (active) setDefectCategories(categories);
      })
      .catch((error) => {
        console.error('Failed to load quality inspection criteria:', error?.response?.data || error);
        if (active) setDefectCategories({});
      })
      .finally(() => {
        if (active) setDefectCategoriesLoading(false);
      });
    return () => { active = false; };
  }, [
    setDefectCategories,
    setDefectCategoriesLoading,
    metadata.item_code,
    workflowConfig.dynamicCriteria,
    workflowConfig.inspectionStageCode,
  ]);

  useEffect(() => {
    if (!user) {
      setIsLoadingItems(false);
      return undefined;
    }

    let active = true;
    const requestId = itemGroupRequestIdRef.current + 1;
    itemGroupRequestIdRef.current = requestId;
    setIsLoadingItems(true);

    getItemGroupInitRequest(workflowConfig.id)
      .then((mappedGroups) => {
        if (!active || itemGroupRequestIdRef.current !== requestId) return;
        setItemGroups(mappedGroups);
      })
      .catch((err) => {
        if (!active || itemGroupRequestIdRef.current !== requestId) return;
        console.error('Error fetching quality item groups:', err);
        setItemGroups([]);
      })
      .finally(() => {
        if (active && itemGroupRequestIdRef.current === requestId) setIsLoadingItems(false);
      });

    return () => { active = false; };
  }, [setIsLoadingItems, setItemGroups, user, workflowConfig.id]);

  const selectItemGroup = (groupCode) => {
    setSelectedItemGroupCode(groupCode);
    setSelectedItemCode('');
  };


  const inspectionMaxReachedPhase = useMemo(() => getQualityPhase(maxReachedStep, sampleCount), [maxReachedStep, sampleCount]);

  const goToStep = (nextStep) => {
    setStep(nextStep);
    setMaxReachedStep((prev) => Math.max(prev, nextStep));
  };

  const handleMainStepClick = (phaseIdx) => {
    if (phaseIdx === 0) {
      if (inspectingBatch) handleCancelInspection();
      setActiveTruckId(null);
      setVendorSelectorTruckId(null);

      return;
    }
    if (phaseIdx === 1) {
      if (inspectingBatch) handleCancelInspection();
      if (activeTruckId !== null) setVendorSelectorTruckId(activeTruckId);

      return;
    }
    if (phaseIdx === 2) {
      if (inspectingBatch) handleCancelInspection();
      setVendorSelectorTruckId(null);

      return;
    }
    const targetStep = getStepForPhase(phaseIdx - 2, sampleCount);
    setStep(targetStep);
  };

  // Helper functions for trucks and batches
  const handleAddNewTruckCard = () => {
    const newTruck = {
      id: Date.now() + Math.random(),
      truck_number: '',
      contractor_name: '',
      contractor_code: '',
      farm_origin: '',
      isNew: true,
      batches: [],
    };
    setSessionTrucks((prev) => [...prev, newTruck]);
  };

  const handleUseScaleDraft = (draft) => {
    if (!draft?.scale_draft_id || draft.has_existing_inspections) return;

    const truckId = `scale-${draft.scale_draft_id}`;
    const batchId = `scale-${draft.scale_draft_id}-batch`;
    const productWeight = draft.product_weight ?? '';
    const primaryAllocation = Array.isArray(draft.allocations) ? draft.allocations[0] : null;
    const vendorCode = draft.vendor_card_code || '';
    const vendorName = draft.vendor_name || vendorCode;
    const itemCode = primaryAllocation?.item_code || draft.item_code || '';
    const itemName = primaryAllocation?.item_name || draft.item_name || itemCode;
    const draftNumber = draft.draft_number || '';

    const scaleTruck = {
      id: truckId,
      truck_number: draft.vehicle_number || '',
      contractor_name: '',
      contractor_code: '',
      farm_origin: vendorCode,
      isNew: false,
      isEditing: false,
      scale_draft_id: draft.scale_draft_id,
      scale_draft_number: draftNumber,
      batches: [
        {
          id: batchId,
          batch_number: draftNumber,
          item_code: itemCode,
          item_name: itemName,
          supplier_name: vendorName,
          sap_vendor_code: vendorCode,
          vendor_card_code: vendorCode,
          vendor_name: vendorName,
          quantity: productWeight,
          product_weight: productWeight,
          scale_draft_id: draft.scale_draft_id,
          scale_draft_number: draftNumber,
          status: 'Not Started',
          inspection_id: null,
          decision: null,
          raw_material_type: primaryAllocation?.raw_material_type || '',
          uom_code: '',
          uom_name: '',
          isNew: false,
        },
      ],
    };

    setSessionTrucks((prev) => (
      prev.some((truck) => truck.scale_draft_id === draft.scale_draft_id)
        ? prev
        : [...prev, scaleTruck]
    ));
    setActiveTruckId(truckId);
    setVendorSelectorTruckId(truckId);
    setVendorSearch('');
  };

  const handleStartInspectionForBatch = async (truck, batch) => {
    setActiveTruckId(truck.id);
    setActiveBatchId(batch.id);

    const isScaleOriginated = Boolean(batch.scale_draft_id || truck.scale_draft_id);
    const shouldSkipBatchLookup = isScaleOriginated
      || (batch.item_code && (!batch.batch_number || String(batch.batch_number).toLowerCase().startsWith('pending')));

    // Scale-originated receiving drafts are not SAP batches; direct receiving with item_code also skips lookup.
    if (batch.item_code && shouldSkipBatchLookup) {
      const draftKey = `${truck.id}_${batch.id}`;
      const draft = batchDrafts[draftKey];
      const resolvedBatchNumber = isScaleOriginated
        ? (batch.batch_number || batch.scale_draft_number || truck.scale_draft_number || '')
        : 'Pending...';
      const selectedVendorName = getSelectedVendorName(truck.farm_origin);
      const selectedVendorDisplayName = selectedVendorName && selectedVendorName !== truck.farm_origin
        ? selectedVendorName
        : (batch.supplier_name || batch.vendor_name || selectedVendorName);

      if (draft) {
        setMetadata({
          ...draft.metadata,
          supplier_name: selectedVendorDisplayName || draft.metadata?.supplier_name || '',
          sap_vendor_code: batch.sap_vendor_code || draft.metadata?.sap_vendor_code || '',
          farm_origin: truck.farm_origin || draft.metadata?.farm_origin || '',
          contractor_name: truck.contractor_name || draft.metadata?.contractor_name || '',
          car_number: truck.truck_number || draft.metadata?.car_number || '',
          batch_number: resolvedBatchNumber,
          item_code: batch.item_code,
          item_name: batch.item_name || draft.metadata?.item_name || '',
          vendor_card_code: batch.sap_vendor_code || truck.farm_origin || draft.metadata?.vendor_card_code || '',
          vendor_name: selectedVendorDisplayName || draft.metadata?.vendor_name || '',
          crop_name: batch.item_name || draft.metadata?.crop_name || '',
          raw_material_type: batch.raw_material_type || draft.metadata?.raw_material_type || '',
          uom_code: batch.uom_code || draft.metadata?.uom_code || '',
          uom_name: batch.uom_name || draft.metadata?.uom_name || batch.uom_code || '',
          quantity: batch.quantity || draft.metadata?.quantity || '',
          scale_draft_id: batch.scale_draft_id || truck.scale_draft_id || draft.metadata?.scale_draft_id || '',
        });
        setSamples(draft.samples);
        setSampleCount(draft.sampleCount);
        setStep(draft.step);
        setMaxReachedStep(draft.maxReachedStep);
      } else {
        setMetadata({
          inspection_date: new Date().toISOString().split('T')[0],
          inspector_name: user?.username || '',
          data_clerk_name: user?.username || '',
          supplier_name: selectedVendorDisplayName || '',
          sap_vendor_code: batch.sap_vendor_code || '',
          farm_origin: truck.farm_origin || '',
          contractor_name: truck.contractor_name || '',
          car_number: truck.truck_number || '',
          batch_number: resolvedBatchNumber,
          item_code: batch.item_code,
          item_name: batch.item_name || '',
          vendor_card_code: batch.sap_vendor_code || truck.farm_origin || '',
          vendor_name: selectedVendorDisplayName || '',
          crop_name: batch.item_name || '',
          raw_material_type: batch.raw_material_type || '',
          uom_code: batch.uom_code || '',
          uom_name: batch.uom_name || batch.uom_code || '',
          quantity: batch.quantity || '',
          scale_draft_id: batch.scale_draft_id || truck.scale_draft_id || '',
          notes: '',
        });
        setSampleCount(5);
        setSamples([]);
        setStep(1);
        setMaxReachedStep(1);
      }

      setActiveBatchNum(resolvedBatchNumber || 'Pending...');
      setInspectingBatch(true);
      setSubmittedData(null);
      return;

    }

    if (!batch.batch_number) {
      setActiveBatchNum(null);
      setInspectingBatch(true);
      setStep(0);
      setMaxReachedStep(0);
      setSubmittedData(null);
      return;

    }

    setIsSearching(true);

    try {
      const res = await API.get(`/quality/batches/${batch.batch_number}/`);
      const b = res.data?.batch || res.data?.data?.batch;
      if (res.data.success && b) {
        const draftKey = `${truck.id}_${batch.batch_number}`;
        const draft = batchDrafts[draftKey];

        if (draft) {
          const itemName = pickBatchValue(b, [
            'item_name',
            'itemName',
            'ItemName',
            'item_description',
            'ItemDescription',
            'product_name',
            'ProductName',
          ], draft.metadata?.item_name || '');
          setMetadata({
            ...draft.metadata,
            supplier_name: getSelectedVendorName(truck.farm_origin) || pickBatchValue(b, ['supplier_name', 'supplierName'], draft.metadata?.supplier_name || ''),
            sap_vendor_code: pickBatchValue(b, ['sap_vendor_code', 'VendorCode', 'U_vendor', 'vendor'], draft.metadata?.sap_vendor_code || ''),
            farm_origin: truck.farm_origin || pickBatchValue(b, ['farm_origin', 'farmOrigin', 'brand', 'U_Brand', 'udf_brand'], draft.metadata?.farm_origin || ''),
            contractor_name: truck.contractor_name || draft.metadata?.contractor_name || '',
            car_number: truck.truck_number || draft.metadata?.car_number || '',
            batch_number: batch.batch_number,
            item_code: pickBatchValue(b, ['item_code', 'itemCode', 'ItemCode'], draft.metadata?.item_code || ''),
            item_name: itemName,
            vendor_card_code: pickBatchValue(b, ['vendor_card_code', 'sap_vendor_code', 'VendorCode', 'U_vendor', 'vendor'], truck.farm_origin || draft.metadata?.vendor_card_code || ''),
            vendor_name: getSelectedVendorName(truck.farm_origin) || pickBatchValue(b, ['vendor_name', 'supplier_name', 'supplierName'], draft.metadata?.vendor_name || ''),
            crop_name: pickBatchValue(b, ['crop_name', 'cropName', 'CropName'], itemName),
            raw_material_type: pickBatchValue(b, ['raw_material_type', 'rawMaterialType', 'category', 'U_Category', 'udf_category'], draft.metadata?.raw_material_type || ''),
            uom_code: pickBatchValue(b, ['uom_code', 'uom', 'UoMCode', 'U_UOM', 'InventoryUOM', 'InventoryUoM'], draft.metadata?.uom_code || ''),
            uom_name: pickBatchValue(b, ['uom_name', 'uomName', 'UoMName', 'UOMName'], draft.metadata?.uom_name || draft.metadata?.uom_code || ''),
            quantity: draft.metadata?.quantity || '',
            scale_draft_id: batch.scale_draft_id || truck.scale_draft_id || draft.metadata?.scale_draft_id || '',
          });
          setSamples(draft.samples);
          setSampleCount(draft.sampleCount);
          setStep(draft.step);
          setMaxReachedStep(draft.maxReachedStep);
        } else {
          const itemName = pickBatchValue(b, [
            'item_name',
            'itemName',
            'ItemName',
            'item_description',
            'ItemDescription',
            'product_name',
            'ProductName',
          ]);
          setMetadata({
            inspection_date: new Date().toISOString().split('T')[0],
            inspector_name: user?.username || '',
            data_clerk_name: user?.username || '',
            supplier_name: getSelectedVendorName(truck.farm_origin) || pickBatchValue(b, ['supplier_name', 'supplierName']) || '',
            sap_vendor_code: pickBatchValue(b, ['sap_vendor_code', 'VendorCode', 'U_vendor', 'vendor']) || '',
            farm_origin: truck.farm_origin || pickBatchValue(b, ['farm_origin', 'farmOrigin', 'brand', 'U_Brand', 'udf_brand']),
            contractor_name: truck.contractor_name || '',
            car_number: truck.truck_number,
            batch_number: batch.batch_number,
            item_code: pickBatchValue(b, ['item_code', 'itemCode', 'ItemCode']),
            item_name: itemName,
            vendor_card_code: pickBatchValue(b, ['vendor_card_code', 'sap_vendor_code', 'VendorCode', 'U_vendor', 'vendor'], truck.farm_origin || ''),
            vendor_name: getSelectedVendorName(truck.farm_origin) || pickBatchValue(b, ['vendor_name', 'supplier_name', 'supplierName']) || '',
            crop_name: pickBatchValue(b, ['crop_name', 'cropName', 'CropName'], itemName),
            raw_material_type: pickBatchValue(b, ['raw_material_type', 'rawMaterialType', 'category', 'U_Category', 'udf_category']),
            uom_code: pickBatchValue(b, ['uom_code', 'uom', 'UoMCode', 'U_UOM', 'InventoryUOM', 'InventoryUoM']),
            uom_name: pickBatchValue(b, ['uom_name', 'uomName', 'UoMName', 'UOMName'], pickBatchValue(b, ['uom_code', 'uom', 'UoMCode', 'U_UOM', 'InventoryUOM', 'InventoryUoM'])),
            quantity: batch.quantity || '',
            scale_draft_id: batch.scale_draft_id || truck.scale_draft_id || '',
            notes: '',
          });
          setSampleCount(5);
          setSamples([]);
          setStep(1); // DIRECTLY navigate to Step 1 (Info)!
          setMaxReachedStep(1);

        }

        setActiveBatchNum(batch.batch_number);
        setInspectingBatch(true);
        setSubmittedData(null);
        toast.success(tx('quality.batchFound', 'Batch details loaded successfully.'));
      } else {
        toast.error(tx('quality.batchNotFoundErr', 'Batch metadata not found in the ERP system. Inspection cannot proceed without a valid batch.'));
      }
    } catch (err) {
      console.error(err);
      toast.error(tx('quality.batchNotFoundErr', 'Batch metadata not found in the ERP system. Inspection cannot proceed without a valid batch.'));
    } finally {
      setIsSearching(false);

    }
  };

  const handleCancelInspection = () => {
    if (activeTruckId) {
      const isPending = !activeBatchNum || activeBatchNum.toLowerCase().startsWith('pending');
      const keySuffix = isPending ? activeBatchId : activeBatchNum;
      const draftKey = `${activeTruckId}_${keySuffix}`;
      setBatchDrafts((prev) => ({
        ...prev,
        [draftKey]: {
          metadata,
          samples,
          sampleCount,
          step,
          maxReachedStep,
        },
      }));

      // Set status of this batch to In Progress
      setSessionTrucks((prev) =>
        prev.map((t) => {
          if (t.id === activeTruckId) {
            return {
              ...t,
              batches: t.batches.map((b) => {
                const match = isPending ? b.id === activeBatchId : b.batch_number === activeBatchNum;
                if (match && b.status !== 'Completed') {
                  return { ...b, status: 'In Progress' };
                }
                return b;
              }),
            };
          }
          return t;
        })
      );

    }
    setInspectingBatch(false);
    setSubmittedData(null);
  };


  const handleViewReport = async (inspectionId) => {

    try {
      const res = await API.get(`/quality/inspections/${inspectionId}/`);
      if (res.data.success) {
        setSubmittedData(res.data.data.inspection);
        setInspectingBatch(true);
        goToStep(201); // Go directly to printable Done page
      }
    } catch (err) {
      console.error(err);
      toast.error(tx('quality.loadFailed', 'Failed to load inspection report details.'));

    }
  };

  const defaultDefectTemplate = useMemo(() => ({
    acarus: 0, scale_insect: 0, spray_marks: 0, citrus_rust: 0, thrips: 0,
    vegetable_defects: 0, gummosis: 0, oil_spots: 0, sunburn: 0, sooty_mold: 0,
    mealybug: 0, tearing: 0, high_cut: 0, bruises: 0, cuts: 0, under_size: 0,
    venting: 0, fruit_fly: 0, creasing: 0, fall_drop: 0, mutations: 0,
    navel_blight: 0, softness: 0, molds: 0, grade_1: 0, grade_2: 0
  }), []);

  const activeDefectTemplate = useMemo(() => (
    workflowConfig.dynamicCriteria
      ? createDefectTemplate(defectCategories || {})
      : defaultDefectTemplate
  ), [defaultDefectTemplate, defectCategories, workflowConfig.dynamicCriteria]);

  // Sync samples length when count or active criteria changes.
  useEffect(() => {
    setSamples((prev) => {
      const next = [...prev];
      if (next.length < sampleCount) {
        for (let i = next.length; i < sampleCount; i++) {
          next.push({
            id: i + 1,
            defects: { ...activeDefectTemplate },
          });

        }
      } else if (next.length > sampleCount) {
        next.splice(sampleCount);
      }
      return next.map((sample, index) => {
        const existingDefects = sample.defects || {};
        const defects = workflowConfig.dynamicCriteria
          ? Object.keys(activeDefectTemplate).reduce((values, key) => {
            values[key] = Number(existingDefects[key] || 0);
            return values;
          }, {})
          : { ...activeDefectTemplate, ...existingDefects };
        return {
          ...sample,
          id: sample.id || index + 1,
          defects,
        };
      });
    });
  }, [activeDefectTemplate, sampleCount, setSamples, workflowConfig.dynamicCriteria]);

  const handleNextFromInfo = () => {
    if (validateMetadata()) {
      goToStep(FIRST_SAMPLE_STEP); // Go directly to first sample inspection
    }
  };

  // Batch search logic
  const handleBatchSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      toast.warning(tx('quality.enterBatchNumber', 'Please enter a batch number.'));
      return;

    }
    setIsSearching(true);

    try {
      const res = await API.get(`/quality/batches/${searchQuery.trim()}/`);
      const b = res.data?.batch || res.data?.data?.batch;
      if (res.data.success && b) {
        const foundBatchNum = pickBatchValue(b, ['batch_number', 'batchNumber', 'BatchNumber'], searchQuery.trim());
        const itemName = pickBatchValue(b, [
          'item_name',
          'itemName',
          'ItemName',
          'item_description',
          'ItemDescription',
          'product_name',
          'ProductName',
        ]);
        const truck = sessionTrucks.find((t) => t.id === activeTruckId);
        const selectedVendorCode = truck?.farm_origin || metadata.farm_origin;
        setMetadata((prev) => ({
          ...prev,
          batch_number: foundBatchNum,
          item_code: pickBatchValue(b, ['item_code', 'itemCode', 'ItemCode']),
          item_name: itemName,
          vendor_card_code: pickBatchValue(b, ['vendor_card_code', 'sap_vendor_code', 'VendorCode', 'U_vendor', 'vendor'], selectedVendorCode || prev.vendor_card_code || ''),
          vendor_name: getSelectedVendorName(selectedVendorCode) || pickBatchValue(b, ['vendor_name', 'supplier_name', 'supplierName']) || prev.vendor_name || '',
          supplier_name: getSelectedVendorName(selectedVendorCode) || pickBatchValue(b, ['supplier_name', 'supplierName']) || '',
          sap_vendor_code: pickBatchValue(b, ['sap_vendor_code', 'VendorCode', 'U_vendor', 'vendor']) || '',
          farm_origin: selectedVendorCode || prev.farm_origin || pickBatchValue(b, ['farm_origin', 'farmOrigin', 'brand', 'U_Brand', 'udf_brand']),
          contractor_name: truck?.contractor_name || prev.contractor_name || pickBatchValue(b, ['contractor_name', 'contractorName']),
          car_number: truck?.truck_number || prev.car_number || pickBatchValue(b, ['car_number', 'carNumber', 'vehicleNumber']),
          crop_name: pickBatchValue(b, ['crop_name', 'cropName', 'CropName'], itemName),
          raw_material_type: pickBatchValue(b, ['raw_material_type', 'rawMaterialType', 'category', 'U_Category', 'udf_category']),
          uom_code: pickBatchValue(b, ['uom_code', 'uom', 'UoMCode', 'U_UOM', 'InventoryUOM', 'InventoryUoM'], prev.uom_code || ''),
          uom_name: pickBatchValue(b, ['uom_name', 'uomName', 'UoMName', 'UOMName'], prev.uom_name || prev.uom_code || ''),
          scale_draft_id: prev.scale_draft_id || '',

        }));
        setActiveBatchNum(foundBatchNum);
        if (activeTruckId && activeBatchId) {
          setSessionTrucks((prev) =>
            prev.map((t) => {
              if (t.id === activeTruckId) {
                return {
                  ...t,
                  batches: t.batches.map((bRow) => {
                    if (bRow.id === activeBatchId) {
                      return { ...bRow, batch_number: foundBatchNum };
                    }
                    return bRow;
                  }),
                };
              }
              return t;
            })

          );

        }
        toast.success(tx('quality.batchFound', 'Batch details loaded successfully.'));
        goToStep(1);
      } else {
        toast.error(tx('quality.batchNotFoundErr', 'Batch metadata not found in the ERP system. Inspection cannot proceed without a valid batch.'));
      }
    } catch (err) {
      console.error(err);
      toast.error(tx('quality.batchNotFoundErr', 'Batch metadata not found in the ERP system. Inspection cannot proceed without a valid batch.'));
    } finally {
      setIsSearching(false);

    }
  };

  // Defect quantities handlers
  const validateMetadata = () => {
    const errs = workflowConfig.validateMetadata({ metadata, t, tx });
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

  const calculatedMetrics = useMemo(() => {
    return calculateQualityMetrics(samples, sampleCount);
  }, [samples, sampleCount]);

  const dynamicDefectNameByKey = useMemo(() => (
    Object.values(defectCategories || {}).reduce((names, category) => {
      (category.items || []).forEach((item) => {
        names[item.key] = lang === 'ar'
          ? (item.nameAr || item.nameEn || item.name || item.key)
          : (item.nameEn || item.nameAr || item.name || item.key);
      });
      return names;
    }, {})
  ), [defectCategories, lang]);

  const mostCommonDefect = useMemo(() => {
    let maxDefectKey = null;
    let maxQty = -1;
    for (const key in calculatedMetrics.totals) {
      if (key === 'grade_1' || key === 'grade_2') continue;
      const qty = calculatedMetrics.totals[key] || 0;
      if (qty > maxQty && qty > 0) {
        maxQty = qty;
        maxDefectKey = key;
      }

    }
    if (maxDefectKey) {
      const defectName = workflowConfig.dynamicCriteria
        ? (dynamicDefectNameByKey[maxDefectKey] || maxDefectKey)
        : tx('quality.defects.' + maxDefectKey, maxDefectKey);
      return `${defectName} (${maxQty} وحدة)`;

    }
    return "لا يوجد";
  }, [calculatedMetrics.totals, dynamicDefectNameByKey, tx, workflowConfig.dynamicCriteria]);

  // Submit report to server
  const handleSubmitReport = async () => {
    setIsSubmitting(true);

    try {
      const activeTruck = sessionTrucks.find((truck) => truck.id === activeTruckId);
      const selectedVendorCode = activeTruck?.farm_origin || metadata.farm_origin;
      const selectedVendorName = getSelectedVendorName(selectedVendorCode);
      const selectedVendorDisplayName = selectedVendorName && selectedVendorName !== selectedVendorCode
        ? selectedVendorName
        : (metadata.vendor_name || metadata.supplier_name || selectedVendorName);
      const selectedContractorName = activeTruck?.contractor_name || metadata.contractor_name;
      const payload = {
        metadata: {
          ...metadata,
          supplier_name: selectedVendorDisplayName || metadata.supplier_name,
          farm_origin: selectedVendorCode || metadata.farm_origin,
          vendor_card_code: metadata.vendor_card_code || selectedVendorCode || metadata.farm_origin,
          vendor_name: metadata.vendor_name || selectedVendorDisplayName || metadata.supplier_name,
          contractor_name: selectedContractorName || metadata.contractor_name,
          scale_draft_id: metadata.scale_draft_id || '',
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
        sample_size: sampleCount,
        samples_data: samples.map((s) => ({
          id: s.id,
          defects: s.defects,

        })),
      };

      const res = await API.post('/quality/inspections/create/', payload);
      if (res.data.success) {
        const savedInspection = {
          ...res.data.data.inspection,
          supplier_name: selectedVendorDisplayName || res.data.data.inspection.supplier_name,
          farm_origin: selectedVendorCode || res.data.data.inspection.farm_origin,
          contractor_name: selectedContractorName || res.data.data.inspection.contractor_name,
        };
        toast.success(tx('quality.submitSuccess', 'Quality Inspection report created and saved to review.'));
        setSubmittedData(savedInspection);
        if (metadata.scale_draft_id) {
          setPendingScaleDrafts((prev) => prev.map((draft) => (
            String(draft.scale_draft_id) === String(metadata.scale_draft_id)
              ? { ...draft, has_existing_inspections: true }
              : draft
          )));
        }

        // Update truck's batches list (marking it Completed)
        setSessionTrucks((prev) =>
          prev.map((t) => {
            if (t.id === activeTruckId) {
              return {
                ...t,
                batches: t.batches.map((b) => {
                  const isMatch = b.batch_number === savedInspection.batch_number || b.id === activeBatchId;
                  if (isMatch) {
                    return {
                      ...b,
                      batch_number: savedInspection.batch_number,
                      status: 'Completed',
                      inspection_id: savedInspection.id,
                      decision: savedInspection.decision,
                      item_name: savedInspection.item_name || savedInspection.item_code,
                    };
                  }
                  return b;
                }),
              };
            }
            return t;

          })
        );

        // Remove draft since inspection is complete
        setBatchDrafts((prev) => {
          const next = { ...prev };
          delete next[`${activeTruckId}_${savedInspection.batch_number}`];
          delete next[`${activeTruckId}_${activeBatchId}`];
          return next;
        });

        setInspectingBatch(true);
        goToStep(202);
      } else {
        toast.error(res.data.error || tx('quality.submitFailed', 'Failed to submit inspection report.'));
      }
    } catch (err) {
      console.error(err);
      if (err.response) {
        const backendError = err.response.data?.error || err.response.data?.message;
        toast.error(backendError || tx('quality.submitFailed', 'Failed to submit inspection report.'));
      } else {
        toast.error(tx('quality.submitNetworkError', 'Network error submitting inspection report.'));
      }
    } finally {
      setIsSubmitting(false);

    }
  };

  const inspectionPhase = getQualityPhase(step, sampleCount);
  const isOnVendorPhase = !inspectingBatch && activeTruckId !== null && vendorSelectorTruckId === activeTruckId;
  const qualityPhase = !inspectingBatch
    ? (activeTruckId === null ? 0 : isOnVendorPhase ? 1 : 2)
    : inspectionPhase + 2;
  const maxReachedPhase = !inspectingBatch
    ? (activeTruckId === null ? 0 : isOnVendorPhase ? 1 : 2)
    : inspectionMaxReachedPhase + 2;

  // Calculate session stats for live counters
  const stats = useMemo(() => {
    let totalTrucks = sessionTrucks.length;
    let totalBatches = 0;
    let completed = 0;
    let remaining = 0;

    sessionTrucks.forEach((t) => {
      totalBatches += t.batches.length;
      t.batches.forEach((b) => {
        if (b.status === 'Completed') {
          completed++;
        } else {
          remaining++;

        }

      });
    });

    return { totalTrucks, totalBatches, completed, remaining };
  }, [sessionTrucks]);

  return {
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
  };
}
