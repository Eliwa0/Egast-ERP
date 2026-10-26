import { useState } from 'react';

export function useQualityWizardState(user) {
  const [sessionTrucks, setSessionTrucks] = useState([]);
  const [pendingScaleDrafts, setPendingScaleDrafts] = useState([]);
  const [pendingScaleDraftsLoading, setPendingScaleDraftsLoading] = useState(false);
  const [pendingScaleDraftsError, setPendingScaleDraftsError] = useState('');
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorSelectorTruckId, setVendorSelectorTruckId] = useState(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [contractors, setContractors] = useState([]);
  const [contractorsLoading, setContractorsLoading] = useState(true);
  const [contractorsError, setContractorsError] = useState('');
  const [contractorSearch, setContractorSearch] = useState('');
  const [activeTruckId, setActiveTruckId] = useState(null);
  const [activeBatchNum, setActiveBatchNum] = useState(null);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [inspectingBatch, setInspectingBatch] = useState(false);
  const [batchDrafts, setBatchDrafts] = useState({});
  const [step, setStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedData, setSubmittedData] = useState(null);
  const [sampleCount, setSampleCount] = useState(5);
  const [samples, setSamples] = useState([]);
  const [defectCategories, setDefectCategories] = useState(null);
  const [defectCategoriesLoading, setDefectCategoriesLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [metadata, setMetadata] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    inspector_name: user?.username || '',
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
    vendor_card_code: '',
    vendor_name: '',
    uom_code: '',
    uom_name: '',
    quantity: '',
    scale_draft_id: '',
  });
  const [itemGroups, setItemGroups] = useState([]);
  const [selectedItemGroupCode, setSelectedItemGroupCode] = useState('');
  const [selectedItemCode, setSelectedItemCode] = useState('');
  const [batchItemGroupCodes, setBatchItemGroupCodes] = useState({});
  const [itemsByGroup, setItemsByGroup] = useState({});
  const [loadingItemGroups, setLoadingItemGroups] = useState({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  return {
    sessionTrucks, setSessionTrucks,
    pendingScaleDrafts, setPendingScaleDrafts,
    pendingScaleDraftsLoading, setPendingScaleDraftsLoading,
    pendingScaleDraftsError, setPendingScaleDraftsError,
    vendors, setVendors,
    vendorsLoading, setVendorsLoading,
    vendorSelectorTruckId, setVendorSelectorTruckId,
    vendorSearch, setVendorSearch,
    contractors, setContractors,
    contractorsLoading, setContractorsLoading,
    contractorsError, setContractorsError,
    contractorSearch, setContractorSearch,
    activeTruckId, setActiveTruckId,
    activeBatchNum, setActiveBatchNum,
    activeBatchId, setActiveBatchId,
    inspectingBatch, setInspectingBatch,
    batchDrafts, setBatchDrafts,
    step, setStep,
    maxReachedStep, setMaxReachedStep,
    searchQuery, setSearchQuery,
    isSearching, setIsSearching,
    isSubmitting, setIsSubmitting,
    submittedData, setSubmittedData,
    sampleCount, setSampleCount,
    samples, setSamples,
    defectCategories, setDefectCategories,
    defectCategoriesLoading, setDefectCategoriesLoading,
    errors, setErrors,
    metadata, setMetadata,
    itemGroups, setItemGroups,
    selectedItemGroupCode, setSelectedItemGroupCode,
    selectedItemCode, setSelectedItemCode,
    batchItemGroupCodes, setBatchItemGroupCodes,
    itemsByGroup, setItemsByGroup,
    loadingItemGroups, setLoadingItemGroups,
    isLoadingItems, setIsLoadingItems,
  };
}
