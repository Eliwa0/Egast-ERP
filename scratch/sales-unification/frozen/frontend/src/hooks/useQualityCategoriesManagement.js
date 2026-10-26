import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';

const emptyCategoryForm = {
  code: '',
  name_ar: '',
  name_en: '',
  sort_order: 0,
  is_active: true,
};

export function useQualityCategoriesManagement(toast, t) {
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [form, setForm] = useState(emptyCategoryForm);
  const [errors, setErrors] = useState({});

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const params = search.trim() ? { search: search.trim() } : {};
      const response = await API.get('/quality/categories/', { params });
      setCategories(response.data?.categories || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCategories.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [search, t, toast]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const openCreateDialog = () => {
    setEditingCategory(null);
    setForm(emptyCategoryForm);
    setErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (category) => {
    setEditingCategory(category);
    setForm({
      code: category.code || '',
      name_ar: category.name_ar || '',
      name_en: category.name_en || '',
      sort_order: category.sort_order || 0,
      is_active: Boolean(category.is_active),
    });
    setErrors({});
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingCategory(null);
    setErrors({});
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        ...form,
        sort_order: Number(form.sort_order) || 0,
      };
      if (editingCategory) {
        await API.put(`/quality/categories/${editingCategory.id}/`, payload);
      } else {
        await API.post('/quality/categories/', payload);
      }
      toast.success(t('qualityCategories.saved'));
      closeDialog();
      loadCategories();
    } catch (error) {
      setErrors(error.response?.data?.errors || {});
      toast.error(error.response?.data?.error || t('qualityCategories.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = async (category) => {
    try {
      await API.put(`/quality/categories/${category.id}/`, {
        code: category.code,
        name_ar: category.name_ar,
        name_en: category.name_en,
        sort_order: category.sort_order,
        is_active: !category.is_active,
      });
      loadCategories();
    } catch (error) {
      toast.error(error.response?.data?.error || t('qualityCategories.saveFailed'));
    }
  };

  const activeCount = useMemo(() => categories.filter((category) => category.is_active).length, [categories]);

  return {
    categories,
    search,
    setSearch,
    loading,
    saving,
    dialogOpen,
    editingCategory,
    form,
    errors,
    activeCount,
    loadCategories,
    openCreateDialog,
    openEditDialog,
    closeDialog,
    updateForm,
    saveCategory,
    toggleCategory,
  };
}
