import { useCallback, useEffect, useMemo, useState } from 'react';
import API from '../services/api';

const emptyStageForm = {
  code: '',
  name_ar: '',
  name_en: '',
  sort_order: 0,
  is_active: true,
};

export function useInspectionStagesManagement(toast, t) {
  const [stages, setStages] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState(null);
  const [form, setForm] = useState(emptyStageForm);
  const [errors, setErrors] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteStep, setDeleteStep] = useState('review');
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const loadStages = useCallback(async () => {
    setLoading(true);
    try {
      const params = search.trim() ? { search: search.trim() } : {};
      const response = await API.get('/quality/inspection-stages/', { params });
      setStages(response.data?.stages || []);
    } catch (error) {
      toast.error(error.response?.data?.error || t('inspectionStages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [search, t, toast]);

  useEffect(() => {
    loadStages();
  }, [loadStages]);

  const openCreateDialog = () => {
    setEditingStage(null);
    setForm(emptyStageForm);
    setErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (stage) => {
    setEditingStage(stage);
    setForm({
      code: stage.code || '',
      name_ar: stage.name_ar || '',
      name_en: stage.name_en || '',
      sort_order: stage.sort_order || 0,
      is_active: Boolean(stage.is_active),
    });
    setErrors({});
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingStage(null);
    setErrors({});
  };

  const openDeleteDialog = (stage) => {
    setDeleteTarget(stage);
    setDeleteStep('review');
    setDeleteConfirmationText('');
    setDeleteError('');
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteStep('review');
    setDeleteConfirmationText('');
    setDeleteError('');
  };

  const continueDelete = () => {
    setDeleteStep('confirm-text');
    setDeleteConfirmationText('');
    setDeleteError('');
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const saveStage = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        ...form,
        sort_order: Number(form.sort_order) || 0,
      };
      if (editingStage) {
        await API.put(`/quality/inspection-stages/${editingStage.id}/`, payload);
      } else {
        await API.post('/quality/inspection-stages/', payload);
      }
      toast.success(t('inspectionStages.saved'));
      closeDialog();
      loadStages();
    } catch (error) {
      setErrors(error.response?.data?.errors || {});
      toast.error(error.response?.data?.error || t('inspectionStages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleStage = async (stage) => {
    try {
      await API.put(`/quality/inspection-stages/${stage.id}/`, {
        code: stage.code,
        name_ar: stage.name_ar,
        name_en: stage.name_en,
        sort_order: stage.sort_order,
        is_active: !stage.is_active,
      });
      loadStages();
    } catch (error) {
      toast.error(error.response?.data?.error || t('inspectionStages.saveFailed'));
    }
  };

  const deleteStage = async () => {
    if (!deleteTarget || deleteConfirmationText !== 'DELETE') return;
    setDeleting(true);
    setDeleteError('');
    try {
      await API.delete(`/quality/inspection-stages/${deleteTarget.id}/`);
      toast.success(t('inspectionStages.deleted'));
      setDeleteTarget(null);
      setDeleteStep('review');
      setDeleteConfirmationText('');
      setDeleteError('');
      loadStages();
    } catch (error) {
      const message = error.response?.data?.error || t('inspectionStages.deleteFailed');
      setDeleteError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const activeCount = useMemo(() => stages.filter((stage) => stage.is_active).length, [stages]);

  return {
    stages,
    search,
    setSearch,
    loading,
    saving,
    dialogOpen,
    editingStage,
    form,
    errors,
    deleteTarget,
    deleteStep,
    deleteConfirmationText,
    deleteError,
    deleting,
    activeCount,
    loadStages,
    openCreateDialog,
    openEditDialog,
    closeDialog,
    openDeleteDialog,
    closeDeleteDialog,
    continueDelete,
    setDeleteConfirmationText,
    updateForm,
    saveStage,
    toggleStage,
    deleteStage,
  };
}
