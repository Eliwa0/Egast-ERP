import StandardDropdown from '../../../components/ui/StandardDropdown';
import RemoteAutocomplete from '../../../components/ui/RemoteAutocomplete';
import { scaleFarmSearch, scaleItemSearch } from '../../../services/masterDataSearch';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  TextField,
  Button,
  IconButton,
  Paper,
  Box,
  Typography,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Divider,
  Autocomplete,
} from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import { useToast } from '../../../components/ui/ToastProvider';
import scaleApi from '../services/scaleApi';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import QuotationMatchingSection from './QuotationMatchingSection';

const receivingMasterDataCache = {
  itemGroups: null,
  itemGroupsPromise: null,
  itemsByGroup: new Map(),
  itemsPromiseByGroup: new Map(),
  itemsByCode: new Map(),
  itemsPromiseByCode: new Map(),
};

export function WeighingStageForm({
  stage = 'first', // 'first' or 'second'
  existingDraft = null,
  liveWeight = 0,
  canRecord = false,
  onSubmit,
  isSubmitting = false,
  matchedQuotation = null,
  onMatchQuotation,
  onUnmatchQuotation,
  startType: controlledStartType,
  onStartTypeChange,
}) {
  const { t } = useI18n();
  const toast = useToast();

  // Master lists
  const [itemElements, setItemElements] = useState([]);
  const sapFarms = [];
  const sapFarmsLoading = false;
  const [sapItemGroups, setSapItemGroups] = useState([]);
  const [sapItemGroupsLoading, setSapItemGroupsLoading] = useState(false);
  const sapItemsByGroup = {};
  const sapItemsLoadingByGroup = {};
  const resolvingItemCodesRef = useRef(new Set());

  // Weighing mode: 'loaded' (Loaded First) or 'empty' (Empty First)
  const [internalStartType, setInternalStartType] = useState(existingDraft?.start_type || 'loaded');
  const startType = controlledStartType !== undefined ? controlledStartType : internalStartType;

  const handleStartTypeChange = (newType) => {
    setInternalStartType(newType);
    if (onStartTypeChange) {
      onStartTypeChange(newType);
    }
    if (newType !== 'loaded' && onUnmatchQuotation) {
      onUnmatchQuotation();
    }
  };

  // Form Fields (Driver is independent from Vehicle)
  const [selectedVehicleId, setSelectedVehicleId] = useState(
    existingDraft?.vehicle?.id != null
      ? String(existingDraft.vehicle.id)
      : existingDraft?.vehicle != null
      ? String(existingDraft.vehicle)
      : ''
  );
  const [directVehicleNumber, setDirectVehicleNumber] = useState(existingDraft?.direct_vehicle_number || '');
  const [directDriverName, setDirectDriverName] = useState(existingDraft?.direct_driver_name || '');
  const [supplierName, setSupplierName] = useState(existingDraft?.vendor_name || '');
  const [supplierCardCode, setSupplierCardCode] = useState(existingDraft?.vendor_card_code || '');
  const [itemName, setItemName] = useState(existingDraft?.item_name || '');
  const [itemCode, setItemCode] = useState(existingDraft?.item_code || '');
  const [notes, setNotes] = useState(existingDraft?.notes || '');

  // Wizard active step state
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Vehicle Entry State
  const [vehicleTruckType, setVehicleTruckType] = useState('normal');
  const [vehicleNumber, setVehicleNumber] = useState(
    existingDraft?.direct_vehicle_number || existingDraft?.vehicle?.vehicle_number || ''
  );
  const [vehicleTrailers, setVehicleTrailers] = useState([]);
  const [vehicleContainers, setVehicleContainers] = useState([]);
  const [vehicleCompany, setVehicleCompany] = useState('');
  const [vehicleNotes, setVehicleNotes] = useState('');
  const [isRegisteringVehicle, setIsRegisteringVehicle] = useState(false);

  // New Item Element Creation Modal State
  const [isElementModalOpen, setIsElementModalOpen] = useState(false);
  const [isElementSubmitting, setIsElementSubmitting] = useState(false);
  const [newElementForm, setNewElementForm] = useState({
    item_code: '',
    item_name: '',
    name: '',
    weight: '',
    is_active: true,
  });

  const loadItemElements = async () => {
    try {
      const res = await scaleApi.getItemElements();
      if (res.success && res.data) {
        const list = res.data.filter((element) => element.is_active !== false);
        setItemElements(list);
        return list;
      }
    } catch {
      // ignore
    }
    return [];
  };

  const handleOpenElementModal = () => {
    setNewElementForm({
      item_code: itemCode || 'ALL',
      item_name: itemName || '',
      name: '',
      weight: '',
      is_active: true,
    });
    setIsElementModalOpen(true);
  };

  const handleSaveNewElement = async (e) => {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    if (!newElementForm.item_code.trim() || !newElementForm.name.trim() || !newElementForm.weight) {
      toast.error(t('common.requiredFields') || 'Please fill required fields');
      return;
    }

    setIsElementSubmitting(true);
    try {
      const payload = {
        item_code: newElementForm.item_code.trim(),
        item_name: newElementForm.item_name.trim(),
        name: newElementForm.name.trim(),
        weight: newElementForm.weight,
        is_active: newElementForm.is_active,
      };

      const res = await scaleApi.createItemElement(payload);
      if (res.success) {
        toast.success(t('scale.itemElementCreated') || 'Item element created successfully');

        // Optimistically add to state immediately
        if (res.data && res.data.is_active !== false) {
          const newEl = res.data;
          setItemElements((prev) => {
            const existingIndex = prev.findIndex((item) => String(item.id) === String(newEl.id));
            if (existingIndex >= 0) {
              const copy = [...prev];
              copy[existingIndex] = newEl;
              return copy;
            }
            return [...prev, newEl];
          });
        }

        // Re-fetch to ensure full synchronization
        await loadItemElements();
        setIsElementModalOpen(false);
      }
    } catch (err) {
      const errors = err?.response?.data?.errors;
      const message = errors ? JSON.stringify(errors) : err?.response?.data?.error || err.message;
      toast.error(message || 'Failed to create item element');
    } finally {
      setIsElementSubmitting(false);
    }
  };

  const parseDraftElements = () => {
    // Always return a single empty row so that we never auto-populate elements
    // from the previous weighing stage into the UI.
    return [{ item_element_id: '', name: '', count: '', unit_weight: 0, total_weight: 0, action: 'remove', isExisting: false }];
  };

  const parseDraftAllocations = (draft) => {
    const rawList = draft?.allocations || [];
    if (rawList.length > 0) {
      return rawList.map((a, idx) => ({
        id: a.id,
        line_number: a.line_number || idx + 1,
        vendor_card_code: a.vendor_card_code || '',
        vendor_name: a.vendor_name || '',
        item_group_code: '',
        item_group_name: '',
        item_code: a.item_code || '',
        item_name: a.item_name || '',
        crop_name: a.crop_name || a.item_name || '',
        raw_material_type: a.raw_material_type || '',
        batch_number: a.batch_number || '',
        farm_origin: a.farm_origin || '',
        package_type: a.package_type || 'BOX',
        package_count: a.package_count != null ? Number(a.package_count) : '',
        division_mode: a.division_mode || 'auto',
        allocated_weight: Number(a.allocated_weight || 0),
        percentage: Number(a.percentage || 0),
        notes: a.notes || '',
      }));
    }
    return [
      {
        line_number: 1,
        vendor_card_code: draft?.vendor_card_code || '',
        vendor_name: draft?.vendor_name || '',
        item_group_code: '',
        item_group_name: '',
        item_code: draft?.item_code || '',
        item_name: draft?.item_name || '',
        crop_name: draft?.item_name || '',
        raw_material_type: '',
        batch_number: '',
        farm_origin: '',
        package_type: 'BOX',
        package_count: '',
        division_mode: 'auto',
        allocated_weight: 0,
        percentage: 0,
        notes: '',
      },
    ];
  };

  // Allocations State (Multi-Item / Multi-Supplier)
  const [allocations, setAllocations] = useState(() => parseDraftAllocations(existingDraft));

  const handleAddAllocationLine = () => {
    setAllocations((prev) => [
      ...prev,
      {
        line_number: prev.length + 1,
        vendor_card_code: prev[0]?.vendor_card_code || '',
        vendor_name: prev[0]?.vendor_name || '',
        item_group_code: prev[0]?.item_group_code || '',
        item_group_name: prev[0]?.item_group_name || '',
        item_code: prev[0]?.item_code || '',
        item_name: prev[0]?.item_name || '',
        crop_name: prev[0]?.crop_name || '',
        raw_material_type: '',
        batch_number: '',
        farm_origin: '',
        package_type: 'BOX',
        package_count: '',
        division_mode: 'auto',
        allocated_weight: 0,
        percentage: 0,
        notes: '',
      },
    ]);
  };

  const handleRemoveAllocationLine = (index) => {
    setAllocations((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index).map((item, idx) => ({
        ...item,
        line_number: idx + 1,
      }));
    });
  };

  const normalizeFarm = (farm) => ({
    code: farm?.code || farm?.farmCode || '',
    name: farm?.name || farm?.farmName || farm?.code || farm?.farmCode || '',
    groupName: farm?.groupName || farm?.GroupName || '',
  });

  const findFarmOption = (allocation) => {
    const vendorCode = String(allocation?.vendor_card_code || '').trim();
    const vendorName = String(allocation?.vendor_name || '').trim();
    if (!vendorCode && !vendorName) return null;
    return sapFarms.find((farm) => (
      String(farm.code) === vendorCode
      || String(farm.name) === vendorName
    )) || vendorName;
  };

  const findItemGroupOption = (allocation) => {
    const groupCode = String(allocation?.item_group_code || '').trim();
    if (!groupCode) return null;
    return sapItemGroups.find((group) => String(group.ItmsGrpCod) === groupCode)
      || { ItmsGrpCod: groupCode, ItmsGrpNam: allocation?.item_group_name || groupCode };
  };

  const findItemOption = (allocation) => {
    const groupCode = String(allocation?.item_group_code || '').trim();
    const itemCodeValue = String(allocation?.item_code || '').trim();
    const itemNameValue = String(allocation?.item_name || '').trim();
    if (!itemCodeValue && !itemNameValue) return null;
    const groupItems = sapItemsByGroup[groupCode] || [];
    return groupItems.find((item) => (
      String(item.item_code) === itemCodeValue
      || String(item.item_name) === itemNameValue
    )) || {
      item_code: itemCodeValue,
      item_name: itemNameValue,
      item_group_code: groupCode,
    };
  };

  const normalizeSapItem = useCallback((item, fallbackGroupCode = '') => ({
    ...item,
    item_group_code: String(item?.item_group_code || item?.ItemsGroupCode || fallbackGroupCode || '').trim(),
  }), []);

  const resolveSapItemByCode = useCallback(async (itemCodeValue) => {
    const normalizedItemCode = String(itemCodeValue || '').trim();
    if (!normalizedItemCode) return null;

    const cachedItem = receivingMasterDataCache.itemsByCode.get(normalizedItemCode);
    if (cachedItem) return cachedItem;

    let requestPromise = receivingMasterDataCache.itemsPromiseByCode.get(normalizedItemCode);
    if (!requestPromise) {
      requestPromise = scaleApi.getReceivingItems('', { item_code: normalizedItemCode })
        .then((res) => {
          const matched = (res.items || []).find((item) => String(item.item_code || '').trim() === normalizedItemCode);
          const normalizedItem = matched ? normalizeSapItem(matched) : null;
          if (normalizedItem) {
            receivingMasterDataCache.itemsByCode.set(normalizedItemCode, normalizedItem);
          }
          return normalizedItem;
        })
        .catch(() => null)
        .finally(() => {
          receivingMasterDataCache.itemsPromiseByCode.delete(normalizedItemCode);
        });
      receivingMasterDataCache.itemsPromiseByCode.set(normalizedItemCode, requestPromise);
    }

    return requestPromise;
  }, [normalizeSapItem]);

  const handleAllocationVendorSelect = (index, selected) => {
    const selectedFarm = typeof selected === 'string' ? null : normalizeFarm(selected);
    const vendorCode = selectedFarm?.code || '';
    const vendorName = selectedFarm?.name || (typeof selected === 'string' ? selected : '');
    setAllocations((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        vendor_card_code: vendorCode,
        vendor_name: vendorName,
      };
      if (index === 0) {
        setSupplierCardCode(vendorCode);
        setSupplierName(vendorName);
      }
      return copy;
    });
  };

  const handleAllocationVendorInput = (index, value) => {
    setAllocations((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        vendor_card_code: '',
        vendor_name: value,
      };
      if (index === 0) {
        setSupplierCardCode('');
        setSupplierName(value);
      }
      return copy;
    });
  };

  const handleAllocationItemGroupSelect = (index, selectedGroup) => {
    const groupCode = selectedGroup ? String(selectedGroup.ItmsGrpCod) : '';
    const groupName = selectedGroup?.ItmsGrpNam || '';
    setAllocations((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        item_group_code: groupCode,
        item_group_name: groupName,
      };
      if (!groupCode) {
        copy[index] = {
          ...copy[index],
          item_code: '',
          item_name: '',
          crop_name: '',
          raw_material_type: '',
        };
        if (index === 0) {
          setItemCode('');
          setItemName('');
        }
      }
      return copy;
    });
    const currentCode = String(allocations[index]?.item_code || '');
    if (groupCode && currentCode) {
      resolveSapItemByCode(currentCode).then((item) => {
        if (!item || String(item.item_group_code) === groupCode) return;
        setAllocations((previous) => previous.map((allocation, rowIndex) => rowIndex === index
          && allocation.item_group_code === groupCode && allocation.item_code === currentCode
          ? { ...allocation, item_code: '', item_name: '', crop_name: '', raw_material_type: '' } : allocation));
        if (index === 0) { setItemCode(''); setItemName(''); }
      });
    }
  };

  const handleAllocationItemSelect = (index, selected) => {
    const selectedItem = typeof selected === 'string' ? null : selected;
    const nextItemCode = selectedItem?.item_code || '';
    const nextItemName = selectedItem?.item_name || (typeof selected === 'string' ? selected : '');
    const nextGroupCode = selectedItem?.item_group_code ? String(selectedItem.item_group_code) : '';
    setAllocations((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        item_group_code: nextGroupCode || copy[index]?.item_group_code || '',
        item_code: nextItemCode,
        item_name: nextItemName,
        crop_name: nextItemName,
        raw_material_type: selectedItem?.raw_material_type || '',
      };
      if (index === 0) {
        setItemCode(nextItemCode);
        setItemName(nextItemName);
      }
      return copy;
    });
  };

  const handleAllocationItemInput = (index, value) => {
    setAllocations((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        item_code: '',
        item_name: value,
        crop_name: value,
        raw_material_type: '',
      };
      if (index === 0) {
        setItemCode('');
        setItemName(value);
      }
      return copy;
    });
  };

  useEffect(() => {
    const targets = allocations
      .map((allocation, index) => ({
        index,
        itemCode: String(allocation?.item_code || '').trim(),
        itemGroupCode: String(allocation?.item_group_code || '').trim(),
      }))
      .filter(({ itemCode, itemGroupCode }) => itemCode && !itemGroupCode && !resolvingItemCodesRef.current.has(itemCode));

    if (targets.length === 0) return undefined;

    let cancelled = false;
    const resolveCurrentItemGroups = async () => {
      for (const target of targets) {
        resolvingItemCodesRef.current.add(target.itemCode);
        const resolvedItem = await resolveSapItemByCode(target.itemCode);
        if (cancelled || !resolvedItem?.item_group_code) continue;

        const groupCode = String(resolvedItem.item_group_code);
        setAllocations((prev) => prev.map((allocation, index) => (
          index === target.index
          && !allocation.item_group_code
          && String(allocation.item_code || '').trim() === target.itemCode
            ? {
              ...allocation,
              item_group_code: groupCode,
              item_code: resolvedItem.item_code || allocation.item_code,
              item_name: resolvedItem.item_name || allocation.item_name,
              crop_name: resolvedItem.item_name || allocation.crop_name,
              raw_material_type: resolvedItem.raw_material_type || allocation.raw_material_type,
            }
            : allocation
        )));

      }
    };

    resolveCurrentItemGroups();
    return () => { cancelled = true; };
  }, [allocations, resolveSapItemByCode]);

  // Tare Elements
  const [elements, setElements] = useState(() => parseDraftElements(existingDraft));

  // Sync with existing draft if updated/loaded
  useEffect(() => {
    if (existingDraft) {
      if (existingDraft.start_type) {
        handleStartTypeChange(existingDraft.start_type);
      }
      const vehId = existingDraft?.vehicle?.id != null ? existingDraft.vehicle.id : existingDraft?.vehicle;
      if (vehId) {
        setSelectedVehicleId(String(vehId));
      }
      if (existingDraft.direct_vehicle_number) {
        if (!directVehicleNumber) setDirectVehicleNumber(existingDraft.direct_vehicle_number);
        if (!vehicleNumber) setVehicleNumber(existingDraft.direct_vehicle_number);
      }
      if (existingDraft.direct_driver_name && !directDriverName) {
        setDirectDriverName(existingDraft.direct_driver_name);
      }
      if (existingDraft.vendor_name && !supplierName) {
        setSupplierName(existingDraft.vendor_name);
      }
      if (existingDraft.item_name && !itemName) {
        setItemName(existingDraft.item_name);
      }
      const parsedElements = parseDraftElements(existingDraft);
      if (parsedElements.length > 0) {
        setElements(parsedElements);
      }
      const parsedAllocations = parseDraftAllocations(existingDraft);
      if (parsedAllocations.length > 0) {
        setAllocations(parsedAllocations);
      }
      if (existingDraft.notes && !notes) {
        setNotes(existingDraft.notes);
      }
    }
  }, [existingDraft]);

  // Sync matched Purchase Quotation (Phase 3)
  useEffect(() => {
    if (matchedQuotation && stage === 'first') {
      const line = matchedQuotation.lines?.[matchedQuotation.line_index] || matchedQuotation.lines?.[0] || {};
      if (matchedQuotation.vendor_name) setSupplierName(matchedQuotation.vendor_name);
      if (matchedQuotation.vendor_card_code) setSupplierCardCode(matchedQuotation.vendor_card_code);
      if (line.item_name) setItemName(line.item_name);
      if (line.item_code) setItemCode(line.item_code);
      if (matchedQuotation.vehicle_number) {
        setVehicleNumber(matchedQuotation.vehicle_number);
        setDirectVehicleNumber(matchedQuotation.vehicle_number);
      }
      setAllocations((prev) => {
        if (!prev || prev.length === 0) return prev;
        const copy = [...prev];
        copy[0] = {
          ...copy[0],
          vendor_card_code: matchedQuotation.vendor_card_code || copy[0].vendor_card_code,
          vendor_name: matchedQuotation.vendor_name || copy[0].vendor_name,
          item_code: line.item_code || copy[0].item_code,
          item_name: line.item_name || copy[0].item_name,
          crop_name: line.item_name || copy[0].crop_name,
        };
        return copy;
      });
      if (currentStepIndex === 0) {
        setCurrentStepIndex(1);
      }
    }
  }, [matchedQuotation, stage]);

  // Load available tare elements
  useEffect(() => {
    loadItemElements();
  }, []);

  useEffect(() => {
    let active = true;
    setSapItemGroupsLoading(true);
    const task = receivingMasterDataCache.itemGroups
      ? Promise.resolve(receivingMasterDataCache.itemGroups)
      : (receivingMasterDataCache.itemGroupsPromise ||= scaleApi.getReceivingItemGroups()
        .then((response) => {
          if (!response.success) throw new Error('Unable to load item groups');
          receivingMasterDataCache.itemGroups = response.item_groups || [];
          return receivingMasterDataCache.itemGroups;
        }).finally(() => { receivingMasterDataCache.itemGroupsPromise = null; }));
    task.then((groups) => { if (active) setSapItemGroups(groups); })
      .catch(() => { if (active) setSapItemGroups([]); })
      .finally(() => { if (active) setSapItemGroupsLoading(false); });
    return () => { active = false; };
  }, []);



  const handleElementChange = (index, elementId) => {
    const elemObj = itemElements.find((e) => String(e.id) === String(elementId));
    setElements((prev) => {
      const updated = [...prev];
      if (!updated[index]) {
        updated[index] = { count: 1, action: 'remove', isExisting: false };
      }
      if (elemObj) {
        const unitW = Number(elemObj.weight || 0);
        const countVal = Number(updated[index].count || 1);
        updated[index] = {
          ...updated[index],
          item_element_id: elemObj.id,
          name: elemObj.name,
          unit_weight: unitW,
          total_weight: Number((unitW * countVal).toFixed(2)),
          action: 'remove',
        };
      } else {
        updated[index] = {
          ...updated[index],
          item_element_id: '',
          name: '',
          unit_weight: 0,
          total_weight: 0,
        };
      }
      return updated;
    });
  };

  const handleCountChange = (index, countVal) => {
    const parsed = parseInt(countVal, 10);
    const validCount = isNaN(parsed) || parsed < 1 ? 1 : parsed;
    setElements((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        const unitW = Number(updated[index].unit_weight || 0);
        updated[index] = {
          ...updated[index],
          count: countVal === '' ? '' : validCount,
          total_weight: Number((unitW * validCount).toFixed(2)),
        };
      }
      return updated;
    });
  };

  const handleAddRow = () => {
    setElements((prev) => [
      ...prev,
      {
        item_element_id: '',
        name: '',
        count: '',
        unit_weight: 0,
        total_weight: 0,
        action: 'remove',
        isExisting: false,
      },
    ]);
  };

  const handleRemoveRow = (index) => {
    setElements((prev) => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.length === 0
        ? [{ item_element_id: '', name: '', count: '', unit_weight: 0, total_weight: 0, action: 'remove', isExisting: false }]
        : filtered;
    });
  };



  // Dynamic Wizard Steps Definition
  const wizardSteps = useMemo(() => {
    if (stage === 'first') {
      if (startType === 'loaded') {
        return [
          { id: 'mode', label: 'نوع الحركة', description: 'تحديد نوع حركة الدخول' },
          { id: 'vehicle', label: 'المركبة', description: 'اختيار السيارة / الشاحنة' },
          { id: 'cargo', label: 'بيانات الشحنة والعملية', description: 'السائق والمورد والصنف' },
          { id: 'tare', label: 'العناصر المؤثرة', description: 'الطبالي والأقفاص' },
          { id: 'review', label: 'المراجعة والتأكيد', description: 'مراجعة وتأكيد الوزنة الأولى' },
        ];
      } else {
        return [
          { id: 'mode', label: 'نوع الحركة', description: 'تحديد نوع حركة الدخول' },
          { id: 'vehicle', label: 'المركبة', description: 'اختيار السيارة / الشاحنة' },
          { id: 'driver', label: 'بيانات السائق', description: 'تحديد السائق المشغل للمركبة' },
          { id: 'review', label: 'المراجعة والتأكيد', description: 'مراجعة وتأكيد وزنة الفارغ المرجعي' },
        ];
      }
    } else {
      // stage === 'second'
      if (existingDraft?.start_type === 'loaded') {
        return [
          { id: 'info', label: 'بيانات الشحنة', description: 'ملخص الوزنة الأولى' },
          { id: 'tare', label: 'العناصر المؤثرة', description: 'الطبالي والأقفاص' },
          { id: 'review', label: 'مراجعة وتأكيد الفارغ', description: 'تسجيل وزنة الفارغ واحتساب الصافي' },
        ];
      } else {
        return [
          { id: 'cargo', label: 'بيانات الشحنة والعملية', description: 'السائق والمورد والصنف' },
          { id: 'tare', label: 'العناصر المؤثرة', description: 'الطبالي والأقفاص' },
          { id: 'review', label: 'مراجعة وتأكيد القائم', description: 'تسجيل وزنة القائم واحتساب الصافي' },
        ];
      }
    }
  }, [stage, startType, existingDraft]);

  // Adjust step index if steps length changed
  useEffect(() => {
    if (currentStepIndex >= wizardSteps.length) {
      setCurrentStepIndex(Math.max(0, wizardSteps.length - 1));
    }
  }, [wizardSteps.length, currentStepIndex]);

  // Step Validation & Navigation
  const handleNext = async () => {
    const step = wizardSteps[currentStepIndex];
    if (step.id === 'mode') {
      if (!startType) {
        toast.error('يرجى اختيار نوع حركة الدخول');
        return;
      }
    } else if (step.id === 'vehicle') {
      if (!vehicleNumber.trim()) {
        toast.error(t('scale.vehicleNumber') + ' is required');
        return;
      }

      const cleanTrailers = vehicleTrailers.filter(t => t.trailer_number.trim() !== '');
      const cleanContainers = vehicleContainers.filter(c => c.container_number.trim() !== '');

      setIsRegisteringVehicle(true);
      try {
        const res = await scaleApi.recordVehicleEntry({
          truck_type: vehicleTruckType,
          vehicle_number: vehicleNumber.trim(),
          trailers: cleanTrailers,
          containers: cleanContainers,
          company: vehicleCompany.trim(),
          notes: vehicleNotes.trim(),
          // Exclude driver from vehicle master data registration
          driver_name: '',
        });

        if (res.success && res.data?.vehicle) {
          toast.success(res.message || 'Vehicle entry recorded');
          const found = res.data.vehicle;
          setSelectedVehicleId(String(found.id));
          setDirectVehicleNumber(found.vehicle_number);
          setVehicleNumber(found.vehicle_number);
        } else {
          toast.error('Failed to parse vehicle data.');
          setIsRegisteringVehicle(false);
          return;
        }
      } catch (err) {
        toast.error(err?.response?.data?.error || err.message || 'Failed to record entry');
        setIsRegisteringVehicle(false);
        return;
      }
      setIsRegisteringVehicle(false);
    }
    setCurrentStepIndex((prev) => Math.min(wizardSteps.length - 1, prev + 1));
  };

  const handlePrev = () => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  };

  const totalDeduction = useMemo(() => {
    return elements
      .filter((el) => Boolean(el.item_element_id))
      .reduce((sum, el) => sum + (Number(el.total_weight) || 0), 0);
  }, [elements]);

  const activeVehicleNumber = useMemo(() => {
    return directVehicleNumber || vehicleNumber || '---';
  }, [directVehicleNumber, vehicleNumber]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const validElements = elements.filter((el) => Boolean(el.item_element_id));
    
    // Filter allocations to only keep those that have some actual data
    const activeAllocations = allocations.filter(a => 
      a.vendor_name?.trim() || 
      a.vendor_card_code?.trim() || 
      a.item_name?.trim() || 
      a.item_code?.trim()
    );

    const isMeasuringEmpty = (stage === 'first' && startType === 'empty') || (stage === 'second' && startType === 'loaded');
    if (!isMeasuringEmpty && activeAllocations.length === 0 && validElements.length === 0) {
      toast.error('يجب إدخال بيانات حمولة أو عناصر مؤثرة على الأقل.');
      return;
    }

    const mappedAllocations = activeAllocations.map((a, idx) => ({
      line_number: idx + 1,
      vendor_card_code: a.vendor_card_code || '',
      vendor_name: a.vendor_name || '',
      item_code: a.item_code || '',
      item_name: a.item_name || '',
      crop_name: a.crop_name || a.item_name || '',
      raw_material_type: a.raw_material_type || '',
      batch_number: a.batch_number || '',
      farm_origin: a.farm_origin || '',
      notes: a.notes || '',
    }));

    const payload = {
      weight: liveWeight,
      elements: (stage === 'first' ? validElements : validElements.filter((el) => !el.isExisting)).map((el) => ({
        item_element_id: el.item_element_id,
        count: Number(el.count || 1),
        action: el.action || 'remove',
      })),
      allocations: mappedAllocations,
      notes,
    };

    if (stage === 'first') {
      payload.start_type = startType;
      payload.vehicle_id = selectedVehicleId ? Number(selectedVehicleId) : null;
      payload.direct_vehicle_number = (vehicleNumber || directVehicleNumber || '').trim();
      payload.direct_driver_name = directDriverName;
      payload.vendor_card_code = activeAllocations[0]?.vendor_card_code || supplierCardCode;
      payload.vendor_name = activeAllocations[0]?.vendor_name || supplierName;
      payload.item_code = activeAllocations[0]?.item_code || itemCode;
      payload.item_name = activeAllocations[0]?.item_name || itemName;
      if (matchedQuotation) {
        payload.quotation_id = matchedQuotation.id;
        payload.quotation_line_index = matchedQuotation.line_index ?? 0;
      }
    }

    if (onSubmit) {
      onSubmit(payload);
    }
  };

  const renderAllocationMasterDataFields = (allocation, index) => {
    const selectedGroupCode = String(allocation?.item_group_code || '');
    const groupItemsLoading = Boolean(sapItemsLoadingByGroup[selectedGroupCode]);

    return (
      <>
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
            {t('scale.supplier')}
          </Typography>
          <RemoteAutocomplete
            freeSolo
            searchSource={scaleFarmSearch}
            value={findFarmOption(allocation)}
            loading={sapFarmsLoading}
            isOptionEqualToValue={(option, selected) => String(option.code) === String(selected.code)}
            getOptionLabel={(option) => (typeof option === 'string' ? option : `${option.name}${option.code ? ` (${option.code})` : ''}`)}
            filterOptions={(options, state) => {
              const search = state.inputValue.trim().toLocaleLowerCase();
              if (!search) return options;
              return options.filter((farm) => (
                String(farm.code || '').toLocaleLowerCase().includes(search)
                || String(farm.name || '').toLocaleLowerCase().includes(search)
              ));
            }}
            onChange={(_event, selected) => handleAllocationVendorSelect(index, selected)}
            onInputChange={(_event, value, reason) => {
              if (reason === 'input' || reason === 'clear') handleAllocationVendorInput(index, value);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={sapFarmsLoading ? t('common.loading') : t('scale.supplierPlaceholder')}
                size="small"
                fullWidth
              />
            )}
          />
        </Box>

        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
            Item Group
          </Typography>
          <Autocomplete openOnFocus
            options={sapItemGroups}
            value={findItemGroupOption(allocation)}
            loading={sapItemGroupsLoading}
            isOptionEqualToValue={(option, selected) => String(option.ItmsGrpCod) === String(selected.ItmsGrpCod)}
            getOptionLabel={(option) => option?.ItmsGrpNam || ''}
            filterOptions={(options, state) => {
              const search = state.inputValue.trim().toLocaleLowerCase();
              if (!search) return options;
              return options.filter((group) => (
                String(group.ItmsGrpCod || '').toLocaleLowerCase().includes(search)
                || String(group.ItmsGrpNam || '').toLocaleLowerCase().includes(search)
              ));
            }}
            onChange={(_event, selectedGroup) => handleAllocationItemGroupSelect(index, selectedGroup)}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={sapItemGroupsLoading ? t('common.loading') : 'Select Item Group'}
                size="small"
                fullWidth
              />
            )}
          />
        </Box>

        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
            {t('scale.item')}
          </Typography>
          <RemoteAutocomplete
            onResults={(rows) => rows.forEach((row) => receivingMasterDataCache.itemsByCode.set(String(row.item_code), normalizeSapItem(row, selectedGroupCode)))}
            freeSolo
            className="scale-item-autocomplete"
            searchSource={{ ...scaleItemSearch, params: { item_group_code: selectedGroupCode } }}
            value={findItemOption(allocation)}
            disabled={!selectedGroupCode && !allocation?.item_code}
            loading={groupItemsLoading}
            isOptionEqualToValue={(option, selected) => String(option.item_code) === String(selected.item_code)}
            getOptionLabel={(option) => (typeof option === 'string' ? option : `${option.item_name}${option.item_code ? ` (${option.item_code})` : ''}`)}
            filterOptions={(options, state) => {
              const search = state.inputValue.trim().toLocaleLowerCase();
              if (!search) return options;
              return options.filter((item) => (
                String(item.item_code || '').toLocaleLowerCase().includes(search)
                || String(item.item_name || '').toLocaleLowerCase().includes(search)
              ));
            }}
            onChange={(_event, selected) => handleAllocationItemSelect(index, selected)}
            onInputChange={(_event, value, reason) => {
              if (reason === 'input' || reason === 'clear') handleAllocationItemInput(index, value);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={
                  !selectedGroupCode
                    ? allocation?.item_code
                      ? 'Resolving Item Group'
                      : 'Select Item Group first'
                    : groupItemsLoading
                    ? t('common.loading')
                    : t('scale.itemPlaceholder')
                }
                size="small"
                fullWidth
              />
            )}
          />
        </Box>
      </>
    );
  };

  const renderAllocationItemCorrectionFields = (allocation, index) => {
    const selectedGroupCode = String(allocation?.item_group_code || '');
    const groupItemsLoading = Boolean(sapItemsLoadingByGroup[selectedGroupCode]);

    return (
      <>
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
            Item Group / مجموعة الصنف
          </Typography>
          <Autocomplete openOnFocus
            options={sapItemGroups}
            value={findItemGroupOption(allocation)}
            loading={sapItemGroupsLoading}
            isOptionEqualToValue={(option, selected) => String(option.ItmsGrpCod) === String(selected.ItmsGrpCod)}
            getOptionLabel={(option) => option?.ItmsGrpNam || ''}
            filterOptions={(options, state) => {
              const search = state.inputValue.trim().toLocaleLowerCase();
              if (!search) return options;
              return options.filter((group) => (
                String(group.ItmsGrpCod || '').toLocaleLowerCase().includes(search)
                || String(group.ItmsGrpNam || '').toLocaleLowerCase().includes(search)
              ));
            }}
            onChange={(_event, selectedGroup) => handleAllocationItemGroupSelect(index, selectedGroup)}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={sapItemGroupsLoading ? t('common.loading') : 'Select Item Group'}
                size="small"
                fullWidth
              />
            )}
          />
        </Box>

        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
            Item / الصنف
          </Typography>
          <RemoteAutocomplete
            onResults={(rows) => rows.forEach((row) => receivingMasterDataCache.itemsByCode.set(String(row.item_code), normalizeSapItem(row, selectedGroupCode)))}
            freeSolo
            className="scale-item-autocomplete"
            searchSource={{ ...scaleItemSearch, params: { item_group_code: selectedGroupCode } }}
            value={findItemOption(allocation)}
            disabled={!selectedGroupCode && !allocation?.item_code}
            loading={groupItemsLoading}
            isOptionEqualToValue={(option, selected) => String(option.item_code) === String(selected.item_code)}
            getOptionLabel={(option) => (typeof option === 'string' ? option : `${option.item_name}${option.item_code ? ` (${option.item_code})` : ''}`)}
            filterOptions={(options, state) => {
              const search = state.inputValue.trim().toLocaleLowerCase();
              if (!search) return options;
              return options.filter((item) => (
                String(item.item_code || '').toLocaleLowerCase().includes(search)
                || String(item.item_name || '').toLocaleLowerCase().includes(search)
              ));
            }}
            onChange={(_event, selected) => handleAllocationItemSelect(index, selected)}
            onInputChange={(_event, value, reason) => {
              if (reason === 'input' || reason === 'clear') handleAllocationItemInput(index, value);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={
                  !selectedGroupCode
                    ? allocation?.item_code
                      ? 'Resolving Item Group'
                      : 'Select Item Group first'
                    : groupItemsLoading
                    ? t('common.loading')
                    : t('scale.itemPlaceholder')
                }
                size="small"
                fullWidth
              />
            )}
          />
        </Box>
      </>
    );
  };

  const currentStep = wizardSteps[currentStepIndex] || wizardSteps[0];
  const isFinalStep = currentStepIndex === wizardSteps.length - 1;

  return (
    <>
      <form onSubmit={handleSubmit} className="card-panel" style={{ marginTop: '0' }}>
        {/* Form Wizard Header */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--text)' }}>
              {stage === 'first'
                ? startType === 'loaded'
                  ? '1️⃣ الوزنة الأولى: وارد محمل (وزن القائم)'
                  : '1️⃣ الوزنة الأولى: وارد فارغ (وزن الفارغ المرجعي)'
                : existingDraft?.start_type === 'empty'
                ? '2️⃣ الوزنة الثانية: وارد فارغ (وزن القائم)'
                : '2️⃣ الوزنة الثانية: وارد محمل (وزن الفارغ)'}
            </Typography>
            <Chip
              size="small"
              label={`الخطوة ${currentStepIndex + 1} من ${wizardSteps.length}`}
              sx={{
                fontWeight: 700,
                fontSize: '0.8rem',
                bgcolor: 'var(--bg-primary-soft)',
                color: 'var(--primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm, 6px)',
              }}
            />
          </Box>

          {/* Wizard Step Indicator Bar */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              p: 1.5,
              borderRadius: 'var(--radius-md, 8px)',
              backgroundColor: 'var(--bg-soft)',
              border: '1px solid var(--border)',
              overflowX: 'auto',
            }}
          >
            {wizardSteps.map((step, idx) => {
              const isActive = idx === currentStepIndex;
              const isPassed = idx < currentStepIndex;

              return (
                <React.Fragment key={step.id}>
                  <Box
                    onClick={() => idx <= currentStepIndex && setCurrentStepIndex(idx)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      cursor: idx <= currentStepIndex ? 'pointer' : 'default',
                      opacity: idx > currentStepIndex ? 0.6 : 1,
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      sx={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        backgroundColor: isActive
                          ? 'var(--primary)'
                          : isPassed
                          ? 'var(--success)'
                          : 'var(--bg-elevated)',
                        color: isActive || isPassed ? '#ffffff' : 'var(--text-muted)',
                        border: `1px solid ${
                          isActive
                            ? 'var(--primary)'
                            : isPassed
                            ? 'var(--success)'
                            : 'var(--border)'
                        }`,
                      }}
                    >
                      {isPassed ? '✓' : idx + 1}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: isActive ? 700 : 500,
                        fontSize: '0.85rem',
                        color: isActive
                          ? 'var(--primary)'
                          : isPassed
                          ? 'var(--text)'
                          : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {step.label}
                    </Typography>
                  </Box>
                  {idx < wizardSteps.length - 1 && (
                    <Box
                      sx={{
                        flex: 1,
                        height: 2,
                        minWidth: 16,
                        backgroundColor: idx < currentStepIndex ? 'var(--success)' : 'var(--border)',
                      }}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </Box>
        </Box>

        {/* Step Content Card */}
        <Box sx={{ minHeight: 280, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* Active Matched Quotation Banner (when navigating beyond Step 1 mode selection) */}
          {matchedQuotation && currentStep.id !== 'mode' && (
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                mb: 2.5,
                borderRadius: 'var(--radius-md, 8px)',
                backgroundColor: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.08))',
                borderColor: 'var(--primary, #2563eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" fontWeight={700} color="var(--primary, #2563eb)">
                  ✓ تم ربط عرض سعر الشراء #{matchedQuotation.quotation_number} (DocEntry: {matchedQuotation.sap_doc_entry})
                </Typography>
                <Typography variant="caption" color="var(--text-muted, #64748b)">
                  — {matchedQuotation.vendor_name || matchedQuotation.vendor_card_code}
                  {matchedQuotation.lines?.[matchedQuotation.line_index]?.item_name && ` (${matchedQuotation.lines[matchedQuotation.line_index].item_name})`}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={onUnmatchQuotation}
                sx={{ py: 0.2, px: 1, fontSize: '0.75rem', fontWeight: 700 }}
              >
                إلغاء الربط ✕
              </Button>
            </Paper>
          )}

          {/* ========================================================================= */}
          {/* STEP 1: STARTING MODE                                                    */}
          {/* ========================================================================= */}
          {currentStep.id === 'mode' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: { xs: 2.5, md: 3 },
                  borderRadius: 'var(--radius-lg, 10px)',
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border)',
                }}
              >
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, color: 'var(--text)' }}>
                  اختر نوع حركة الدخول للمركبة
                </Typography>
                <Typography variant="body2" sx={{ mb: 2.5, color: 'var(--text-muted)' }}>
                  حدد ما إذا كانت المركبة واردة بحمولة لتفريغها أولاً، أو فارغة لشحن حمولة جديدة
                </Typography>

                <FormControl component="fieldset" fullWidth>
                  <RadioGroup
                    row
                    value={startType}
                    onChange={(e) => handleStartTypeChange(e.target.value)}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                      gap: 2,
                    }}
                  >
                    {/* Option 1: Loaded First */}
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderRadius: 'var(--radius-md, 8px)',
                        borderColor: startType === 'loaded' ? 'var(--primary)' : 'var(--border)',
                        backgroundColor: startType === 'loaded' ? 'var(--bg-primary-soft)' : 'var(--bg-elevated)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onClick={() => handleStartTypeChange('loaded')}
                    >
                      <FormControlLabel
                        value="loaded"
                        control={<Radio size="small" />}
                        sx={{ m: 0, width: '100%' }}
                        label={
                          <Box sx={{ ml: 1 }}>
                            <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>
                              وارد محمل — القائم أولاً
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'var(--text-muted)' }}>
                              تفريغ محصول: وزن القائم ثم وزن الفارغ
                            </Typography>
                          </Box>
                        }
                      />
                    </Paper>

                    {/* Option 2: Empty First */}
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderRadius: 'var(--radius-md, 8px)',
                        borderColor: startType === 'empty' ? 'var(--primary)' : 'var(--border)',
                        backgroundColor: startType === 'empty' ? 'var(--bg-primary-soft)' : 'var(--bg-elevated)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onClick={() => handleStartTypeChange('empty')}
                    >
                      <FormControlLabel
                        value="empty"
                        control={<Radio size="small" />}
                        sx={{ m: 0, width: '100%' }}
                        label={
                          <Box sx={{ ml: 1 }}>
                            <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>
                              وارد فارغ — الفارغ أولاً
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'var(--text-muted)' }}>
                              تحميل/شحن: وزن الفارغ المرجعي ثم وزن القائم
                            </Typography>
                          </Box>
                        }
                      />
                    </Paper>
                  </RadioGroup>
                </FormControl>
              </Paper>

              {/* IF "وارد محمل" (Loaded First): Show Purchase Quotation Cards & Filters */}
              {startType === 'loaded' && (
                <QuotationMatchingSection
                  matchedQuotation={matchedQuotation}
                  onMatchQuotation={onMatchQuotation}
                  onUnmatchQuotation={onUnmatchQuotation}
                />
              )}
            </Box>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: VEHICLE (Independent from Driver)                                 */}
          {/* ========================================================================= */}
          {currentStep.id === 'vehicle' && (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, md: 3 },
                borderRadius: 'var(--radius-lg, 10px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', mb: 3 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'var(--text)' }}>
                  المركبة / الشاحنة
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                  اختر السيارة أو الشاحنة لهذه العملية
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl component="fieldset">
                  <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
                    نوع المركبة *
                  </Typography>
                  <RadioGroup
                    row
                    value={vehicleTruckType}
                    onChange={(e) => {
                      const type = e.target.value;
                      setVehicleTruckType(type);
                      if (type === 'normal') {
                        setVehicleContainers([]);
                      }
                    }}
                  >
                    <FormControlLabel value="normal" control={<Radio size="small" />} label={t('scale.normalTruck')} />
                    <FormControlLabel value="container" control={<Radio size="small" />} label={t('scale.containerTruck')} />
                  </RadioGroup>
                </FormControl>

                <TextField
                  label={`${t('scale.vehicleNumber')} *`}
                  required
                  fullWidth
                  size="small"
                  value={vehicleNumber}
                  onChange={(e) => {
                    setVehicleNumber(e.target.value);
                    setDirectVehicleNumber(e.target.value);
                  }}
                  placeholder="e.g. TRUCK-4589"
                />

                {/* Trailers Section */}
                <Box sx={{ mt: 1, p: 2, bgcolor: 'var(--bg-muted)', borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold">المقطورات</Typography>
                    <Button 
                      size="small" 
                      onClick={() => setVehicleTrailers([...vehicleTrailers, { trailer_number: '' }])} 
                      variant="outlined"
                      sx={{ textTransform: 'none' }}
                    >
                      + إضافة مقطورة
                    </Button>
                  </Box>
                  {vehicleTrailers.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">لا توجد مقطورات مضافة لهذه الرحلة</Typography>
                  ) : (
                    vehicleTrailers.map((trailer, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                        <TextField
                          label={`مقطورة ${index + 1}`}
                          size="small"
                          fullWidth
                          value={trailer.trailer_number}
                          onChange={(e) => {
                            const copy = [...vehicleTrailers];
                            copy[index].trailer_number = e.target.value;
                            setVehicleTrailers(copy);
                          }}
                          placeholder="رقم المقطورة"
                        />
                        <IconButton color="error" size="small" onClick={() => setVehicleTrailers(vehicleTrailers.filter((_, i) => i !== index))}>
                          <span style={{ fontSize: '1.2rem' }}>&times;</span>
                        </IconButton>
                      </Box>
                    ))
                  )}
                </Box>

                {/* Containers Section */}
                {vehicleTruckType === 'container' && (
                  <Box sx={{ mt: 1, p: 2, bgcolor: 'var(--bg-muted)', borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight="bold">الحاويات</Typography>
                      <Button 
                        size="small" 
                        onClick={() => setVehicleContainers([...vehicleContainers, { container_number: '' }])} 
                        variant="outlined"
                        sx={{ textTransform: 'none' }}
                      >
                        + إضافة حاوية
                      </Button>
                    </Box>
                    {vehicleContainers.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">لا توجد حاويات مضافة لهذه الرحلة</Typography>
                    ) : (
                      vehicleContainers.map((container, index) => (
                        <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                          <TextField
                            label={`حاوية ${index + 1}`}
                            size="small"
                            fullWidth
                            value={container.container_number}
                            onChange={(e) => {
                              const copy = [...vehicleContainers];
                              copy[index].container_number = e.target.value;
                              setVehicleContainers(copy);
                            }}
                            placeholder="رقم الحاوية"
                          />
                          <IconButton color="error" size="small" onClick={() => setVehicleContainers(vehicleContainers.filter((_, i) => i !== index))}>
                            <span style={{ fontSize: '1.2rem' }}>&times;</span>
                          </IconButton>
                        </Box>
                      ))
                    )}
                  </Box>
                )}

                <TextField
                  label={t('scale.company')}
                  fullWidth
                  size="small"
                  value={vehicleCompany}
                  onChange={(e) => setVehicleCompany(e.target.value)}
                  placeholder="e.g. Fast Transport Co."
                />
                <TextField
                  label={t('scale.notes')}
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  value={vehicleNotes}
                  onChange={(e) => setVehicleNotes(e.target.value)}
                />
              </Box>
            </Paper>
          )}

          {/* ========================================================================= */}
          {/* STEP: DRIVER ONLY (for Empty-First First Weighing)                         */}
          {/* ========================================================================= */}
          {currentStep.id === 'driver' && (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, md: 3 },
                borderRadius: 'var(--radius-lg, 10px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, color: 'var(--text)' }}>
                بيانات السائق والتشغيل
              </Typography>
              <Typography variant="body2" sx={{ mb: 2.5, color: 'var(--text-muted)' }}>
                أدخل اسم السائق القائم بعملية وزن المركبة الفارغة
              </Typography>

              <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
                  {t('scale.driver')}
                </Typography>
                <TextField
                  placeholder="اسم السائق القائم بالعملية"
                  value={directDriverName}
                  onChange={(e) => setDirectDriverName(e.target.value)}
                  size="small"
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      height: '44px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-muted)',
                      color: 'var(--text)',
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      border: 'none',
                    },
                    '& input': {
                      color: 'var(--text)',
                    },
                  }}
                />
              </Box>
            </Paper>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: CARGO & MULTI-ALLOCATION (SUPPLIERS / ITEMS / BATCHES)            */}
          {/* ========================================================================= */}
          {currentStep.id === 'cargo' && (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, md: 3 },
                borderRadius: 'var(--radius-lg, 10px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                <div>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'var(--text)' }}>
                    {t('scale.cargoStepTitle')}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                    {t('scale.cargoStepSubtitle')}
                  </Typography>
                </div>
                {allocations.length > 1 && (
                  <Chip
                    label={t('scale.allocatedLinesCount', allocations.length)}
                    color="primary"
                    size="small"
                    sx={{ fontWeight: 700 }}
                  />
                )}
              </Box>

              {/* Driver Input (Common for all load lines) */}
              <Box sx={{ width: '100%', mb: 3, mt: 1 }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--text-muted)' }}>
                  {t('scale.driver')}
                </Typography>
                <TextField
                  placeholder={t('scale.driverPlaceholder')}
                  value={directDriverName}
                  onChange={(e) => setDirectDriverName(e.target.value)}
                  size="small"
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      height: '44px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-muted)',
                      color: 'var(--text)',
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      border: 'none',
                    },
                    '& input': {
                      color: 'var(--text)',
                    },
                  }}
                />
              </Box>

              <Divider sx={{ my: 2.5, borderColor: 'var(--border)' }} />

              {/* CASE 1: Single Allocation (Standard Clean & Simple Form) */}
              {allocations.length <= 1 ? (
                <Box>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                      columnGap: '20px',
                      rowGap: '20px',
                      width: '100%',
                    }}
                  >
                    {renderAllocationMasterDataFields(allocations[0] || {}, 0)}

                  </Box>

                  {/* Add Multi-Allocation Button */}
                  <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-start' }}>
                    <Button
                      variant="outlined"
                      color="primary"
                      onClick={handleAddAllocationLine}
                      sx={{
                        borderRadius: 'var(--radius-md, 8px)',
                        fontWeight: 700,
                        borderStyle: 'dashed',
                        borderWidth: '1.5px',
                        px: 2.5,
                        py: 1,
                      }}
                    >
                      {t('scale.addAllocationLineMulti')}
                    </Button>
                  </Box>
                </Box>
              ) : (
                /* CASE 2: Multi-Allocation (Multiple Suppliers / Items / Batches) */
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="subtitle2" fontWeight={800} sx={{ color: 'var(--text)' }}>
                      {t('scale.allocationTitle')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>

                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {allocations.map((alloc, idx) => {
                      return (
                        <Paper
                          key={idx}
                          variant="outlined"
                          sx={{
                            p: 2,
                            borderRadius: 'var(--radius-md, 8px)',
                            backgroundColor: 'var(--bg-soft)',
                            borderColor: 'var(--border)',
                            position: 'relative',
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Chip
                                label={t('scale.lineItemNum', idx + 1)}
                                size="small"
                                color="primary"
                                sx={{ fontWeight: 800 }}
                              />
                            </Box>
                            {allocations.length > 1 && (
                              <Button
                                size="small"
                                color="error"
                                onClick={() => handleRemoveAllocationLine(idx)}
                                sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem' }}
                              >
                                {t('scale.removeAllocationLine')}
                              </Button>
                            )}
                          </Box>

                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                              gap: 1.5,
                            }}
                          >
                            {renderAllocationMasterDataFields(alloc, idx)}

                          </Box>
                        </Paper>
                      );
                    })}
                  </Box>

                  <Box sx={{ mt: 2.5, display: 'flex', justifyContent: 'flex-start' }}>
                    <Button
                      variant="outlined"
                      color="primary"
                      onClick={handleAddAllocationLine}
                      sx={{
                        borderRadius: 'var(--radius-md, 8px)',
                        fontWeight: 700,
                        borderStyle: 'dashed',
                        px: 2.5,
                        py: 1,
                      }}
                    >
                      {t('scale.addAllocationLine')}
                    </Button>
                  </Box>
                </Box>
              )}
            </Paper>
          )}

          {/* ========================================================================= */}
          {/* STEP 4: TARE / AFFECTED ELEMENTS                                         */}
          {/* ========================================================================= */}
          {currentStep.id === 'tare' && (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, md: 3 },
                borderRadius: 'var(--radius-lg, 10px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <div>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'var(--text)' }}>
                    📦 {t('scale.tareAdjustments')} (العناصر المؤثرة)
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                    أضف الطبالي أو الأقفاص لحساب خصم الوزن تلقائياً
                  </Typography>
                </div>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  onClick={handleOpenElementModal}
                  sx={{ borderRadius: 'var(--radius-md, 6px)', textTransform: 'none', fontWeight: 600 }}
                >
                  + {t('scale.newItemElement')}
                </Button>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {elements.map((row, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: 'minmax(200px, 1fr) 110px 140px 40px' },
                      alignItems: 'center',
                      gap: 1.5,
                      p: 1.25,
                      borderRadius: 'var(--radius-md, 8px)',
                      backgroundColor: 'var(--bg-soft)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {/* Element Selector */}
                    <Box sx={{ minWidth: 0, '& .responsive-select': { mb: 0 } }}>
                      <SearchableSelect
                        aria-label={t('scale.elementName')}
                        value={String(row.item_element_id || '')}
                        onChange={(val) => handleElementChange(idx, val)}
                        options={[
                          { value: '', label: `-- ${t('scale.selectElement')} --` },
                          ...itemElements.map((el) => ({
                            value: String(el.id),
                            label: `${el.name} (${Number(el.weight).toFixed(2)} KG)`,
                          })),
                        ]}
                      />
                    </Box>

                    {/* Quantity */}
                    <Box sx={{ minWidth: 0 }}>
                      <input
                        type="number"
                        min="1"
                        value={row.count}
                        onChange={(e) => handleCountChange(idx, e.target.value)}
                        placeholder={t('scale.count') || 'العدد / الكمية'}
                        title={t('scale.count') || 'العدد / الكمية'}
                        style={{
                          width: '100%',
                          height: '44px',
                          minHeight: '44px',
                          boxSizing: 'border-box',
                          textAlign: 'center',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                          padding: '0 8px',
                          borderRadius: 'var(--radius-sm, 6px)',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-muted)',
                          color: 'var(--text)',
                          outline: 'none',
                          fontFamily: 'inherit',
                        }}
                      />
                    </Box>

                    {/* Calculated Deduction (Read-only) */}
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '44px',
                        boxSizing: 'border-box',
                        px: 1.5,
                        borderRadius: 'var(--radius-sm, 6px)',
                        backgroundColor: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600, lineHeight: 1.1 }}>
                        إجمالي الخصم
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          color: row.total_weight > 0 ? 'var(--primary)' : 'var(--text)',
                          lineHeight: 1.2,
                        }}
                      >
                        {row.total_weight > 0 ? `${Number(row.total_weight).toFixed(2)} KG` : '0.00 KG'}
                      </Typography>
                    </Box>

                    {/* Delete Button */}
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '44px' }}>
                      {elements.length > 1 || Boolean(row.item_element_id) ? (
                        <IconButton
                          type="button"
                          size="small"
                          color="error"
                          onClick={() => handleRemoveRow(idx)}
                          title={t('common.remove') || 'حذف'}
                          sx={{
                            p: 0.75,
                            borderRadius: 'var(--radius-sm, 4px)',
                            '&:hover': { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
                          }}
                        >
                          ✕
                        </IconButton>
                      ) : (
                        <Box sx={{ width: 28 }} />
                      )}
                    </Box>
                  </Box>
                ))}

                <Box sx={{ display: 'flex', justifyContent: 'center', pt: 0.5 }}>
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    onClick={handleAddRow}
                    sx={{
                      px: 3,
                      py: 0.75,
                      fontWeight: 600,
                      borderRadius: 'var(--radius-md, 6px)',
                      borderStyle: 'dashed',
                    }}
                  >
                    + إضافة عنصر مؤثر آخر
                  </Button>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    pt: 1.5,
                    mt: 0.5,
                    borderTop: '1px solid var(--border)',
                    px: 1,
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>
                    إجمالي خصم العناصر
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary)' }}>
                    {totalDeduction.toFixed(2)} KG
                  </Typography>
                </Box>
              </Box>
            </Paper>
          )}

          {/* ========================================================================= */}
          {/* STEP: 2nd WEIGHING INFO SUMMARY                                          */}
          {/* ========================================================================= */}
          {currentStep.id === 'info' && (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, md: 3 },
                borderRadius: 'var(--radius-lg, 10px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2, color: 'var(--text)' }}>
                ملخص بيانات التذكرة والوزنة الأولى
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, 1fr)' }, gap: 2.5 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>{t('scale.vehicle')}</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>{existingDraft?.effective_vehicle_number || '---'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>{t('scale.driver')}</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>{existingDraft?.direct_driver_name || existingDraft?.driver_name || '---'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>{t('scale.supplier')}</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>{existingDraft?.vendor_name || '---'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                    {existingDraft?.start_type === 'empty' ? 'الوزنة الأولى (وزن الفارغ المرجعي)' : 'الوزنة الأولى (وزن القائم)'}
                  </Typography>
                  <Typography variant="body1" fontWeight={800} sx={{ color: 'var(--primary)' }}>
                    {existingDraft?.start_type === 'empty'
                      ? `${existingDraft?.net_weight_empty || existingDraft?.weight_empty || 0} KG`
                      : `${existingDraft?.net_weight_loaded || existingDraft?.weight_loaded || 0} KG`}
                  </Typography>
                </Box>
                {existingDraft?.quotation && (
                  <Box>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>عرض سعر الشراء:</Typography>
                    <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--primary)' }}>
                      #{existingDraft.quotation_number || existingDraft.quotation}
                      {existingDraft.quotation_sap_doc_entry ? ` (SAP: ${existingDraft.quotation_sap_doc_entry})` : ''}
                    </Typography>
                  </Box>
                )}
              </Box>

              <Divider sx={{ my: 2.5 }} />

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
                {renderAllocationItemCorrectionFields(allocations[0] || {}, 0)}
              </Box>
            </Paper>
          )}

          {/* ========================================================================= */}
          {/* STEP: REVIEW & FINAL SUBMIT                                              */}
          {/* ========================================================================= */}
          {currentStep.id === 'review' && (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, md: 3 },
                borderRadius: 'var(--radius-lg, 10px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 2, color: 'var(--text)' }}>
                ملخص المراجعة قبل تسجيل الوزنة
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 2,
                  p: 2,
                  borderRadius: 'var(--radius-md, 8px)',
                  backgroundColor: 'var(--bg-soft)',
                  border: '1px solid var(--border)',
                  mb: 2.5,
                }}
              >
                <div>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>المركبة / الشاحنة:</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>{activeVehicleNumber}</Typography>
                </div>
                <div>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>السائق المشغل للعملية:</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--text)' }}>{directDriverName || '---'}</Typography>
                </div>
                <div>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>نوع حركة الدخول:</Typography>
                  <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--text)' }}>
                    {startType === 'loaded' ? 'وارد محمل — القائم أولاً' : 'وارد فارغ — الفارغ أولاً'}
                  </Typography>
                </div>
                {supplierName && (
                  <div>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>المورد / المزرعة:</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--text)' }}>{supplierName}</Typography>
                  </div>
                )}
                {itemName && (
                  <div>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>الصنف / المحصول:</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--text)' }}>{itemName}</Typography>
                  </div>
                )}
                {(matchedQuotation || existingDraft?.quotation) && (
                  <div>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>عرض سعر الشراء المرتبط:</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--primary)' }}>
                      #{matchedQuotation?.doc_num || existingDraft?.quotation_number || existingDraft?.quotation}
                    </Typography>
                  </div>
                )}
                <div>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>قراءة الميزان الحالية:</Typography>
                  <Typography variant="h6" fontWeight={800} sx={{ color: 'var(--primary)' }}>
                    {Number(liveWeight).toLocaleString()} KG
                  </Typography>
                </div>
                {totalDeduction > 0 && (
                  <div>
                    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>{t('scale.tareDeductionTotal')}</Typography>
                    <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--warning)' }}>
                      - {totalDeduction.toFixed(2)} KG
                    </Typography>
                  </div>
                )}
              </Box>

              {/* Multi-Allocation Breakdown Preview (if > 1) */}
              {allocations.length > 1 && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    mb: 2.5,
                    borderRadius: 'var(--radius-md, 8px)',
                    backgroundColor: 'var(--bg-soft)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1, color: 'var(--text)' }}>
                    {t('scale.allocatedBreakdownPreview', allocations.length)}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {allocations.map((a, i) => (
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          py: 0.5,
                          borderBottom: i < allocations.length - 1 ? '1px dashed var(--border)' : 'none',
                          fontSize: '0.85rem',
                        }}
                      >
                        <div>
                          <strong>{a.vendor_name || t('scale.supplier')}</strong> — {a.item_name || t('scale.item')} {a.batch_number ? `(${a.batch_number})` : ''}
                        </div>
                      </Box>
                    ))}
                  </Box>
                </Paper>
              )}

              {/* Optional Notes */}
              <TextField
                label={t('scale.notes')}
                multiline
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أية ملاحظات إضافية عن حالة المركبة أو السائق..."
                fullWidth
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: 'var(--bg-muted)',
                    color: 'var(--text)',
                    borderColor: 'var(--border)',
                  },
                  '& .MuiInputLabel-root': {
                    color: 'var(--text-muted)',
                  },
                }}
              />
            </Paper>
          )}
        </Box>

        {/* Wizard Footer Navigation Controls */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pt: 3,
            mt: 3,
            borderTop: '1px solid var(--border)',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Button
            type="button"
            variant="outlined"
            onClick={handlePrev}
            disabled={currentStepIndex === 0 || isSubmitting || isRegisteringVehicle}
            sx={{
              borderRadius: 'var(--radius-md, 8px)',
              fontWeight: 600,
              px: 3,
              py: 1,
            }}
          >
            ← السابق
          </Button>

          {!isFinalStep ? (
            <Button
              type="button"
              variant="contained"
              color="primary"
              onClick={handleNext}
              disabled={isSubmitting || isRegisteringVehicle}
              sx={{
                borderRadius: 'var(--radius-md, 8px)',
                fontWeight: 700,
                px: 4,
                py: 1,
              }}
            >
              {isRegisteringVehicle ? 'جاري التسجيل...' : 'التالي ←'}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={!canRecord || isSubmitting}
              sx={{
                borderRadius: 'var(--radius-md, 8px)',
                fontWeight: 800,
                px: 4,
                py: 1.25,
                fontSize: '0.95rem',
                backgroundColor: canRecord ? 'var(--primary)' : undefined,
              }}
            >
              {isSubmitting
                ? t('common.pleaseWait')
                : stage === 'first'
                ? startType === 'loaded'
                  ? `✓ تسجيل وزن القائم (${Number(liveWeight).toLocaleString()} KG)`
                  : `✓ تسجيل وزن الفارغ (${Number(liveWeight).toLocaleString()} KG)`
                : existingDraft?.start_type === 'empty'
                ? `✓ تسجيل وزن القائم (${Number(liveWeight).toLocaleString()} KG)`
                : `✓ تسجيل وزن الفارغ (${Number(liveWeight).toLocaleString()} KG)`}
            </Button>
          )}
        </Box>
      </form>

      {/* New Item Element Creation Modal (Rendered outside the parent weighing form) */}
      <Dialog
        open={isElementModalOpen}
        onClose={() => !isElementSubmitting && setIsElementModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: 'var(--text)' }}>
          {t('scale.newItemElement')}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label={t('scale.itemCode')}
              required
              fullWidth
              value={newElementForm.item_code}
              onChange={(e) => setNewElementForm({ ...newElementForm, item_code: e.target.value })}
              placeholder="e.g. ITEM-STRAWBERRY or ALL"
            />
            <TextField
              label={t('scale.itemName')}
              fullWidth
              value={newElementForm.item_name}
              onChange={(e) => setNewElementForm({ ...newElementForm, item_name: e.target.value })}
              placeholder="e.g. Strawberries"
            />
            <TextField
              label={t('scale.elementName')}
              required
              fullWidth
              value={newElementForm.name}
              onChange={(e) => setNewElementForm({ ...newElementForm, name: e.target.value })}
              placeholder="e.g. Wood Pallet, Plastic Crate..."
              autoFocus
            />
            <TextField
              label={t('scale.unitWeight')}
              required
              fullWidth
              type="number"
              inputProps={{ min: '0', step: '0.01' }}
              value={newElementForm.weight}
              onChange={(e) => setNewElementForm({ ...newElementForm, weight: e.target.value })}
              placeholder="Weight in KG (e.g. 20.00)"
            />
            <StandardDropdown
              label={t('common.status')}
              fullWidth
              value={String(newElementForm.is_active)}
              allowClear={false}
              onChange={(e) => setNewElementForm({ ...newElementForm, is_active: e.target.value === 'true' })}
            >
              <option value="true">{t('scale.active')}</option>
              <option value="false">{t('scale.inactive')}</option>
            </StandardDropdown>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            type="button"
            onClick={() => setIsElementModalOpen(false)}
            color="inherit"
            disabled={isElementSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="contained"
            color="primary"
            onClick={handleSaveNewElement}
            disabled={isElementSubmitting}
          >
            {isElementSubmitting ? t('common.pleaseWait') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default WeighingStageForm;
