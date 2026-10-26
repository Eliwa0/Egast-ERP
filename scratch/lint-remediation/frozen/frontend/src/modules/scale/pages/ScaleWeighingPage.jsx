import { PrintActionButton } from '../../../components/ui/ActionIconButton';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Button, Typography, Paper, Chip, CircularProgress, TextField } from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import ScaleStepper from '../components/ScaleStepper';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import scaleApi from '../services/scaleApi';
import useLiveScaleWeight from '../hooks/useLiveScaleWeight';
import useScaleDraftWorkflow from '../hooks/useScaleDraftWorkflow';
import LiveWeightDisplay from '../components/LiveWeightDisplay';
import WeighingStageForm from '../components/WeighingStageForm';
import ShippingSecondWeight from '../components/ShippingSecondWeight';

import ScaleDraftSummaryCard from '../components/ScaleDraftSummaryCard';
import VehicleEntryModal from '../components/VehicleEntryModal';
import VirtualScaleControlPanel from '../components/VirtualScaleControlPanel';
import ScalePrintableTicket from '../components/ScalePrintableTicket';

export function ScaleWeighingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Devices & Active Device
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('scale_virtual_001');

  // Resume Draft query param
  const resumeDraftId = searchParams.get('resume_draft');

  // Flow Stage Selection: null | 'first' | 'second'
  const [stageSelection, setStageSelection] = useState(resumeDraftId ? 'second' : null);

  // Matched Purchase Quotation state (Phase 3)
  const [matchedQuotation, setMatchedQuotation] = useState(null);
  const [startType, setStartType] = useState('loaded');

  // Successfully saved First Weight draft state
  const [completedFirstWeightDraft, setCompletedFirstWeightDraft] = useState(null);

  // Pending Drafts for Second Weighing
  const [pendingDrafts, setPendingDrafts] = useState([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [pendingSearch, setPendingSearch] = useState('');

  // Live scale hook
  const {
    weight,
    weightFormatted,
    isStable,
    isOnline,
    canRecordWeight,
    deviceName,
    dataAgeSeconds,
    error: liveError,
    isLoading: isLiveLoading,
    refresh: refreshLiveWeight,
  } = useLiveScaleWeight(selectedDeviceId);

  // Draft workflow hook
  const {
    currentDraft,
    setCurrentDraft,
    isSubmitting,
    loadDraft,
    recordFirstWeight,
    recordSecondWeight,
    cancelDraft,
  } = useScaleDraftWorkflow();

  // Modals
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [createdVehicle, setCreatedVehicle] = useState(null);

  // Load devices list
  useEffect(() => {
    scaleApi
      .getDevices()
      .then((res) => {
        if (res.success && res.data && res.data.devices) {
          setDevices(res.data.devices);
          if (res.data.devices.length > 0) {
            setSelectedDeviceId((current) => current || res.data.devices[0].device_id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Fetch pending drafts for second weight
  const fetchPendingDrafts = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoadingPending(true);
    try {
      const res = await scaleApi.getDrafts({ status: 'SECOND_WEIGHT_PENDING' });
      if (res.success && res.data) {
        setPendingDrafts(res.data.drafts || res.data || []);
      }
    } catch {
      // ignore
    } finally {
      if (!quiet) setIsLoadingPending(false);
    }
  }, []);

  // Load existing draft if resuming
  useEffect(() => {
    if (resumeDraftId) {
      setStageSelection('second');
      loadDraft(resumeDraftId);
    }
  }, [resumeDraftId, loadDraft]);

  // When second stage is chosen without draft, load pending drafts list
  useEffect(() => {
    if (stageSelection === 'second' && !currentDraft) {
      fetchPendingDrafts();
      const timer = window.setInterval(() => fetchPendingDrafts(true), 15000);
      return () => window.clearInterval(timer);
    }
  }, [stageSelection, currentDraft, fetchPendingDrafts]);

  const shippingDraftId = currentDraft?.shipping_manifest && currentDraft.status === 'SECOND_WEIGHT_PENDING' ? currentDraft.id : null;
  useEffect(() => {
    if (!shippingDraftId || isSubmitting) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const response = await scaleApi.getDraft(shippingDraftId);
        if (active && response.success) setCurrentDraft((previous) => previous?.id === shippingDraftId ? response.data : previous);
      } catch { /* The operator can refresh the manifest explicitly. */ }
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [shippingDraftId, isSubmitting, setCurrentDraft]);

  // Filtered pending drafts for second weight
  const filteredPendingDrafts = useMemo(() => {
    if (!pendingSearch.trim()) return pendingDrafts;
    const q = pendingSearch.trim().toLowerCase();
    return pendingDrafts.filter((d) => {
      const veh = String(d.effective_vehicle_number || d.vehicle?.vehicle_number || '').toLowerCase();
      const driver = String(d.effective_driver_name || d.direct_driver_name || d.driver_name || d.vehicle?.driver_name || '').toLowerCase();
      const vendor = String(d.vendor_name || '').toLowerCase();
      const item = String(d.item_name || '').toLowerCase();
      const num = String(d.draft_number || '').toLowerCase();
      return veh.includes(q) || driver.includes(q) || vendor.includes(q) || item.includes(q) || num.includes(q);
    });
  }, [pendingDrafts, pendingSearch]);

  const handleFirstWeightSubmit = async (formData) => {
    try {
      formData.scale_device_id = devices.find((d) => d.device_id === selectedDeviceId)?.id || null;
      if (matchedQuotation) {
        formData.quotation_id = matchedQuotation.id;
        formData.quotation_line_index = matchedQuotation.line_index || 0;
      }
      const saved = await recordFirstWeight(formData);
      if (saved) {
        setCompletedFirstWeightDraft(saved);
        setMatchedQuotation(null);
      }
    } catch {
      // toast shown in hook
    }
  };

  const handleSecondWeightSubmit = async (formData) => {
    if (!currentDraft) return;
    try {
      await recordSecondWeight(currentDraft.id, formData);
    } catch {
      // toast shown in hook
    }
  };

  const handleCancelDraft = async () => {
    if (!currentDraft) return;
    try {
      await cancelDraft(currentDraft.id);
      setIsCancelConfirmOpen(false);
    } catch {
      // toast shown in hook
    }
  };

  const handleStartNewDraft = () => {
    setCurrentDraft(null);
    setCompletedFirstWeightDraft(null);
    setMatchedQuotation(null);
    setStartType('loaded');
    setStageSelection('first');
    navigate('/scale/weighing', { replace: true });
  };

  const handleReturnToStageSelection = () => {
    setCurrentDraft(null);
    setCompletedFirstWeightDraft(null);
    setMatchedQuotation(null);
    setStageSelection(null);
    navigate('/scale/weighing', { replace: true });
  };

  const handleReturnToPendingList = () => {
    setCurrentDraft(null);
    setCompletedFirstWeightDraft(null);
    setMatchedQuotation(null);
    setStageSelection('second');
    fetchPendingDrafts();
    navigate('/scale/weighing', { replace: true });
  };

  return (
    <div className="page-shell scale-weighing-page">
      <style>{`
        .scale-weighing-page {
          width: min(1200px, calc(100% - 32px));
          margin: 0 auto;
          padding: var(--space-5, 24px) 0;
        }
        .scale-weighing-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(360px, 400px);
          gap: 24px;
          align-items: start;
        }
        @media (max-width: 1024px) {
          .scale-weighing-grid {
            grid-template-columns: 1fr;
          }
        }
        .scale-weighing-page .card-panel,
        .scale-weighing-page form.card-panel {
          margin-top: 0 !important;
          background: var(--color-surface, var(--bg-elevated, #ffffff));
          border: 1px solid var(--color-border, var(--border, #e2e8f0));
          border-radius: var(--radius-lg, 12px);
          box-shadow: var(--shadow-sm, 0 4px 12px rgba(15, 35, 52, 0.06));
          color: var(--color-text, var(--text, #0f172a));
        }
        html[data-theme='dark'] .scale-weighing-page .card-panel,
        html[data-theme='dark'] .scale-weighing-page form.card-panel {
          background-color: var(--bg-elevated, #1e293b) !important;
          border-color: var(--border, #334155) !important;
          color: var(--text, #f8fafc) !important;
        }
        .scale-stepper-card {
          margin-bottom: 24px;
          background: var(--color-surface, var(--bg-elevated, #ffffff));
          border: 1px solid var(--color-border, var(--border, #e2e8f0));
          border-radius: var(--radius-lg, 12px);
          padding: 14px 20px;
          box-shadow: var(--shadow-sm, 0 4px 12px rgba(15, 35, 52, 0.06));
        }
        html[data-theme='dark'] .scale-stepper-card {
          background: var(--bg-elevated, #1e293b);
          border-color: var(--border, #334155);
        }
        .scale-weighing-page .wizard-stepbar-wrap {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }
        .scale-weighing-page .wizard-step {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: transparent;
          border: none;
          padding: 6px 12px;
          border-radius: var(--radius-md, 8px);
          cursor: pointer;
          transition: all 0.2s ease;
          color: var(--color-text-muted, var(--text-muted, #64748b));
        }
        .scale-weighing-page .wizard-step.active {
          color: var(--color-primary, var(--primary, #2563eb));
          font-weight: 700;
          background: var(--color-primary-soft, var(--bg-primary-soft, rgba(37, 99, 235, 0.08)));
        }
        .scale-weighing-page .wizard-step.complete {
          color: var(--color-success, var(--success, #16803c));
          font-weight: 600;
        }
        .scale-weighing-page .wizard-step__circle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          font-size: 13px;
          font-weight: 700;
          border: 2px solid var(--color-border, var(--border, #cbd5e1));
          background: var(--color-surface, var(--bg-elevated, #ffffff));
          color: var(--color-text-muted, var(--text-muted, #64748b));
        }
        .scale-weighing-page .wizard-step.active .wizard-step__circle {
          border-color: var(--color-primary, var(--primary, #2563eb));
          background: var(--color-primary, var(--primary, #2563eb));
          color: var(--on-accent, #ffffff);
        }
        .scale-weighing-page .wizard-step.complete .wizard-step__circle {
          border-color: var(--color-success, var(--success, #16803c));
          background: var(--color-success, var(--success, #16803c));
          color: var(--on-accent, #ffffff);
        }
        .scale-weighing-page .wizard-stepbar-connector {
          flex: 1;
          height: 2px;
          background: var(--color-border, var(--border, #e2e8f0));
          margin: 0 8px;
        }
        .scale-weighing-page .scale-side-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .scale-weighing-page .scale-device-selector-card {
          background: var(--color-surface, var(--bg-elevated, #ffffff));
          border: 1px solid var(--color-border, var(--border, #e2e8f0));
          border-radius: var(--radius-lg, 12px);
          padding: 16px;
          box-shadow: var(--shadow-sm, 0 4px 12px rgba(15, 35, 52, 0.06));
        }
        html[data-theme='dark'] .scale-weighing-page .scale-device-selector-card {
          background: var(--bg-elevated, #1e293b);
          border-color: var(--border, #334155);
        }
        .scale-weighing-page .scale-live-display {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .scale-weighing-page .scale-live-display__readout {
          letter-spacing: -0.03em;
        }
        .scale-weighing-page .scale-simulator-wrapper .MuiPaper-root {
          background-color: var(--color-surface, var(--bg-elevated, #ffffff)) !important;
          border: 1px solid var(--color-border, var(--border, #e2e8f0)) !important;
          border-radius: var(--radius-lg, 12px) !important;
          box-shadow: var(--shadow-sm, 0 4px 12px rgba(15, 35, 52, 0.06)) !important;
          padding: 14px 16px !important;
        }
        html[data-theme='dark'] .scale-weighing-page .scale-simulator-wrapper .MuiPaper-root {
          background-color: var(--bg-elevated, #1e293b) !important;
          border-color: var(--border, #334155) !important;
        }
        .scale-weighing-page .page-header button {
          border-radius: var(--radius-md, 8px);
          font-weight: 700;
        }
      `}</style>

      {!currentDraft && !stageSelection && (
        <Box>
          <PageHeader
            eyebrow={t('scale.title')}
            title="محطة التوزين"
            description="اختر المرحلة التي تريد العمل عليها"
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 3,
              mt: 2,
              mb: 4,
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 'var(--radius-lg, 14px)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: 'var(--primary)',
                  boxShadow: 'var(--shadow-md)',
                  transform: 'translateY(-2px)',
                },
              }}
              onClick={() => setStageSelection('first')}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5, mb: 3 }}>
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: 'var(--radius-md, 12px)',
                    backgroundColor: 'var(--bg-primary-soft)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.85rem',
                    flexShrink: 0,
                  }}
                >
                  ⚖️
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={800} color="var(--text)" sx={{ mb: 0.75 }}>
                    الوزنة الأولى
                  </Typography>
                  <Typography variant="body2" color="var(--text-muted)" sx={{ lineHeight: 1.6 }}>
                    تسجيل دخول مركبة وبدء عملية الوزن
                  </Typography>
                </Box>
              </Box>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                size="large"
                onClick={(e) => {
                  e.stopPropagation();
                  setStageSelection('first');
                }}
                sx={{
                  borderRadius: 'var(--radius-md, 8px)',
                  fontWeight: 700,
                  py: 1.4,
                  fontSize: '0.95rem',
                }}
              >
                ابدأ الوزنة الأولى ←
              </Button>
            </Paper>
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: 'var(--radius-lg, 14px)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: 'var(--success)',
                  boxShadow: 'var(--shadow-md)',
                  transform: 'translateY(-2px)',
                },
              }}
              onClick={() => {
                setStageSelection('second');
                fetchPendingDrafts();
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5, mb: 3 }}>
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: 'var(--radius-md, 12px)',
                    backgroundColor: 'var(--bg-success-soft)',
                    color: 'var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.85rem',
                    flexShrink: 0,
                  }}
                >
                  🚛
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={800} color="var(--text)" sx={{ mb: 0.75 }}>
                    الوزنة الثانية
                  </Typography>
                  <Typography variant="body2" color="var(--text-muted)" sx={{ lineHeight: 1.6 }}>
                    استكمال وزن مركبة مسجلة بالفعل
                  </Typography>
                </Box>
              </Box>
              <Button
                variant="contained"
                fullWidth
                size="large"
                onClick={(e) => {
                  e.stopPropagation();
                  setStageSelection('second');
                  fetchPendingDrafts();
                }}
                sx={{
                  borderRadius: 'var(--radius-md, 8px)',
                  fontWeight: 700,
                  py: 1.4,
                  fontSize: '0.95rem',
                  backgroundColor: 'var(--success)',
                  color: '#ffffff',
                  '&:hover': { opacity: 0.9 },
                }}
              >
                استكمال الوزنة الثانية ←
              </Button>
            </Paper>
          </Box>
        </Box>
      )}

      {!currentDraft && stageSelection === 'second' && (
        <Box>
          <PageHeader
            eyebrow={t('scale.title')}
            title="استكمال الوزنة الثانية"
            description="اختر المركبة / المسودة لاستكمال وزنها وتفريغ أو شحن الحمولة"
            actions={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleReturnToPendingList}
                  sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 600 }}
                >
                  الوزنة الثانية
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  onClick={handleStartNewDraft}
                  sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 700 }}
                >
                  وزنة أولى جديدة
                </Button>
              </Box>
            }
          />
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              mb: 3,
              borderRadius: 'var(--radius-lg, 12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border)',
            }}
          >
            <TextField
              size="small"
              placeholder="بحث برقم السيارة، السائق، المورد، أو رقم المسودة..."
              value={pendingSearch}
              onChange={(e) => setPendingSearch(e.target.value)}
              sx={{ minWidth: { xs: '100%', sm: 340 }, flex: 1 }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => fetchPendingDrafts()}
              disabled={isLoadingPending}
              sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 600 }}
            >
              🔄 تحديث القائمة
            </Button>
          </Paper>

          {isLoadingPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress size={36} />
            </Box>
          ) : filteredPendingDrafts.length === 0 ? (
            <Paper
              variant="outlined"
              sx={{
                p: 6,
                textAlign: 'center',
                borderRadius: 'var(--radius-lg, 12px)',
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border)',
              }}
            >
              <Typography variant="h6" fontWeight={700} color="var(--text)" sx={{ mb: 1 }}>
                لا توجد مركبات في انتظار الوزنة الثانية حالياً
              </Typography>
              <Typography variant="body2" color="var(--text-muted)" sx={{ mb: 3 }}>
                يمكنك تسجيل وزنة أولى جديدة لمركبة واردة
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => setStageSelection('first')}
                sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 700 }}
              >
                + بدء وزنة أولى جديدة
              </Button>
            </Paper>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
                gap: 2.5,
              }}
            >
              {filteredPendingDrafts.map((draft) => {
                const firstWeightValue =
                  draft.start_type === 'empty'
                    ? (draft.weight_empty || draft.net_weight_empty || 0)
                    : (draft.weight_loaded || draft.net_weight_loaded || 0);

                return (
                  <Paper
                    key={draft.id}
                    variant="outlined"
                    sx={{
                      p: 2.5,
                      borderRadius: 'var(--radius-lg, 12px)',
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 2,
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        borderColor: 'var(--primary)',
                        boxShadow: 'var(--shadow-sm)',
                      },
                    }}
                  >
                    <div>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                        <div>
                          <Typography variant="h6" fontWeight={800} color="var(--text)">
                            {draft.effective_vehicle_number || draft.vehicle?.vehicle_number || '---'}
                          </Typography>
                          <Typography variant="caption" color="var(--text-muted)">
                            مسودة رقم: #{draft.draft_number}
                          </Typography>
                        </div>
                        <Chip
                          size="small"
                          label="في انتظار الوزنة الثانية"
                          sx={{
                            fontWeight: 700,
                            fontSize: '0.725rem',
                            bgcolor: 'var(--bg-warning-soft)',
                            color: 'var(--warning)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm, 6px)',
                          }}
                        />
                      </Box>
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                          py: 1.5,
                          borderTop: '1px solid var(--border)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="var(--text-muted)">السائق:</Typography>
                          <Typography variant="body2" fontWeight={600} color="var(--text)">
                            {draft.effective_driver_name || draft.direct_driver_name || draft.driver_name || draft.vehicle?.driver_name || '---'}
                          </Typography>
                        </Box>
                        {draft.vendor_name && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="var(--text-muted)">المورد:</Typography>
                            <Typography variant="body2" fontWeight={600} color="var(--text)">
                              {draft.vendor_name}
                            </Typography>
                          </Box>
                        )}
                        {draft.item_name && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="var(--text-muted)">الصنف:</Typography>
                            <Typography variant="body2" fontWeight={600} color="var(--text)">
                              {draft.item_name}
                            </Typography>
                          </Box>
                        )}
                        {draft.shipping_manifest && <Box sx={{ display: 'grid', gap: 1 }}>
                          <Typography variant="body2" fontWeight={700}>{draft.shipping_manifest.container_number}</Typography>
                          <Typography variant="caption">{draft.shipping_manifest.status === 'READY' ? 'جاهزة للوزنة الثانية — بيان الشحن مكتمل' : 'بانتظار إرسال بيان التحميل من الشحن'}</Typography>
                          <Typography variant="caption">{draft.shipping_manifest.pallet_count} بالتة · {draft.shipping_manifest.box_count} صندوق</Typography>
                        </Box>}
                        {draft.quotation && (
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="var(--text-muted)">عرض السعر:</Typography>
                            <Typography variant="body2" fontWeight={700} color="var(--primary)">
                              #{draft.quotation_number || draft.quotation}
                            </Typography>
                          </Box>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="var(--text-muted)">نوع الحركة:</Typography>
                          <Typography variant="body2" fontWeight={600} color="var(--text)">
                            {draft.start_type === 'loaded' ? 'وارد محمل — القائم أولاً' : 'وارد فارغ — الفارغ أولاً'}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
                          <Typography variant="caption" color="var(--text-muted)">الوزنة الأولى:</Typography>
                          <Typography variant="body1" fontWeight={800} color="var(--primary)">
                            {Number(firstWeightValue).toLocaleString()} KG
                          </Typography>
                        </Box>
                      </Box>
                    </div>
                    <Button
                      variant="contained"
                      color="primary"
                      fullWidth
                      onClick={() => loadDraft(draft.id)}
                      sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 700, py: 1 }}
                    >
                      استكمال ←
                    </Button>
                  </Paper>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      {(Boolean(currentDraft) || stageSelection === 'first' || Boolean(completedFirstWeightDraft)) && (
        <Box>
          <PageHeader
            eyebrow={t('scale.title')}
            title={t('scale.weighingTitle')}
            description={t('scale.weighingSubtitle')}
            actions={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(!currentDraft || completedFirstWeightDraft) && stageSelection === 'first' && (
                  <>
                    <Button variant="outlined" size="small" onClick={handleReturnToPendingList}>
                      الوزنة الثانية
                    </Button>
                    <Button variant="contained" color="primary" size="small" onClick={handleStartNewDraft}>
                      وزنة أولى جديدة
                    </Button>
                  </>
                )}
                {currentDraft?.status === 'SECOND_WEIGHT_PENDING' && stageSelection === 'second' && (
                  <Button variant="outlined" size="small" onClick={handleReturnToPendingList}>
                    ← اختيار مركبة أخرى
                  </Button>
                )}
                {currentDraft && !completedFirstWeightDraft && (
                  <Button variant="outlined" size="small" onClick={handleStartNewDraft}>
                    + {t('scale.recordFirstWeight')} (New)
                  </Button>
                )}
              </Box>
            }
          />
          <div className="scale-weighing-grid">
            <Box sx={{ minWidth: 0 }}>
              {/* 1. First Weighing Form (in progress) */}
              {stageSelection === 'first' && !completedFirstWeightDraft && (
                <WeighingStageForm
                  stage="first"
                  liveWeight={weight}
                  canRecord={canRecordWeight}
                  isSubmitting={isSubmitting}
                  onSubmit={handleFirstWeightSubmit}
                  onOpenNewVehicleModal={() => setIsVehicleModalOpen(true)}
                  lastCreatedVehicle={createdVehicle}
                  matchedQuotation={matchedQuotation}
                  onMatchQuotation={(quotation, lineIndex) => {
                    setMatchedQuotation({
                      ...quotation,
                      line_index: lineIndex,
                    });
                  }}
                  onUnmatchQuotation={() => setMatchedQuotation(null)}
                  startType={startType}
                  onStartTypeChange={(newType) => {
                    setStartType(newType);
                    if (newType !== 'loaded') {
                      setMatchedQuotation(null);
                    }
                  }}
                />
              )}

              {/* 2. First Weighing Completed Success Card */}
              {stageSelection === 'first' && completedFirstWeightDraft && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 3, md: 4 },
                    borderRadius: 'var(--radius-lg, 12px)',
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  {/* Success Header Banner */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, pb: 2, borderBottom: '1px solid var(--border)' }}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        backgroundColor: 'var(--bg-success-soft)',
                        color: 'var(--success)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.75rem',
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </Box>
                    <Box>
                      <Typography variant="h6" fontWeight={800} color="var(--success)">
                        تم تسجيل الوزن الأول بنجاح
                      </Typography>
                      <Typography variant="body2" color="var(--text-muted)">
                        تم حفظ تذكرة الميزان بنجاح وتوجيه المركبة لمنطقة التفريغ / التحميل. يمكنك استكمال الوزنة الثانية لاحقاً عند عودة المركبة.
                      </Typography>
                    </Box>
                  </Box>

                  {/* Summary Ticket Details Grid */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                      gap: 2.5,
                      p: 2.5,
                      borderRadius: 'var(--radius-md, 8px)',
                      backgroundColor: 'var(--bg-soft)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <Typography variant="caption" color="var(--text-muted)">رقم التذكرة / المسودة:</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body1" fontWeight={800} color="var(--primary)">
                          #{completedFirstWeightDraft.draft_number}
                        </Typography>
                        {completedFirstWeightDraft.quotation && (
                          <Chip
                            label={`مرتبط بعرض سعر #${completedFirstWeightDraft.quotation_number || completedFirstWeightDraft.quotation}`}
                            size="small"
                            color="info"
                            variant="outlined"
                            sx={{ fontWeight: 700, height: 22, fontSize: '0.75rem' }}
                          />
                        )}
                      </Box>
                    </div>
                    <div>
                      <Typography variant="caption" color="var(--text-muted)">المركبة / الشاحنة:</Typography>
                      <Typography variant="body1" fontWeight={700} color="var(--text)">
                        {completedFirstWeightDraft.effective_vehicle_number || completedFirstWeightDraft.vehicle?.vehicle_number || '---'}
                      </Typography>
                    </div>
                    <div>
                      <Typography variant="caption" color="var(--text-muted)">السائق المشغل للعملية:</Typography>
                      <Typography variant="body1" fontWeight={700} color="var(--text)">
                        {completedFirstWeightDraft.effective_driver_name || completedFirstWeightDraft.direct_driver_name || completedFirstWeightDraft.driver_name || '---'}
                      </Typography>
                    </div>
                    <div>
                      <Typography variant="caption" color="var(--text-muted)">نوع حركة الدخول:</Typography>
                      <Typography variant="body2" fontWeight={700} color="var(--text)">
                        {completedFirstWeightDraft.start_type === 'loaded' ? 'وارد محمل — القائم أولاً' : 'وارد فارغ — الفارغ أولاً'}
                      </Typography>
                    </div>
                    {completedFirstWeightDraft.vendor_name && (
                      <div>
                        <Typography variant="caption" color="var(--text-muted)">المورد / المزرعة:</Typography>
                        <Typography variant="body2" fontWeight={700} color="var(--text)">
                          {completedFirstWeightDraft.vendor_name}
                        </Typography>
                      </div>
                    )}
                    {completedFirstWeightDraft.item_name && (
                      <div>
                        <Typography variant="caption" color="var(--text-muted)">الصنف / المحصول:</Typography>
                        <Typography variant="body2" fontWeight={700} color="var(--text)">
                          {completedFirstWeightDraft.item_name}
                        </Typography>
                      </div>
                    )}
                    <div>
                      <Typography variant="caption" color="var(--text-muted)">
                        {completedFirstWeightDraft.start_type === 'empty' ? 'الوزنة الأولى (وزن فارغ مرجعي):' : 'الوزنة الأولى (وزن القائم):'}
                      </Typography>
                      <Typography variant="h6" fontWeight={800} color="var(--primary)">
                        {Number(
                          completedFirstWeightDraft.start_type === 'empty'
                            ? (completedFirstWeightDraft.weight_empty || completedFirstWeightDraft.net_weight_empty || 0)
                            : (completedFirstWeightDraft.weight_loaded || completedFirstWeightDraft.net_weight_loaded || 0)
                        ).toLocaleString()} KG
                      </Typography>
                    </div>
                    {Number(completedFirstWeightDraft.tare_deduction_total || 0) > 0 && (
                      <div>
                        <Typography variant="caption" color="var(--text-muted)">إجمالي خصومات العناصر:</Typography>
                        <Typography variant="body1" fontWeight={700} color="var(--warning)">
                          - {Number(completedFirstWeightDraft.tare_deduction_total).toFixed(2)} KG
                        </Typography>
                      </div>
                    )}
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', pt: 1 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      size="large"
                      onClick={handleReturnToStageSelection}
                      sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 700, px: 3.5, py: 1.25 }}
                    >
                      العودة لمحطة التوزين ←
                    </Button>
                    <Button
                      variant="outlined"
                      size="large"
                      onClick={handleStartNewDraft}
                      sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 600, px: 3, py: 1.25 }}
                    >
                      + تسجيل وزنة أولى جديدة
                    </Button>
                    <PrintActionButton icon="🖨️"
                      onClick={() => window.print()}
                    />
                  </Box>
                </Paper>
              )}

              {/* 3. Second Weighing Form (only when manually chosen for a pending draft) */}
              {stageSelection === 'second' && currentDraft && !currentDraft.shipping_manifest && currentDraft.status === 'SECOND_WEIGHT_PENDING' && (
                <WeighingStageForm
                  stage="second"
                  existingDraft={currentDraft}
                  liveWeight={weight}
                  canRecord={canRecordWeight}
                  isSubmitting={isSubmitting}
                  onSubmit={handleSecondWeightSubmit}
                />
              )}

              {/* 4. Final Completed Weighing Summary */}
              {currentDraft?.shipping_manifest && !completedFirstWeightDraft && (
                <ShippingSecondWeight draft={currentDraft} weight={weight} canRecord={canRecordWeight}
                  busy={isSubmitting} onSubmit={handleSecondWeightSubmit} onRefresh={() => loadDraft(currentDraft.id)}
                  completed={currentDraft.is_closed} />
              )}
              {currentDraft && !currentDraft.shipping_manifest && currentDraft.status !== 'SECOND_WEIGHT_PENDING' && (
                <>
                  <ScaleDraftSummaryCard
                    draft={currentDraft}
                    onCancelDraft={() => setIsCancelConfirmOpen(true)}
                    onPrintTicket={() => window.print()}
                    isSubmitting={isSubmitting}
                  />
                </>
              )}
            </Box>
            <div className="scale-side-panel">
              <div className="scale-device-selector-card">
                <SearchableSelect
                  label={t('scale.device')}
                  fullWidth
                  value={selectedDeviceId}
                  onChange={(val) => setSelectedDeviceId(val)}
                  options={[
                    { value: 'scale_virtual_001', label: '🧪 Virtual Scale Simulator (Lab)' },
                    ...devices.map((d) => ({
                      value: d.device_id,
                      label: `${d.device_name} (${d.device_type})`,
                    })),
                  ]}
                />
              </div>
              <LiveWeightDisplay
                weight={weight}
                weightFormatted={weightFormatted}
                isStable={isStable}
                isOnline={isOnline}
                deviceName={deviceName}
                dataAgeSeconds={dataAgeSeconds}
                error={liveError}
                isLoading={isLiveLoading}
                onRefresh={refreshLiveWeight}
              />
              <div className="scale-simulator-wrapper">
                <VirtualScaleControlPanel
                  deviceId={selectedDeviceId}
                  onUpdated={refreshLiveWeight}
                />
              </div>
            </div>
          </div>
        </Box>
      )}

      <VehicleEntryModal
        open={isVehicleModalOpen}
        onClose={() => setIsVehicleModalOpen(false)}
        onVehicleCreated={(newVeh) => {
          setCreatedVehicle(newVeh);
        }}
      />
      <ConfirmDialog
        open={isCancelConfirmOpen}
        title={t('scale.cancelDraft')}
        message={t('scale.confirmCancelDraft')}
        onConfirm={handleCancelDraft}
        onCancel={() => setIsCancelConfirmOpen(false)}
      />

      <ScalePrintableTicket draft={completedFirstWeightDraft || currentDraft} />
    </div>
  );
}

export default ScaleWeighingPage;
