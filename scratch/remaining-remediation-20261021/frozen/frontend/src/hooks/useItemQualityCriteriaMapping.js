import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';

const getWorkflowForStage = (stage) => {
  const code = String(stage?.code || '').trim().toUpperCase();
  if (code === 'RECEIVING') return 'receiving';
  return '';
};

export function useItemQualityCriteriaMapping(toast, t) {
  const [stages, setStages] = useState([]);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [selectedStageId, setSelectedStageId] = useState('');
  const [itemGroups, setItemGroups] = useState([]);
  const [itemGroupsLoading, setItemGroupsLoading] = useState(false);
  const [selectedItemGroupCode, setSelectedItemGroupCode] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [items, setItems] = useState([]);
  const itemsLoading = false;
  const [selectedItem, setSelectedItem] = useState(null);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [criteria, setCriteria] = useState([]);
  const [criteriaLoading, setCriteriaLoading] = useState(true);
  const [selectedCriteriaCategoryId, setSelectedCriteriaCategoryId] = useState('');
  const [criteriaSearch, setCriteriaSearch] = useState('');
  const [criteriaSelectionFilter, setCriteriaSelectionFilter] = useState('all');
  const [mappings, setMappings] = useState([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [selectedCriterionIds, setSelectedCriterionIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const response = await API.get('/quality/categories/', { params: { active: 'true' } });
      setCategories(response.data?.categories || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCategories.loadFailed'));
    } finally {
      setCategoriesLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const loadCriteria = useCallback(async (stageId) => {
    if (!stageId) {
      setCriteria([]);
      setCriteriaLoading(false);
      return;
    }
    setCriteriaLoading(true);
    try {
      const response = await API.get('/quality/criteria/', {
        params: { inspection_stage: stageId, active: 'true' },
      });
      setCriteria(response.data?.criteria || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCriteria.loadFailed'));
      setCriteria([]);
    } finally {
      setCriteriaLoading(false);
    }
  }, [t, toast]);

  const loadStages = useCallback(async () => {
    setStagesLoading(true);
    try {
      const response = await API.get('/quality/inspection-stages/', { params: { active: 'true' } });
      const loadedStages = response.data?.stages || [];
      setStages(loadedStages);
      setSelectedStageId((current) => current || loadedStages[0]?.id || '');
    } catch (error) {
      toast.error(error.response?.data?.error || t('inspectionStages.loadFailed'));
    } finally {
      setStagesLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadStages();
  }, [loadStages]);

  const selectStage = (stageId) => {
    setSelectedStageId(stageId);
    setSelectedItemGroupCode('');
    setItemSearch('');
    setSelectedItem(null);
    setItemGroups([]);
    setItems([]);
    setCriteria([]);
    setSelectedCriteriaCategoryId('');
    setCriteriaSearch('');
    setCriteriaSelectionFilter('all');
    setMappings([]);
    setSelectedCriterionIds([]);
  };

  const selectedStage = useMemo(
    () => stages.find((stage) => String(stage.id) === String(selectedStageId)) || null,
    [stages, selectedStageId],
  );

  const selectedWorkflow = useMemo(() => getWorkflowForStage(selectedStage), [selectedStage]);

  const loadItemGroups = useCallback(async (workflow) => {
    if (!workflow) {
      setItemGroups([]);
      return;
    }
    setItemGroupsLoading(true);
    try {
      const response = await API.get('/quality/item-groups/', { params: { workflow } });
      setItemGroups(response.data?.item_groups || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('itemCriteria.itemGroupsLoadFailed'));
      setItemGroups([]);
    } finally {
      setItemGroupsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadItemGroups(selectedWorkflow);
  }, [loadItemGroups, selectedWorkflow]);

  useEffect(() => {
    loadCriteria(selectedStageId);
  }, [loadCriteria, selectedStageId]);

  const selectItemGroup = async (groupCode) => {
    setSelectedItemGroupCode(groupCode);
    setItemSearch('');
    setSelectedItem(null);
    setItems([]);
    setMappings([]);
    setSelectedCriterionIds([]);
  };

  const searchItems = (event) => {
    event.preventDefault();
    if (!selectedItemGroupCode) {
      toast.warning(t('itemCriteria.selectItemGroupWarning'));
      return;
    }
  };

  const loadMappings = useCallback(async (itemCode, stageId = selectedStageId) => {
    if (!itemCode || !stageId) return;
    setMappingsLoading(true);
    try {
      const response = await API.get('/quality/item-criteria/', { params: { item_code: itemCode, inspection_stage: stageId } });
      const loadedMappings = response.data?.item_criteria || [];
      setMappings(loadedMappings);
      setSelectedCriterionIds(loadedMappings.map((mapping) => mapping.quality_criterion));
    } catch (error) {
      toast.error(error.response?.data?.error || t('itemCriteria.mappingsLoadFailed'));
      setMappings([]);
      setSelectedCriterionIds([]);
    } finally {
      setMappingsLoading(false);
    }
  }, [selectedStageId, t, toast]);

  const selectItem = (item) => {
    if (!selectedStageId) return;
    setSelectedItem(item);
    setSelectedCriterionIds([]);
    if (item) loadMappings(item.item_code, selectedStageId);
    else setMappings([]);
  };

  const toggleCriterion = (criterionId) => {
    setSelectedCriterionIds((current) => (
      current.includes(criterionId)
        ? current.filter((id) => id !== criterionId)
        : [...current, criterionId]
    ));
  };

  const saveMappings = async () => {
    if (!selectedItem?.item_code || !selectedStageId) return;
    setSaving(true);
    try {
      const response = await API.post('/quality/item-criteria/', {
        item_code: selectedItem.item_code,
        inspection_stage: selectedStageId,
        criterion_ids: selectedCriterionIds,
      });
      const loadedMappings = response.data?.item_criteria || [];
      setMappings(loadedMappings);
      setSelectedCriterionIds(loadedMappings.map((mapping) => mapping.quality_criterion));
      toast.success(t('itemCriteria.saved'));
    } catch (error) {
      toast.error(error.response?.data?.error || t('itemCriteria.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const activeCriteria = useMemo(
    () => criteria.filter((criterion) => criterion.is_active),
    [criteria],
  );

  const filteredCriteria = useMemo(() => {
    const categoryId = String(selectedCriteriaCategoryId || '');
    const search = criteriaSearch.trim().toLocaleLowerCase();
    return activeCriteria.filter((criterion) => {
      if (categoryId && String(criterion.category) !== categoryId) return false;

      const isSelected = selectedCriterionIds.includes(criterion.id);
      if (criteriaSelectionFilter === 'selected' && !isSelected) return false;
      if (criteriaSelectionFilter === 'unselected' && isSelected) return false;

      if (!search) return true;
      return (
        String(criterion.code || '').toLocaleLowerCase().includes(search)
        || String(criterion.name_ar || '').toLocaleLowerCase().includes(search)
        || String(criterion.name_en || '').toLocaleLowerCase().includes(search)
      );
    });
  }, [
    activeCriteria,
    criteriaSearch,
    criteriaSelectionFilter,
    selectedCriteriaCategoryId,
    selectedCriterionIds,
  ]);

  const filteredItems = useMemo(() => {
    const search = itemSearch.trim().toLocaleLowerCase();
    if (!search) return items;
    return items.filter((item) => (
      String(item.item_code || '').toLocaleLowerCase().includes(search)
      || String(item.item_name || '').toLocaleLowerCase().includes(search)
    ));
  }, [itemSearch, items]);

  const selectedCount = selectedCriterionIds.length;

  return {
    stages,
    stagesLoading,
    selectedStage,
    selectedStageId,
    selectStage,
    itemGroups,
    itemGroupsLoading,
    selectedItemGroupCode,
    selectedWorkflow,
    selectItemGroup,
    itemSearch,
    setItemSearch,
    items,
    filteredItems,
    itemsLoading,
    selectedItem,
    categories,
    categoriesLoading,
    criteria,
    activeCriteria,
    filteredCriteria,
    criteriaLoading,
    selectedCriteriaCategoryId,
    setSelectedCriteriaCategoryId,
    criteriaSearch,
    setCriteriaSearch,
    criteriaSelectionFilter,
    setCriteriaSelectionFilter,
    mappings,
    mappingsLoading,
    selectedCriterionIds,
    selectedCount,
    saving,
    searchItems,
    selectItem,
    toggleCriterion,
    saveMappings,
  };
}
