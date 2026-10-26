import StandardDropdown from '../../../components/ui/StandardDropdown';
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import PageHeader from '../../../components/ui/PageHeader';
import LoadingSkeleton from '../../../components/ui/LoadingSkeleton';
import EmptyState from '../../../components/ui/EmptyState';
import { useToast } from '../../../components/ui/ToastProvider';
import scaleApi from '../services/scaleApi';

const emptyForm = {
  item_code: '',
  item_name: '',
  name: '',
  weight: '',
  is_active: true,
};

export function ScaleItemElementsPage() {
  const { t } = useI18n();
  const toast = useToast();

  const [elements, setElements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingElement, setEditingElement] = useState(null);
  const [formData, setFormData] = useState(emptyForm);

  const fetchElements = async () => {
    setIsLoading(true);
    try {
      const res = await scaleApi.getItemElements();
      if (res.success) {
        setElements(res.data || []);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchElements();
  }, []);

  const handleOpenCreate = () => {
    setEditingElement(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (element) => {
    setEditingElement(element);
    setFormData({
      item_code: element.item_code || '',
      item_name: element.item_name || '',
      name: element.name || '',
      weight: element.weight || '',
      is_active: element.is_active !== false,
    });
    setIsModalOpen(true);
  };

  const handleChange = (field) => (event) => {
    const value = field === 'is_active'
      ? event.target.value === 'true'
      : event.target.value;
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const buildPayload = (data) => ({
    item_code: data.item_code.trim(),
    item_name: data.item_name.trim(),
    name: data.name.trim(),
    weight: data.weight,
    is_active: data.is_active,
  });

  const handleSaveElement = async (event) => {
    event.preventDefault();
    try {
      const payload = buildPayload(formData);
      if (editingElement) {
        await scaleApi.updateItemElement(editingElement.id, payload);
        toast.success(t('scale.itemElementUpdated'));
      } else {
        await scaleApi.createItemElement(payload);
        toast.success(t('scale.itemElementCreated'));
      }
      setIsModalOpen(false);
      fetchElements();
    } catch (err) {
      const errors = err?.response?.data?.errors;
      const message = errors ? JSON.stringify(errors) : err?.response?.data?.error || err.message;
      toast.error(message);
    }
  };

  const handleToggleActive = async (element) => {
    try {
      await scaleApi.updateItemElement(element.id, { is_active: !element.is_active });
      toast.success(t('scale.itemElementUpdated'));
      fetchElements();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message);
    }
  };

  return (
    <div className="page-shell scale-item-elements-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.itemElementsTitle')}
        description={t('scale.itemElementsSubtitle')}
        actions={
          <Button variant="contained" color="primary" onClick={handleOpenCreate}>
            + {t('scale.newItemElement')}
          </Button>
        }
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : elements.length === 0 ? (
        <EmptyState title={t('scale.noItemElementsFound')} />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 'var(--radius-lg)' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('scale.itemCode')}</TableCell>
                <TableCell>{t('scale.itemName')}</TableCell>
                <TableCell>{t('scale.elementName')}</TableCell>
                <TableCell align="right">{t('scale.unitWeight')}</TableCell>
                <TableCell align="center">{t('common.status')}</TableCell>
                <TableCell align="center">{t('scale.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {elements.map((element) => (
                <TableRow key={element.id} hover>
                  <TableCell sx={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                    {element.item_code}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{element.item_name || '---'}</TableCell>
                  <TableCell>{element.name}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    {Number(element.weight).toLocaleString()} KG
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={element.is_active ? t('scale.active') : t('scale.inactive')}
                      color={element.is_active ? 'success' : 'default'}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Button variant="outlined" size="small" onClick={() => handleOpenEdit(element)}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="outlined" size="small" onClick={() => handleToggleActive(element)}>
                        {element.is_active ? t('scale.deactivateElement') : t('scale.activateElement')}
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSaveElement}>
          <DialogTitle>
            {editingElement ? t('scale.editItemElement') : t('scale.newItemElement')}
          </DialogTitle>
          <DialogContent dividers>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              <TextField
                label={t('scale.itemCode')}
                required
                fullWidth
                value={formData.item_code}
                onChange={handleChange('item_code')}
              />
              <TextField
                label={t('scale.itemName')}
                fullWidth
                value={formData.item_name}
                onChange={handleChange('item_name')}
              />
              <TextField
                label={t('scale.elementName')}
                required
                fullWidth
                value={formData.name}
                onChange={handleChange('name')}
              />
              <TextField
                label={t('scale.unitWeight')}
                required
                fullWidth
                type="number"
                inputProps={{ min: '0', step: '0.01' }}
                value={formData.weight}
                onChange={handleChange('weight')}
              />
              <StandardDropdown
                label={t('common.status')}
                fullWidth
                value={String(formData.is_active)}
                allowClear={false}
                onChange={handleChange('is_active')}
              >
                <option value="true">{t('scale.active')}</option>
                <option value="false">{t('scale.inactive')}</option>
              </StandardDropdown>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setIsModalOpen(false)} color="inherit">
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="contained" color="primary">
              {t('common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  );
}

export default ScaleItemElementsPage;
