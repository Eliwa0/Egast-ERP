import React, { useState } from 'react';
import {
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Switch,
  FormControlLabel,
  ButtonGroup,
} from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import scaleApi from '../services/scaleApi';
import { useToast } from '../../../components/ui/ToastProvider';

export function VirtualScaleControlPanel({ deviceId = 'scale_virtual_001', onUpdated }) {
  const { t } = useI18n();
  const toast = useToast();

  const [simWeight, setSimWeight] = useState('18450.00');
  const [isStable, setIsStable] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const applySimulation = async (weightVal, stableVal, onlineVal) => {
    setIsSending(true);
    try {
      const w = weightVal !== undefined ? weightVal : simWeight;
      const s = stableVal !== undefined ? stableVal : isStable;
      const o = onlineVal !== undefined ? onlineVal : isOnline;

      const res = await scaleApi.setSimulatorWeight({
        device_id: deviceId,
        weight: parseFloat(w) || 0,
        is_stable: s,
        is_online: o,
      });

      if (res.success) {
        toast.info(`Simulator updated: ${w} KG (${s ? 'Stable' : 'Unstable'}, ${o ? 'Online' : 'Offline'})`);
        if (onUpdated) onUpdated();
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleQuickPreset = (presetWeight) => {
    setSimWeight(String(presetWeight));
    applySimulation(String(presetWeight), isStable, isOnline);
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mt: 2,
        borderRadius: 'var(--radius-lg)',
        border: '1px dashed var(--color-primary)',
        backgroundColor: 'var(--color-surface-muted)',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <div>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'var(--color-primary)' }}>
            🧪 {t('scale.simulatorTitle')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('scale.simulatorNote')} · Device: <strong>{deviceId}</strong>
          </Typography>
        </div>
      </Box>

      {/* Preset Buttons */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <ButtonGroup size="small" variant="outlined">
          <Button onClick={() => handleQuickPreset('25400.00')}>25.4 Ton (Loaded)</Button>
          <Button onClick={() => handleQuickPreset('18450.00')}>18.45 Ton</Button>
          <Button onClick={() => handleQuickPreset('9200.00')}>9.2 Ton (Tare)</Button>
          <Button onClick={() => handleQuickPreset('0.00')}>0.00 KG (Zero)</Button>
        </ButtonGroup>
      </Box>

      {/* Inputs & Controls */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr auto auto auto' }, gap: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          label={t('scale.setWeight')}
          value={simWeight}
          onChange={(e) => setSimWeight(e.target.value)}
          placeholder="e.g. 18450.00"
        />

        <FormControlLabel
          control={
            <Switch
              checked={isStable}
              onChange={(e) => {
                setIsStable(e.target.checked);
                applySimulation(simWeight, e.target.checked, isOnline);
              }}
              color="primary"
            />
          }
          label={isStable ? t('scale.stable') : t('scale.unstable')}
        />

        <FormControlLabel
          control={
            <Switch
              checked={isOnline}
              onChange={(e) => {
                setIsOnline(e.target.checked);
                applySimulation(simWeight, isStable, e.target.checked);
              }}
              color="success"
            />
          }
          label={isOnline ? t('scale.online') : t('scale.offline')}
        />

        <Button
          variant="contained"
          size="medium"
          onClick={() => applySimulation()}
          disabled={isSending}
        >
          {isSending ? '...' : t('scale.updateSimulator')}
        </Button>
      </Box>
    </Paper>
  );
}

export default VirtualScaleControlPanel;
