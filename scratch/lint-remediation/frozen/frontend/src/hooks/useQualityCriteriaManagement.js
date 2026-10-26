import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';

const emptyCriterionForm = {
  code: '',
  calculation_key: '',
  name_ar: '',
  name_en: '',
  inspection_stage: '',
  category: '',
  display_order: 0,
  is_active: true,
};

export function useQualityCriteriaManagement(toast, t) {
  const [criteria, setCriteria] = useState([]);
  const [stages, setStages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCriterion, setEditingCriterion] = useState(null);
  const [form, setForm] = useState(emptyCriterionForm);
  const [errors, setErrors] = useState({});

  const loadCriteria = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/quality/criteria/');
      setCriteria(response.data?.criteria || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCriteria.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadCriteria();
  }, [loadCriteria]);

  const loadStages = useCallback(async () => {
    setStagesLoading(true);
    try {
      const response = await API.get('/quality/inspection-stages/');
      setStages(response.data?.stages || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('inspectionStages.loadFailed'));
    } finally {
      setStagesLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadStages();
  }, [loadStages]);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const openCreateDialog = () => {
    setEditingCriterion(null);
    setForm({
      ...emptyCriterionForm,
      inspection_stage: '',
      category: categories.find((category) => category.is_active)?.id || '',
    });
    setErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (criterion) => {
    setEditingCriterion(criterion);
    setForm({
      code: criterion.code || '',
      calculation_key: criterion.calculation_key || '',
      name_ar: criterion.name_ar || '',
      name_en: criterion.name_en || '',
      inspection_stage: criterion.inspection_stage || '',
      category: criterion.category || '',
      display_order: criterion.display_order || 0,
      is_active: Boolean(criterion.is_active),
    });
    setErrors({});
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingCriterion(null);
    setErrors({});
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const saveCriterion = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        calculation_key: form.calculation_key,
        name_ar: form.name_ar,
        name_en: form.name_en,
        inspection_stage: form.inspection_stage,
        category: form.category,
        display_order: Number(form.display_order) || 0,
        is_active: form.is_active,
      };
      if (editingCriterion) {
        await API.put(`/quality/criteria/${editingCriterion.id}/`, payload);
      } else {
        await API.post('/quality/criteria/', payload);
      }
      toast.success(t('qualityCriteria.saved'));
      closeDialog();
      loadCriteria();
    } catch (error) {
      const nextErrors = error.response?.data?.errors || {};
      setErrors(nextErrors);
      toast.error(error.response?.data?.error || t('qualityCriteria.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const deleteCriterion = async (criterion) => {
    if (!window.confirm(t('qualityCriteria.deleteConfirm'))) return;
    try {
      await API.delete(`/quality/criteria/${criterion.id}/`);
      toast.success(t('qualityCriteria.deleted'));
      loadCriteria();
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCriteria.deleteFailed'));
    }
  };

  const toggleCriterion = async (criterion) => {
    try {
      await API.put(`/quality/criteria/${criterion.id}/`, {
        code: criterion.code,
        calculation_key: criterion.calculation_key,
        name_ar: criterion.name_ar,
        name_en: criterion.name_en,
        inspection_stage: criterion.inspection_stage,
        category: criterion.category,
        display_order: criterion.display_order,
        is_active: !criterion.is_active,
      });
      loadCriteria();
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCriteria.saveFailed'));
    }
  };

  const activeCount = useMemo(() => criteria.filter((criterion) => criterion.is_active).length, [criteria]);

  const filteredCriteria = useMemo(() => {
    const stageId = String(selectedStageId || '');
    const categoryId = String(selectedCategoryId || '');
    const searchText = debouncedSearch.trim().toLocaleLowerCase();
    return criteria.filter((criterion) => {
      if (stageId && String(criterion.inspection_stage) !== stageId) return false;
      if (categoryId && String(criterion.category) !== categoryId) return false;
      if (!searchText) return true;
      return (
        String(criterion.code || '').toLocaleLowerCase().includes(searchText)
        || String(criterion.name_ar || '').toLocaleLowerCase().includes(searchText)
        || String(criterion.name_en || '').toLocaleLowerCase().includes(searchText)
      );
    });
  }, [criteria, debouncedSearch, selectedCategoryId, selectedStageId]);

  return {
    criteria,
    filteredCriteria,
    stages,
    categories,
    selectedStageId,
    setSelectedStageId,
    selectedCategoryId,
    setSelectedCategoryId,
    search,
    setSearch,
    loading,
    stagesLoading,
    categoriesLoading,
    saving,
    dialogOpen,
    editingCriterion,
    form,
    errors,
    activeCount,
    loadCriteria,
    loadStages,
    loadCategories,
    openCreateDialog,
    openEditDialog,
    closeDialog,
    updateForm,
    saveCriterion,
    deleteCriterion,
    toggleCriterion,
  };
}
