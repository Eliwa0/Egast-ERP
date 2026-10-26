import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
  IconButton,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useI18n } from '../../../contexts/I18nContext';
import scaleApi from '../services/scaleApi';
import { useToast } from '../../../components/ui/ToastProvider';

export function VehicleEntryModal({ open, onClose, onVehicleCreated }) {
  const { t } = useI18n();
  const toast = useToast();

  const [truckType, setTruckType] = useState('normal');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [trailers, setTrailers] = useState([]);
  const [containers, setContainers] = useState([]);
  const [driverName, setDriverName] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (open) {
      setTruckType('normal');
      setVehicleNumber('');
      setTrailers([]);
      setContainers([]);
      setDriverName('');
      setCompany('');
      setNotes('');
      setIsSubmitting(false);
    }
  }, [open]);

  const handleTruckTypeChange = (e) => {
    const newType = e.target.value;
    setTruckType(newType);
  };

  const addTrailer = () => setTrailers([...trailers, { trailer_number: '' }]);
  const removeTrailer = (index) => setTrailers(trailers.filter((_, i) => i !== index));
  const updateTrailer = (index, value) => {
    const newTrailers = [...trailers];
    newTrailers[index].trailer_number = value;
    setTrailers(newTrailers);
  };

  const addContainer = () => setContainers([...containers, { container_number: '' }]);
  const removeContainer = (index) => setContainers(containers.filter((_, i) => i !== index));
  const updateContainer = (index, value) => {
    const newContainers = [...containers];
    newContainers[index].container_number = value;
    setContainers(newContainers);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!vehicleNumber.trim()) {
      toast.error(t('scale.vehicleNumber') + ' is required');
      return;
    }

    const cleanTrailers = trailers.filter(t => t.trailer_number.trim() !== '');
    const cleanContainers = containers.filter(c => c.container_number.trim() !== '');

    setIsSubmitting(true);
    try {
      const res = await scaleApi.recordVehicleEntry({
        truck_type: truckType,
        vehicle_number: vehicleNumber.trim(),
        trailers: cleanTrailers,
        containers: cleanContainers,
        driver_name: driverName.trim(),
        company: company.trim(),
        notes: notes.trim(),
      });

      if (res.success) {
        toast.success(res.message);
        if (onVehicleCreated) {
          onVehicleCreated(res.data.vehicle);
        }
        onClose();
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Failed to record entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{t('scale.newVehicleModalTitle')}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            
            <FormControl component="fieldset">
              <FormLabel component="legend">{t('scale.truckType')}</FormLabel>
              <RadioGroup
                row
                value={truckType}
                onChange={handleTruckTypeChange}
              >
                <FormControlLabel value="normal" control={<Radio />} label={t('scale.normalTruck')} />
                <FormControlLabel value="container" control={<Radio />} label={t('scale.containerTruck')} />
              </RadioGroup>
            </FormControl>

            <TextField
              label={`${t('scale.vehicleNumber')} *`}
              required
              fullWidth
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="e.g. TRUCK-4589"
              autoFocus
            />

            {/* Trailers Section */}
            <Box sx={{ mt: 1, p: 2, bgcolor: 'var(--bg-muted)', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle2" fontWeight="bold">المقطورات</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={addTrailer} variant="outlined">
                  إضافة مقطورة
                </Button>
              </Box>
              {trailers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">لا توجد مقطورات مضافة لهذه الرحلة</Typography>
              ) : (
                trailers.map((trailer, index) => (
                  <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                    <TextField
                      label={`مقطورة ${index + 1}`}
                      size="small"
                      fullWidth
                      value={trailer.trailer_number}
                      onChange={(e) => updateTrailer(index, e.target.value)}
                      placeholder="رقم المقطورة"
                    />
                    <IconButton color="error" onClick={() => removeTrailer(index)}>
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                ))
              )}
            </Box>

            {/* Containers Section */}
            {truckType === 'container' && (
              <Box sx={{ mt: 1, p: 2, bgcolor: 'var(--bg-muted)', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight="bold">الحاويات</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addContainer} variant="outlined">
                    إضافة حاوية
                  </Button>
                </Box>
                {containers.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">لا توجد حاويات مضافة لهذه الرحلة</Typography>
                ) : (
                  containers.map((container, index) => (
                    <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                      <TextField
                        label={`حاوية ${index + 1}`}
                        size="small"
                        fullWidth
                        value={container.container_number}
                        onChange={(e) => updateContainer(index, e.target.value)}
                        placeholder="رقم الحاوية"
                      />
                      <IconButton color="error" onClick={() => removeContainer(index)}>
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  ))
                )}
              </Box>
            )}

            <TextField
              label={t('scale.company')}
              fullWidth
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Fast Transport Co."
            />
            <TextField
              label={t('scale.notes')}
              fullWidth
              multiline
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={isSubmitting}>
            {isSubmitting ? t('common.pleaseWait') : t('scale.enterGate')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default VehicleEntryModal;
