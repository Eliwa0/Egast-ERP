import React, { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography } from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import LoadingSkeleton from '../../../components/ui/LoadingSkeleton';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import scaleApi from '../services/scaleApi';
import useScaleDraftWorkflow from '../hooks/useScaleDraftWorkflow';
import ScaleDraftSummaryCard from '../components/ScaleDraftSummaryCard';
import ScalePrintableTicket from '../components/ScalePrintableTicket';

export function ScaleDraftDetailPage() {
  const { draftId } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [draft, setDraft] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState('');

  const { cancelDraft, isSubmitting } = useScaleDraftWorkflow();

  const fetchDraft = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await scaleApi.getDraft(draftId);
      if (res.success) {
        setDraft(res.data);
      }
    } catch {
      // handled
    } finally {
      setIsLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    if (draftId) fetchDraft();
  }, [draftId, fetchDraft]);

  const handlePrintTicket = async () => {
    if (isPrinting) return;
    setIsPrinting(true); setPrintError('');
    try {
      const res = await scaleApi.getDraft(draftId);
      if (!res.success || !res.data) throw new Error(t('searchControl.failed'));
      // Mount the freshly fetched manifest before opening the browser's print dialog.
      flushSync(() => setDraft(res.data));
      if (document.fonts?.ready) await document.fonts.ready;
      window.print();
    } catch {
      setPrintError(t('searchControl.failed'));
    } finally { setIsPrinting(false); }
  };

  const handleCancelDraft = async () => {
    try {
      await cancelDraft(draftId);
      setIsCancelConfirmOpen(false);
      fetchDraft();
    } catch {
      // toast shown
    }
  };

  if (isLoading) {
    return (
      <div className="page-shell">
        <LoadingSkeleton />
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="page-shell">
        <Typography variant="h6" color="error">Draft not found</Typography>
        <Button onClick={() => navigate('/scale/drafts')}>← {t('common.back')}</Button>
      </div>
    );
  }

  return (
    <div className="page-shell scale-draft-detail-page">
      <PageHeader
        eyebrow={t('scale.draftsTitle')}
        title={`#${draft.draft_number}`}
        description={`${draft.effective_vehicle_number || ''} · ${draft.vendor_name || ''} · ${draft.item_name || ''}`}
        actions={
          <Button variant="outlined" onClick={() => navigate('/scale/drafts')}>
            ← {t('common.back')}
          </Button>
        }
      />

      {/* Summary Card */}
      {printError && <Typography role="alert" color="error">{printError}</Typography>}
      <ScaleDraftSummaryCard
        draft={draft}
        onCancelDraft={() => setIsCancelConfirmOpen(true)}
        onPrintTicket={handlePrintTicket}
        isSubmitting={isSubmitting || isPrinting}
      />



      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        open={isCancelConfirmOpen}
        title={t('scale.cancelDraft')}
        message={t('scale.confirmCancelDraft')}
        onConfirm={handleCancelDraft}
        onCancel={() => setIsCancelConfirmOpen(false)}
      />

      <ScalePrintableTicket draft={draft} />
    </div>
  );
}

export default ScaleDraftDetailPage;
