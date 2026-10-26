import RemoteAutocomplete from '../../../components/ui/RemoteAutocomplete';
import { scaleFarmSearch } from '../../../services/masterDataSearch';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Radio,
  RadioGroup,
  Autocomplete,
  Tooltip,
  IconButton,
} from '@mui/material';
import scaleApi from '../services/scaleApi';
import { useToast } from '../../../components/ui/ToastProvider';

export default function QuotationMatchingSection({
  matchedQuotation,
  onMatchQuotation,
  onUnmatchQuotation,
  initialVehicle = '',
}) {
  const toast = useToast();

  // All eligible quotations loaded from backend
  const [allQuotations, setAllQuotations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Client-side instant filter states
  const [vehicleFilter, setVehicleFilter] = useState(initialVehicle || '');
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [farmInputText, setFarmInputText] = useState('');

  // SAP Master Data for Farm selector
  
  const isFarmsLoading = false;

  // Multi-line selection dialog state
  const [lineModalQuotation, setLineModalQuotation] = useState(null);
  const [selectedLineIndex, setSelectedLineIndex] = useState(0);

  // Sync initialVehicle if provided externally
  useEffect(() => {
    if (initialVehicle && !vehicleFilter) {
      setVehicleFilter(initialVehicle);
    }
  }, [initialVehicle]);

  // Load SAP farms for the farm selector filter


  // Fetch all eligible quotations automatically on mount
  const loadQuotations = useCallback(async () => {
    setIsLoading(true);
    try {
      // Call endpoint without filters to retrieve all eligible quotations
      const res = await scaleApi.getAvailableQuotations({});
      if (res.success && Array.isArray(res.data)) {
        setAllQuotations(res.data);
      } else {
        setAllQuotations([]);
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'فشل في جلب عروض أسعار الشراء المتاحة';
      toast.error(msg);
      setAllQuotations([]);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadQuotations();
  }, [loadQuotations]);

  // Instant Client-side AND filtering on all loaded quotation cards
  const filteredQuotations = useMemo(() => {
    return allQuotations.filter((q) => {
      // 1. Vehicle Plate filter (substring, case-insensitive)
      if (vehicleFilter.trim()) {
        const needle = vehicleFilter.trim().toLowerCase();
        const qVeh = String(q.vehicle_number || '').trim().toLowerCase();
        if (!qVeh.includes(needle)) {
          return false;
        }
      }

      // 2. Farm / Vendor filter (by selected card code or input text)
      const targetFarmCode = selectedFarm?.code
        ? String(selectedFarm.code).trim().toLowerCase()
        : farmInputText.trim().toLowerCase();

      if (targetFarmCode) {
        const qCard = String(q.vendor_card_code || '').trim().toLowerCase();
        const qName = String(q.vendor_name || '').trim().toLowerCase();
        const farmName = selectedFarm?.name ? String(selectedFarm.name).trim().toLowerCase() : '';

        const codeMatch = qCard.includes(targetFarmCode);
        const nameMatch = qName.includes(targetFarmCode) || (farmName && qName.includes(farmName));
        if (!codeMatch && !nameMatch) {
          return false;
        }
      }

      return true;
    });
  }, [allQuotations, vehicleFilter, selectedFarm, farmInputText]);

  const hasActiveFilters = Boolean(vehicleFilter.trim() || selectedFarm || farmInputText.trim());

  const handleClearFilters = () => {
    setVehicleFilter('');
    setSelectedFarm(null);
    setFarmInputText('');
  };

  const handleStartMatch = (quotation) => {
    const lines = quotation.lines || [];
    if (lines.length > 1) {
      setLineModalQuotation(quotation);
      setSelectedLineIndex(0);
    } else {
      onMatchQuotation(quotation, 0);
    }
  };

  const handleConfirmLineMatch = () => {
    if (!lineModalQuotation) return;
    onMatchQuotation(lineModalQuotation, selectedLineIndex);
    setLineModalQuotation(null);
  };

  // If a quotation is already matched, show the active binding banner
  if (matchedQuotation) {
    const selectedLine =
      matchedQuotation.lines?.[matchedQuotation.line_index] || matchedQuotation.lines?.[0] || {};
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 2.5,
          mb: 3,
          borderRadius: 'var(--radius-lg, 12px)',
          backgroundColor: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.08))',
          borderColor: 'var(--primary, #2563eb)',
          borderWidth: '2px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                backgroundColor: 'var(--primary, #2563eb)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1.2rem',
              }}
            >
              ✓
            </Box>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" fontWeight={800} color="var(--primary, #2563eb)">
                  تم ربط عرض سعر الشراء #{matchedQuotation.quotation_number}
                </Typography>
                <Chip
                  label={`SAP DocEntry: ${matchedQuotation.sap_doc_entry}`}
                  size="small"
                  variant="outlined"
                  sx={{ borderColor: 'var(--primary, #2563eb)', color: 'var(--primary, #2563eb)', fontWeight: 600 }}
                />
                <Chip
                  label="وارد محمل"
                  size="small"
                  sx={{ backgroundColor: 'var(--primary, #2563eb)', color: '#ffffff', fontWeight: 700 }}
                />
              </Box>
              <Typography variant="body2" color="var(--text-muted, #64748b)" sx={{ mt: 0.3 }}>
                المورد: {matchedQuotation.vendor_name || matchedQuotation.vendor_card_code}
                {selectedLine.item_name && ` — الصنف: ${selectedLine.item_name}`}
                {matchedQuotation.vehicle_number && ` — سيارة العرض: ${matchedQuotation.vehicle_number}`}
              </Typography>
            </Box>
          </Box>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={onUnmatchQuotation}
            sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 700 }}
          >
            إلغاء الربط / تغيير ✕
          </Button>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, 1fr)' },
            gap: 1.5,
            pt: 1,
            borderTop: '1px dashed var(--border, #cbd5e1)',
          }}
        >
          <div>
            <Typography variant="caption" color="var(--text-muted, #64748b)">الكمية المقدرة:</Typography>
            <Typography variant="body2" fontWeight={700} color="var(--text, #0f172a)">
              {Number(selectedLine.quoted_qty || matchedQuotation.quoted_quantity || 0).toLocaleString()} {selectedLine.uom_code || 'KG'}
            </Typography>
          </div>
          <div>
            <Typography variant="caption" color="var(--text-muted, #64748b)">البرنيكات / الأقفاص:</Typography>
            <Typography variant="body2" fontWeight={700} color="var(--text, #0f172a)">
              {selectedLine.container_quantity || matchedQuotation.container_quantity || 0}
            </Typography>
          </div>
          <div>
            <Typography variant="caption" color="var(--text-muted, #64748b)">المستودع:</Typography>
            <Typography variant="body2" fontWeight={700} color="var(--text, #0f172a)">
              {selectedLine.warehouse_code || matchedQuotation.warehouse_code || '---'}
            </Typography>
          </div>
          <div>
            <Typography variant="caption" color="var(--text-muted, #64748b)">رقم السطر المرتبط:</Typography>
            <Typography variant="body2" fontWeight={700} color="var(--text, #0f172a)">
              سطر {matchedQuotation.line_index + 1} ({selectedLine.item_code || '---'})
            </Typography>
          </div>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2.5, md: 3 },
        mb: 3,
        borderRadius: 'var(--radius-lg, 12px)',
        backgroundColor: 'var(--bg-elevated, #ffffff)',
        borderColor: 'var(--border, #e2e8f0)',
        boxShadow: 'var(--shadow-sm, 0 4px 12px rgba(15, 35, 52, 0.06))',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md, 8px)',
              backgroundColor: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.08))',
              color: 'var(--primary, #2563eb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.25rem',
            }}
          >
            📋
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" fontWeight={800} color="var(--text, #0f172a)">
                عروض أسعار الشراء المتاحة (وارد محمل)
              </Typography>
              {!isLoading && (
                <Chip
                  label={`${filteredQuotations.length} متاح`}
                  size="small"
                  color={filteredQuotations.length > 0 ? "primary" : "default"}
                  variant="outlined"
                  sx={{ fontWeight: 700, height: 22, fontSize: '0.75rem' }}
                />
              )}
            </Box>
            <Typography variant="caption" color="var(--text-muted, #64748b)">
              اختر عرض سعر الشراء المعتمد في SAP لربط تذكرة الوزن به تلقائياً وتعبئة البيانات
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={loadQuotations}
            disabled={isLoading}
            sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 600, fontSize: '0.8rem' }}
          >
            {isLoading ? <CircularProgress size={16} sx={{ mr: 0.5 }} /> : 'تحديث 🔄'}
          </Button>
        </Box>
      </Box>

      {/* Instant Filters Row (Filters already-loaded cards client-side) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1.2fr 1.8fr auto' },
          gap: 1.5,
          alignItems: 'center',
          mb: 2.5,
          p: 1.5,
          borderRadius: 'var(--radius-md, 8px)',
          backgroundColor: 'var(--bg-soft, #f8fafc)',
          border: '1px solid var(--border, #e2e8f0)',
        }}
      >
        <TextField
          size="small"
          label="تصفية برقم اللوحة"
          placeholder="اكتب رقم اللوحة للتصفية الفورية..."
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
          fullWidth
        />

        <RemoteAutocomplete
          size="small"
          searchSource={scaleFarmSearch}
          value={selectedFarm}
          onChange={(_, newVal) => setSelectedFarm(newVal)}
          inputValue={farmInputText}
          onInputChange={(_, newInputValue) => setFarmInputText(newInputValue)}
          loading={isFarmsLoading}
          getOptionLabel={(opt) => (opt ? `${opt.name} (${opt.code})` : '')}
          isOptionEqualToValue={(opt, val) => opt?.code === val?.code}
          renderInput={(params) => (
            <TextField
              {...params}
              label="تصفية بالمزرعة / المورد"
              placeholder={isFarmsLoading ? 'جاري التحميل...' : 'اختر المزرعة أو اكتب للبحث'}
              fullWidth
            />
          )}
        />

        {hasActiveFilters && (
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            onClick={handleClearFilters}
            sx={{ borderRadius: 'var(--radius-md, 8px)', fontWeight: 600, height: 40, whiteSpace: 'nowrap' }}
          >
            مسح الفلاتر ✕
          </Button>
        )}
      </Box>

      {/* Cards Area */}
      {isLoading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 5, gap: 1.5 }}>
          <CircularProgress size={36} />
          <Typography variant="body2" color="var(--text-muted, #64748b)">
            جاري تحميل عروض أسعار الشراء المتاحة...
          </Typography>
        </Box>
      ) : allQuotations.length === 0 ? (
        <Box
          sx={{
            py: 4,
            px: 2,
            textAlign: 'center',
            backgroundColor: 'var(--bg-soft, #f8fafc)',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px dashed var(--border, #cbd5e1)',
          }}
        >
          <Typography variant="body1" fontWeight={700} color="var(--text, #0f172a)" sx={{ mb: 0.5 }}>
            لا توجد عروض أسعار شراء متاحة حالياً للربط
          </Typography>
          <Typography variant="body2" color="var(--text-muted, #64748b)">
            تظهر هنا عروض الأسعار المسجلة والمرحلة في SAP والتي لم يتم ربطها بعد بتذكرة وزن نشطة أو إذن استلام (GRPO).
          </Typography>
          <Typography variant="caption" color="var(--text-muted, #94a3b8)" sx={{ display: 'block', mt: 1 }}>
            يمكنك إدخال بيانات التوزين يدوياً بشكل طبيعي دون ربط.
          </Typography>
        </Box>
      ) : filteredQuotations.length === 0 ? (
        <Box
          sx={{
            py: 3,
            px: 2,
            textAlign: 'center',
            backgroundColor: 'var(--bg-soft, #f8fafc)',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px dashed var(--border, #cbd5e1)',
          }}
        >
          <Typography variant="body2" color="var(--text-muted, #64748b)" fontWeight={600}>
            لا توجد عروض أسعار مطابقة لشروط التصفية الحالية ({vehicleFilter || selectedFarm?.name || farmInputText}).
          </Typography>
          <Button
            variant="text"
            size="small"
            onClick={handleClearFilters}
            sx={{ mt: 1, fontWeight: 700 }}
          >
            عرض كافة العروض المتاحة ({allQuotations.length})
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {hasActiveFilters && (
            <Typography variant="caption" fontWeight={600} color="var(--text-muted, #64748b)">
              عرض {filteredQuotations.length} من أصل {allQuotations.length} عرض سعر متاح:
            </Typography>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 2,
            }}
          >
            {filteredQuotations.map((quotation) => {
              const firstLine = quotation.lines?.[0] || {};
              const hasMultipleLines = (quotation.lines?.length || 0) > 1;

              return (
                <Paper
                  key={quotation.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 'var(--radius-md, 10px)',
                    backgroundColor: 'var(--bg-soft, #f8fafc)',
                    borderColor: 'var(--border, #cbd5e1)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: 'var(--primary, #2563eb)',
                      boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.06))',
                    },
                  }}
                >
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2" fontWeight={800} color="var(--primary, #2563eb)">
                          عرض سعر #{quotation.quotation_number}
                        </Typography>
                        {hasMultipleLines && (
                          <Chip
                            label={`${quotation.lines.length} سطور`}
                            size="small"
                            color="info"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem', height: 20 }}
                          />
                        )}
                      </Box>
                      <Chip
                        label={`DocEntry: ${quotation.sap_doc_entry}`}
                        size="small"
                        sx={{ fontSize: '0.72rem', height: 22, fontWeight: 700 }}
                      />
                    </Box>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, fontSize: '0.85rem' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="caption" color="var(--text-muted, #64748b)">المزرعة / المورد:</Typography>
                        <Typography variant="body2" fontWeight={600} color="var(--text, #0f172a)">
                          {quotation.vendor_name || quotation.vendor_card_code}
                        </Typography>
                      </Box>

                      {quotation.vehicle_number && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="var(--text-muted, #64748b)">السيارة في العرض:</Typography>
                          <Typography variant="body2" fontWeight={600} color="var(--text, #0f172a)">
                            {quotation.vehicle_number}
                          </Typography>
                        </Box>
                      )}

                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="caption" color="var(--text-muted, #64748b)">الصنف:</Typography>
                        <Typography variant="body2" fontWeight={600} color="var(--text, #0f172a)">
                          {firstLine.item_name || firstLine.item_code || '---'}
                          {hasMultipleLines && ` (+${quotation.lines.length - 1} أصناف أخرى)`}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography variant="caption" color="var(--text-muted, #64748b)">الكمية المقدرة:</Typography>
                        <Typography variant="body2" fontWeight={700} color="var(--primary, #2563eb)">
                          {Number(quotation.quoted_quantity || 0).toLocaleString()} {firstLine.uom_code || 'KG'}
                        </Typography>
                      </Box>

                      {quotation.container_quantity > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="var(--text-muted, #64748b)">البرنيكات:</Typography>
                          <Typography variant="body2" fontWeight={600} color="var(--text, #0f172a)">
                            {quotation.container_quantity}
                          </Typography>
                        </Box>
                      )}

                      {quotation.warehouse_code && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="var(--text-muted, #64748b)">المستودع:</Typography>
                          <Typography variant="body2" fontWeight={600} color="var(--text, #0f172a)">
                            {quotation.warehouse_code}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>

                  <Button
                    variant="contained"
                    color="primary"
                    fullWidth
                    size="small"
                    onClick={() => handleStartMatch(quotation)}
                    sx={{
                      borderRadius: 'var(--radius-md, 8px)',
                      fontWeight: 700,
                      py: 1,
                      mt: 1,
                    }}
                  >
                    ربط وبدء الوزنة الأولى ←
                  </Button>
                </Paper>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Multi-line Selection Dialog */}
      <Dialog
        open={Boolean(lineModalQuotation)}
        onClose={() => setLineModalQuotation(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, color: 'var(--text, #0f172a)' }}>
          اختيار سطر الصنف من عرض السعر #{lineModalQuotation?.quotation_number}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="var(--text-muted, #64748b)" sx={{ mb: 2 }}>
            عرض السعر يحتوي على عدة سطور أصناف. يرجى اختيار السطر المطلوب وزنه:
          </Typography>

          <RadioGroup
            value={selectedLineIndex}
            onChange={(e) => setSelectedLineIndex(Number(e.target.value))}
          >
            {lineModalQuotation?.lines?.map((line, idx) => (
              <Paper
                key={idx}
                variant="outlined"
                sx={{
                  p: 1.5,
                  mb: 1.5,
                  borderRadius: 'var(--radius-md, 8px)',
                  borderColor: selectedLineIndex === idx ? 'var(--primary, #2563eb)' : 'var(--border, #e2e8f0)',
                  backgroundColor: selectedLineIndex === idx ? 'var(--bg-primary-soft, rgba(37, 99, 235, 0.04))' : 'transparent',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedLineIndex(idx)}
              >
                <Radio checked={selectedLineIndex === idx} value={idx} sx={{ p: 0.5 }} />
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="subtitle2" fontWeight={700} color="var(--text, #0f172a)">
                      سطر {idx + 1}: {line.item_name || line.item_code}
                    </Typography>
                    <Chip label={line.item_code} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.72rem' }} />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="var(--text-muted, #64748b)">
                      الكمية: <strong>{Number(line.quoted_qty || 0).toLocaleString()} {line.uom_code || 'KG'}</strong>
                    </Typography>
                    {line.warehouse_code && (
                      <Typography variant="caption" color="var(--text-muted, #64748b)">
                        المستودع: <strong>{line.warehouse_code}</strong>
                      </Typography>
                    )}
                    {line.container_quantity > 0 && (
                      <Typography variant="caption" color="var(--text-muted, #64748b)">
                        البرنيكات: <strong>{line.container_quantity}</strong>
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Paper>
            ))}
          </RadioGroup>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setLineModalQuotation(null)} sx={{ fontWeight: 600 }}>
            إلغاء
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleConfirmLineMatch}
            sx={{ fontWeight: 700, borderRadius: 'var(--radius-md, 8px)', px: 3 }}
          >
            تأكيد الاختيار والربط ←
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
