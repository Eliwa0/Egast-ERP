import StandardDropdown from '../../../components/ui/StandardDropdown';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Radio,
  RadioGroup,
  Tooltip,
  IconButton,
  CircularProgress,
  Card,
  CardContent,
} from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import LoadingSkeleton from '../../../components/ui/LoadingSkeleton';
import EmptyState from '../../../components/ui/EmptyState';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { LiveWeightDisplay } from '../components/LiveWeightDisplay';
import { useLiveScaleWeight } from '../hooks/useLiveScaleWeight';
import scaleApi, { localAgentApi } from '../services/scaleApi';
import { selectMonitorDevice } from '../services/monitorSelection';
import { useToast } from '../../../components/ui/ToastProvider';

const BAUD_RATES = [2400, 4800, 9600, 19200, 38400, 57600, 115200];

export function ScaleDevicesPage() {
  const { t } = useI18n();
  const toast = useToast();

  // ── Database Devices State ──────────────────────────────────────────────────
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Local Scale Agent State ────────────────────────────────────────────────
  const [agentStatus, setAgentStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected'
  const [agentData, setAgentData] = useState(null);
  const [isCheckingAgent, setIsCheckingAgent] = useState(false);
  const [isReloadingConfig, setIsReloadingConfig] = useState(false);
  const [deployingScaleId, setDeployingScaleId] = useState(null); // ID of scale currently downloading deployment

  // ── Modal & Form State ──────────────────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const [formDeviceId, setFormDeviceId] = useState('');
  const [formDeviceName, setFormDeviceName] = useState('');
  const [formDeviceType, setFormDeviceType] = useState('local');
  const [formConfigMode, setFormConfigMode] = useState('auto'); // 'auto' | 'manual'
  const [formComPort, setFormComPort] = useState('');
  const [formIsCustomComPort, setFormIsCustomComPort] = useState(false);
  const [formBaudRate, setFormBaudRate] = useState('');
  const [formIpAddress, setFormIpAddress] = useState('');
  const [formPort, setFormPort] = useState(8000);
  const [formLocation, setFormLocation] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  // ── Confirmation Dialog State ──────────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: '',
    variant: 'primary',
    loading: false,
    action: null,
  });

  // ── Live Monitor State ─────────────────────────────────────────────────────
  const [selectedMonitorScaleId, setSelectedMonitorScaleId] = useState(null);
  const [showMonitor, setShowMonitor] = useState(false);

  // Live weight hook for the selected scale
  const {
    weight,
    weightFormatted,
    isStable,
    isOnline,
    deviceName: liveDeviceName,
    dataAgeSeconds,
    error: liveError,
    isLoading: isLiveLoading,
  } = useLiveScaleWeight(selectedMonitorScaleId, 1000);

  // ── Fetch Devices from Django Backend ──────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    try {
      const res = await scaleApi.getDevices();
      if (res.success && res.data && res.data.devices) {
        setDevices(res.data.devices);
        setSelectedMonitorScaleId((currentId) => selectMonitorDevice(res.data.devices, currentId));
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Failed to fetch scale devices');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // ── Check Local Scale Agent (http://127.0.0.1:8998) ─────────────────────────
  const checkLocalAgent = useCallback(async () => {
    setIsCheckingAgent(true);
    try {
      const statusData = await localAgentApi.getStatus(3000);
      if (statusData && statusData.status === 'ok') {
        setAgentStatus('connected');
        setAgentData(statusData);
      } else {
        setAgentStatus('disconnected');
        setAgentData(null);
      }
    } catch {
      setAgentStatus('disconnected');
      setAgentData(null);
    } finally {
      setIsCheckingAgent(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    checkLocalAgent();
  }, [fetchDevices, checkLocalAgent]);

  // ── Reload Local Agent Config ──────────────────────────────────────────────
  const handleReloadAgentConfig = async () => {
    setIsReloadingConfig(true);
    try {
      const res = await localAgentApi.reloadConfig(4000);
      toast.success(
        res.status === 'reloaded'
          ? `${t('scale.reloadConfig')}: ${res.scales_count} ${t('scale.agentScalesCount')}`
          : t('common.success')
      );
      await checkLocalAgent();
    } catch (err) {
      toast.error(err.message || 'Failed to reload agent config');
    } finally {
      setIsReloadingConfig(false);
    }
  };

  // ── Agent Deployment Package Download ──────────────────────────────────────
  const handleDeployAgent = async (scaleId = null) => {
    setDeployingScaleId(scaleId || '__all__');
    try {
      const res = await scaleApi.deployScaleAgent(scaleId);

      // Determine download filename from Content-Disposition or fallback
      let filename = scaleId
        ? `ScaleAgent_${scaleId}_Deployment.zip`
        : 'ScaleAgent_Deployment.zip';

      const disposition = res.headers ? res.headers['content-disposition'] : null;
      if (disposition && disposition.includes('filename=')) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      // Trigger browser download via Blob URL
      const blob = new Blob([res.data], { type: 'application/zip' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast.success(t('scale.deploySuccess') || 'Deployment package downloaded successfully');
    } catch (err) {
      let errorMsg = t('scale.deployError') || 'Failed to download deployment package';
      if (err?.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          if (json.error) errorMsg = json.error;
        } catch {
          // ignore parsing error
        }
      } else if (err?.response?.data?.error) {
        errorMsg = err.response.data.error;
      } else if (err.message) {
        errorMsg = err.message;
      }
      toast.error(errorMsg);
    } finally {
      setDeployingScaleId(null);
    }
  };

  // ── Open Add Modal ─────────────────────────────────────────────────────────
  const handleOpenCreate = () => {
    setEditingDevice(null);
    const nextIdx = devices.length + 1;
    const initialId = `SCALE_${String(nextIdx).padStart(2, '0')}`;
    setFormDeviceId(initialId);
    setFormDeviceName(`Weighbridge Scale ${nextIdx}`);
    setFormDeviceType('local');

    // Default to Auto-detect mode: agent discovers COM port + baud rate.
    setFormConfigMode('auto');
    setFormComPort('');
    setFormIsCustomComPort(false);
    setFormBaudRate('');
    setFormIpAddress('');
    setFormPort(8000);
    setFormLocation('Gate 1');
    setFormIsActive(true);
    setIsModalOpen(true);
  };

  // ── Open Edit Modal ─────────────────────────────────────────────────────────
  const handleOpenEdit = (dev) => {
    setEditingDevice(dev);
    setFormDeviceId(dev.device_id);
    setFormDeviceName(dev.device_name);
    setFormDeviceType(dev.device_type);

    const detectedPorts = agentData?.available_ports || [];
    const isDetected = detectedPorts.some((p) => p.port === dev.com_port);
    const hasManualPort = Boolean(dev.com_port);
    setFormConfigMode(hasManualPort ? 'manual' : 'auto');
    setFormComPort(dev.com_port || '');
    setFormIsCustomComPort(!isDetected && hasManualPort);
    setFormBaudRate(dev.baud_rate || '');
    setFormIpAddress(dev.ip_address || '');
    setFormPort(dev.port || 8000);
    setFormLocation(dev.location || '');
    setFormIsActive(dev.is_active !== undefined ? dev.is_active : true);
    setIsModalOpen(true);
  };

  // ── Save Device (Create / Update) ──────────────────────────────────────────
  const handleSaveDevice = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        device_name: formDeviceName.trim(),
        device_type: formDeviceType,
        location: formLocation.trim(),
        is_active: formIsActive,
      };

      if (!editingDevice) {
        payload.device_id = formDeviceId.trim();
      }

      if (formDeviceType === 'local') {
        const comPort = formComPort.trim();
        if (formConfigMode === 'manual' && comPort) {
          payload.com_port = comPort;
          payload.baud_rate = formBaudRate ? Number(formBaudRate) : null;
        } else {
          // AUTO mode: omit com_port/baud_rate so backend stores null (Agent discovers them).
          payload.com_port = '';
          payload.baud_rate = null;
        }
      } else if (formDeviceType === 'remote') {
        payload.ip_address = formIpAddress.trim() || null;
        payload.port = formPort ? parseInt(formPort, 10) : 8000;
      }

      if (editingDevice) {
        await scaleApi.updateDevice(editingDevice.id, payload);
        toast.success(t('scale.deviceUpdatedSuccess') || 'Device updated successfully');
      } else {
        const created = await scaleApi.createDevice(payload);
        setSelectedMonitorScaleId(created.data.device_id);
        toast.success(t('scale.deviceCreatedSuccess') || 'Device created successfully');
      }

      setIsModalOpen(false);
      await fetchDevices();
    } catch (err) {
      const errors = err?.response?.data?.errors;
      if (errors && typeof errors === 'object') {
        const firstKey = Object.keys(errors)[0];
        const msg = Array.isArray(errors[firstKey]) ? errors[firstKey][0] : errors[firstKey];
        toast.error(`${firstKey}: ${msg}`);
      } else {
        toast.error(err?.response?.data?.error || err.message || 'Error saving device');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ── Toggle Active / Inactive ───────────────────────────────────────────────
  const handleToggleActive = (dev) => {
    const nextState = !dev.is_active;

    if (!nextState) {
      // Deactivating requires confirmation
      setConfirmDialog({
        open: true,
        title: t('scale.deactivateDevice') || 'Deactivate Scale Device',
        message:
          t('scale.confirmDeactivateDevice') ||
          `Are you sure you want to deactivate ${dev.device_name} (${dev.device_id})?`,
        confirmLabel: t('scale.deactivateDevice') || 'Deactivate',
        variant: 'danger',
        loading: false,
        action: async () => {
          setConfirmDialog((prev) => ({ ...prev, loading: true }));
          try {
            await scaleApi.updateDevice(dev.id, { is_active: false });
            toast.success(t('scale.deviceStatusChanged') || 'Device status updated');
            await fetchDevices();
            setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
          } catch (err) {
            toast.error(err?.response?.data?.error || err.message);
            setConfirmDialog((prev) => ({ ...prev, loading: false }));
          }
        },
      });
    } else {
      // Activating directly
      scaleApi
        .updateDevice(dev.id, { is_active: true })
        .then(() => {
          toast.success(t('scale.deviceStatusChanged') || 'Device status updated');
          fetchDevices();
        })
        .catch((err) => {
          toast.error(err?.response?.data?.error || err.message);
        });
    }
  };

  // ── Delete Device ──────────────────────────────────────────────────────────
  const handleDeleteDevice = (dev) => {
    setConfirmDialog({
      open: true,
      title: t('common.delete') + ' ' + t('scale.device'),
      message:
        t('scale.confirmDeleteDevice') ||
        `Are you sure you want to permanently delete ${dev.device_name} (${dev.device_id})?`,
      confirmLabel: t('common.delete'),
      variant: 'danger',
      loading: false,
      action: async () => {
        setConfirmDialog((prev) => ({ ...prev, loading: true }));
        try {
          await scaleApi.deleteDevice(dev.id);
          toast.success(t('scale.deviceDeletedSuccess') || 'Device deleted successfully');
          await fetchDevices();
          setConfirmDialog((prev) => ({ ...prev, open: false, loading: false }));
        } catch (err) {
          toast.error(err?.response?.data?.error || err.message);
          setConfirmDialog((prev) => ({ ...prev, loading: false }));
        }
      },
    });
  };

  // ── Filtered Devices List ──────────────────────────────────────────────────
  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) return devices;
    const q = searchQuery.toLowerCase().trim();
    return devices.filter(
      (d) =>
        d.device_id.toLowerCase().includes(q) ||
        d.device_name.toLowerCase().includes(q) ||
        (d.location && d.location.toLowerCase().includes(q)) ||
        (d.com_port && d.com_port.toLowerCase().includes(q))
    );
  }, [devices, searchQuery]);

  const detectedPortsList = agentData?.available_ports || [];

  return (
    <div className="page-shell scale-devices-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.devicesTitle')}
        description={t('scale.devicesSubtitle')}
        actions={
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              color="primary"
              disabled={deployingScaleId === '__all__'}
              onClick={() => handleDeployAgent(null)}
              startIcon={
                deployingScaleId === '__all__' ? <CircularProgress size={16} /> : <span>📦</span>
              }
            >
              {deployingScaleId === '__all__'
                ? t('scale.deploying') || 'Deploying...'
                : t('scale.deployAllScales') || 'Deploy All Scales'}
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleOpenCreate}
              startIcon={<span>+</span>}
            >
              {t('common.save')} {t('scale.device')}
            </Button>
          </Box>
        }
      />

      {/* ── Local Scale Agent Status Banner ─────────────────────────────────── */}
      <Card
        variant="outlined"
        sx={{
          mb: 3,
          borderRadius: 'var(--radius-lg)',
          borderColor:
            agentStatus === 'connected'
              ? 'var(--color-success, #2e7d32)'
              : agentStatus === 'checking'
              ? 'var(--color-primary)'
              : 'var(--color-warning, #ed6c02)',
          backgroundColor:
            agentStatus === 'connected'
              ? 'rgba(46, 125, 50, 0.04)'
              : 'rgba(237, 108, 2, 0.04)',
        }}
      >
        <CardContent sx={{ p: '16px 20px !important' }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor:
                    agentStatus === 'connected'
                      ? '#2e7d32'
                      : agentStatus === 'checking'
                      ? '#1976d2'
                      : '#d32f2f',
                  boxShadow:
                    agentStatus === 'connected'
                      ? '0 0 0 4px rgba(46, 125, 50, 0.2)'
                      : '0 0 0 4px rgba(211, 47, 47, 0.2)',
                  flexShrink: 0,
                }}
              />
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {agentStatus === 'connected'
                      ? t('scale.agentConnected') || 'Local Scale Agent Connected'
                      : agentStatus === 'checking'
                      ? t('scale.agentChecking') || 'Checking Local Agent...'
                      : t('scale.agentNotDetected') || 'Local Scale Agent Not Detected'}
                  </Typography>
                  {agentData?.agent_version && (
                    <Chip
                      size="small"
                      label={`v${agentData.agent_version}`}
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.75rem' }}
                    />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {agentStatus === 'connected'
                    ? `${t('scale.agentUptime')}: ${agentData.uptime_seconds || 0}s · ${
                        agentData.scales_count || 0
                      } ${t('scale.agentScalesCount')} · ERP Sync: ${
                        Number(agentData.django_push_stats?.push_count) > 0 && !agentData.django_push_stats?.last_error
                          ? '🟢 OK'
                          : agentData.django_push_stats?.last_error || '🟡 Disconnected'
                      }`
                    : t('scale.agentNoticeOffline')}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', minWidth: 0, gap: 1, alignItems: 'center' }}>
              {agentStatus === 'connected' && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleReloadAgentConfig}
                  disabled={isReloadingConfig}
                  startIcon={
                    isReloadingConfig ? <CircularProgress size={14} /> : <span>🔄</span>
                  }
                >
                  {t('scale.reloadConfig')}
                </Button>
              )}
              <Button
                size="small"
                variant={agentStatus === 'connected' ? 'text' : 'contained'}
                color="primary"
                onClick={checkLocalAgent}
                disabled={isCheckingAgent}
                startIcon={
                  isCheckingAgent ? <CircularProgress size={14} /> : <span>⚡</span>
                }
              >
                {t('scale.testConnection')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                onClick={() => setShowMonitor(!showMonitor)}
              >
                {showMonitor ? 'Hide Monitor ✕' : 'Live Monitor 👁️'}
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* ── Live Indicator Monitor Card (Collapsible) ────────────────────────── */}
      {showMonitor && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              ⚖️ {t('scale.liveWeightMonitor') || 'Live Indicator Monitor'}:
            </Typography>
            <SearchableSelect
              label={t('scale.liveWeightMonitor') || 'Live Indicator Monitor'}
              size="small"
              value={selectedMonitorScaleId || ''}
              onChange={(e) => setSelectedMonitorScaleId(e.target.value)}
              allowClear={false}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.device_id}>
                  {d.device_name} ({d.device_id}) {d.is_active ? '' : '⚠️ Inactive'}
                </option>
              ))}
            </SearchableSelect>
          </Box>

          <LiveWeightDisplay
            weight={weight}
            weightFormatted={weightFormatted}
            isStable={isStable}
            isOnline={isOnline}
            deviceName={liveDeviceName}
            dataAgeSeconds={dataAgeSeconds}
            error={liveError}
            isLoading={isLiveLoading}
          />
        </Box>
      )}

      {/* ── Devices Search & Summary Bar ────────────────────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <TextField
          size="small"
          placeholder={`${t('common.search')} (${t('scale.device')}, ID, Port)...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ width: { xs: '100%', sm: 300 } }}
        />

        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Chip
            size="small"
            label={`${t('common.total')}: ${devices.length}`}
            variant="outlined"
          />
          <Chip
            size="small"
            color="success"
            label={`${t('scale.online')}: ${devices.filter((d) => d.is_online).length}`}
          />
          <Chip
            size="small"
            color="default"
            label={`${t('scale.inactive')}: ${devices.filter((d) => !d.is_active).length}`}
          />
        </Box>
      </Box>

      {/* ── Scale Devices Table ─────────────────────────────────────────────── */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : filteredDevices.length === 0 ? (
        <EmptyState title={t('scale.noDevicesFound')} />
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ borderRadius: 'var(--radius-lg)' }}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('scale.device')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('scale.connectionType') || 'Type'}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Port / Network Details</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Location</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>
                  {t('common.status')}
                </TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>
                  {t('scale.active')}
                </TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>
                  Last Seen
                </TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>
                  {t('scale.actions') || 'Actions'}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDevices.map((dev) => {
                const isDeployingThis = deployingScaleId === dev.device_id;
                const canDeploy = dev.device_type === 'local' && dev.is_active;

                return (
                  <TableRow
                    key={dev.id}
                    hover
                    sx={{
                      opacity: dev.is_active ? 1 : 0.65,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {/* ID */}
                    <TableCell
                      sx={{
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {dev.device_id}
                    </TableCell>

                    {/* Name */}
                    <TableCell sx={{ fontWeight: 600 }}>{dev.device_name}</TableCell>

                    {/* Connection Type */}
                    <TableCell>
                      <Chip
                        size="small"
                        label={
                          dev.device_type === 'local'
                            ? 'Local Serial COM'
                            : dev.device_type === 'remote'
                            ? 'Network IP'
                            : 'Virtual Simulator'
                        }
                        variant="outlined"
                        color={
                          dev.device_type === 'local'
                            ? 'primary'
                            : dev.device_type === 'remote'
                            ? 'info'
                            : 'secondary'
                        }
                      />
                    </TableCell>

                    {/* Connection Details */}
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      {dev.device_type === 'local'
                        ? dev.com_port
                          ? `${dev.com_port} @ ${dev.baud_rate || 'AUTO'} baud`
                          : t('scale.autoDetectMode') || 'Auto-detect'
                        : dev.device_type === 'remote'
                        ? `${dev.ip_address || '---'}:${dev.port || '8000'}`
                        : 'Software Lab Virtual'}
                    </TableCell>

                    {/* Location */}
                    <TableCell>{dev.location || '---'}</TableCell>

                    {/* Hardware Status */}
                    <TableCell align="center">
                      {!dev.is_active ? (
                        <Chip
                          size="small"
                          label={t('scale.inactive')}
                          color="default"
                          variant="outlined"
                        />
                      ) : dev.is_online ? (
                        <Chip
                          size="small"
                          label={t('scale.online')}
                          color="success"
                          sx={{ fontWeight: 700 }}
                        />
                      ) : (
                        <Chip
                          size="small"
                          label={t('scale.offline')}
                          color="default"
                          variant="outlined"
                        />
                      )}
                    </TableCell>

                    {/* Active Toggle */}
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={Boolean(dev.is_active)}
                        onChange={() => handleToggleActive(dev)}
                        color="primary"
                        inputProps={{ 'aria-label': 'toggle active' }}
                      />
                    </TableCell>

                    {/* Last Seen */}
                    <TableCell align="center" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                      {dev.last_seen ? new Date(dev.last_seen).toLocaleTimeString() : 'Never'}
                    </TableCell>

                    {/* Actions */}
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        {/* Deploy Agent Button */}
                        <Tooltip
                          title={
                            !dev.is_active
                              ? 'Activate scale to enable deployment'
                              : dev.device_type !== 'local'
                              ? 'Deploy package is only for local COM serial scales'
                              : `${t('scale.deployAgent')} (${dev.device_id})`
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              variant="outlined"
                              color="primary"
                              disabled={!canDeploy || isDeployingThis}
                              onClick={() => handleDeployAgent(dev.device_id)}
                              sx={{ minWidth: 32, px: 1, py: 0.5, fontSize: '0.75rem' }}
                            >
                              {isDeployingThis ? (
                                <CircularProgress size={14} />
                              ) : (
                                `📥 ${t('scale.deployAgent')}`
                              )}
                            </Button>
                          </span>
                        </Tooltip>

                        {/* Edit Button */}
                        <Tooltip title={t('common.edit')}>
                          <IconButton
                            size="small"
                            onClick={() => handleOpenEdit(dev)}
                            color="primary"
                          >
                            ✏️
                          </IconButton>
                        </Tooltip>

                        {/* Delete Button */}
                        <Tooltip title={t('common.delete')}>
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteDevice(dev)}
                            color="error"
                          >
                            🗑️
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Add / Edit Device Dialog ────────────────────────────────────────── */}
      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSaveDevice}>
          <DialogTitle sx={{ fontWeight: 700 }}>
            {editingDevice ? t('common.edit') : t('common.save')} {t('scale.device')}
          </DialogTitle>
          <DialogContent dividers>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
              {/* Device ID */}
              <TextField
                label="Device ID"
                required
                fullWidth
                value={formDeviceId}
                onChange={(e) => setFormDeviceId(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                disabled={Boolean(editingDevice)}
                helperText={
                  editingDevice
                    ? 'Unique identifier cannot be modified once created'
                    : 'Unique code (e.g. SCALE_01, WEIGHBRIDGE_IN)'
                }
              />

              {/* Device Name */}
              <TextField
                label="Device Name"
                required
                fullWidth
                value={formDeviceName}
                onChange={(e) => setFormDeviceName(e.target.value)}
                placeholder="e.g. Main Inbound Weighbridge"
              />

              {/* Connection Type */}
              <StandardDropdown
                label={t('scale.connectionType') || 'Connection Type'}
                fullWidth
                value={formDeviceType}
                allowClear={false}
                onChange={(e) => setFormDeviceType(e.target.value)}
              >
                <option value="local">{t('scale.localCom') || 'Serial COM / USB (Local Scale Agent)'}</option>
                <option value="remote">{t('scale.remoteIp') || 'Network IP / Gateway (Remote)'}</option>
                <option value="virtual">{t('scale.virtualSim') || 'Virtual Simulator (Lab Testing)'}</option>
              </StandardDropdown>

              {/* ── Local COM Options ───────────────────────────────────────── */}
              {formDeviceType === 'local' && (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    bgcolor: 'var(--color-surface-hover, rgba(0,0,0,0.02))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                    LOCAL SCALE CONNECTION
                  </Typography>

                  {/* Auto vs Manual Configuration */}
                  <RadioGroup
                    value={formConfigMode}
                    onChange={(e) => setFormConfigMode(e.target.value)}
                  >
                    <FormControlLabel
                      value="auto"
                      control={<Radio />}
                      label={t('scale.autoDetectMode') || 'Auto-detect (Recommended)'}
                    />
                    <Typography variant="body2" sx={{ color: 'text.secondary', pl: 4, mt: -1, mb: 1 }}>
                      {t('scale.autoDetectHelper') ||
                        'The Scale Agent will automatically find the COM port and baud rate.'}
                    </Typography>
                    <FormControlLabel
                      value="manual"
                      control={<Radio />}
                      label={t('scale.manualConfig') || 'Advanced / Manual Configuration'}
                    />
                  </RadioGroup>

                  {/* Manual Configuration (Advanced) */}
                  {formConfigMode === 'manual' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
                      {/* COM Port Selector / Input */}
                      {detectedPortsList.length > 0 && !formIsCustomComPort ? (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <StandardDropdown
                            fullWidth
                            label={t('scale.comPort') || 'COM Port'}
                            value={formComPort}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setFormIsCustomComPort(true);
                              } else {
                                setFormComPort(e.target.value);
                              }
                            }}
                          >
                            {detectedPortsList.map((p) => (
                              <option key={p.port} value={p.port}>
                                {p.port} — {p.description || 'Serial Device'}
                              </option>
                            ))}
                            <option value="__custom__">
                              ➕ {t('scale.manualPort') || 'Enter custom port manually...'}
                            </option>
                          </StandardDropdown>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <TextField
                            fullWidth
                            label={t('scale.manualComPortLabel') || 'COM Port'}
                            value={formComPort}
                            onChange={(e) => setFormComPort(e.target.value.toUpperCase())}
                            placeholder="e.g. COM3 or /dev/ttyUSB0"
                            helperText={
                              detectedPortsList.length > 0 ? (
                                <Button
                                  variant="text"
                                  size="small"
                                  sx={{ p: 0, minWidth: 0, textTransform: 'none' }}
                                  onClick={() => setFormIsCustomComPort(false)}
                                >
                                  ← Pick from detected ports
                                </Button>
                              ) : (
                                'Enter the serial port assigned to the indicator'
                              )
                            }
                          />
                        </Box>
                      )}

                      {/* Baud Rate */}
                      <StandardDropdown
                        fullWidth
                        label={t('scale.baudRate') || 'Baud Rate'}
                        value={formBaudRate}
                        allowClear={false}
                        onChange={(e) => setFormBaudRate(Number(e.target.value))}
                      >
                        {BAUD_RATES.map((rate) => (
                          <option key={rate} value={rate}>
                            {rate} baud {rate === 9600 ? '(Standard / Default)' : ''}
                          </option>
                        ))}
                      </StandardDropdown>
                    </Box>
                  )}
                </Box>
              )}

              {/* ── Remote IP Options ──────────────────────────────────────── */}
              {formDeviceType === 'remote' && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: 2 }}>
                  <TextField
                    label="IP Address"
                    required
                    value={formIpAddress}
                    onChange={(e) => setFormIpAddress(e.target.value)}
                    placeholder="e.g. 192.168.1.150"
                  />
                  <TextField
                    label="Port"
                    type="number"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    placeholder="8000"
                  />
                </Box>
              )}

              {/* ── Location ───────────────────────────────────────────────── */}
              <TextField
                label="Physical Location"
                fullWidth
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                placeholder="e.g. Inbound Gate Weighbridge 1"
              />

              {/* ── Is Active Switch ───────────────────────────────────────── */}
              <FormControlLabel
                control={
                  <Switch
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    color="primary"
                  />
                }
                label={t('scale.active') || 'Active for live weighing operations'}
              />
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setIsModalOpen(false)} color="inherit" disabled={isSaving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="contained" color="primary" disabled={isSaving}>
              {isSaving ? t('common.working') : t('common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* ── Shared Confirmation Dialog ────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        loading={confirmDialog.loading}
        onConfirm={confirmDialog.action}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}

export default ScaleDevicesPage;
