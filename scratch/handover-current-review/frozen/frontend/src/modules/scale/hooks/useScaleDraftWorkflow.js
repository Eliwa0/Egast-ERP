import { useState, useCallback } from 'react';
import scaleApi from '../services/scaleApi';
import { useToast } from '../../../components/ui/ToastProvider';
import { useI18n } from '../../../contexts/I18nContext';

export function useScaleDraftWorkflow() {
  const [currentDraft, setCurrentDraft] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  const { t } = useI18n();

  const loadDraft = useCallback(async (draftId) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.getDraft(draftId);
      if (res.success) {
        setCurrentDraft(res.data);
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [toast]);

  const recordFirstWeight = useCallback(async (payload) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.recordFirstWeight(payload);
      if (res.success) {
        setCurrentDraft(res.data);
        toast.success(res.message || `Draft #${res.data.draft_number} created successfully`);
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast]);

  const recordSecondWeight = useCallback(async (draftId, payload) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.recordSecondWeight(draftId, payload);
      if (res.success) {
        setCurrentDraft(res.data);
        toast.success(res.message || `Second weight recorded. Net: ${res.data.product_weight} KG`);
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast]);

  const saveBatches = useCallback(async (draftId, payload) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.updateDraftBatches(draftId, payload);
      if (res.success) {
        setCurrentDraft(res.data.draft);
        toast.success(t('scale.pivots') + ' ' + t('common.save'));
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast, t]);

  const saveAllocations = useCallback(async (draftId, payload) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.updateDraftAllocations(draftId, payload);
      if (res.success) {
        setCurrentDraft(res.data);
        toast.success(res.message || t('scale.allocationsSavedSuccess'));
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast, t]);

  const sendToQuality = useCallback(async (draftId) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.sendToQuality(draftId);
      if (res.success) {
        setCurrentDraft(res.data);
        toast.success(t('scale.sentToQualitySuccess', { draftNumber: res.data.draft_number }));
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast, t]);

  const cancelDraft = useCallback(async (draftId) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await scaleApi.cancelDraft(draftId);
      if (res.success) {
        setCurrentDraft(res.data);
        toast.info(res.message || `Draft #${res.data.draft_number} cancelled`);
        return res.data;
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      setError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast]);

  return {
    currentDraft,
    setCurrentDraft,
    isSubmitting,
    error,
    loadDraft,
    recordFirstWeight,
    recordSecondWeight,
    saveBatches,
    saveAllocations,
    sendToQuality,
    cancelDraft,
  };
}

export default useScaleDraftWorkflow;
