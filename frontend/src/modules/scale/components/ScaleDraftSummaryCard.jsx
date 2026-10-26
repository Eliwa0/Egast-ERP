import { PrintActionButton } from '../../../components/ui/ActionIconButton';
import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Divider,
  Button,
  Chip,
} from '@mui/material';
import { useI18n } from '../../../contexts/I18nContext';
import { getProductIcon } from '../../../utils/productIcon';

export function ScaleDraftSummaryCard({
  draft,
  onCancelDraft,
  onPrintTicket,
  isSubmitting = false,
}) {
  const { t, lang } = useI18n();

  if (!draft) return null;

  const isCompleted = draft.is_closed && Number(draft.product_weight) > 0;
  const isSentToQuality = draft.status === 'SENT_TO_QUALITY';

  return (
    <Card variant="outlined" sx={{ mt: 2, borderRadius: 'var(--radius-lg)' }} className="scale-ticket-card">
      <CardContent>
        {/* Ticket Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <div>
            <Typography variant="overline" color="text.secondary" fontWeight={700}>
              {t('scale.ticketHeader')}
            </Typography>
            <Typography variant="h5" fontWeight={800} color="primary">
              #{draft.draft_number}
            </Typography>
          </div>
          <div>
            <Chip
              label={draft.status_display || draft.status}
              color={
                draft.status === 'SENT_TO_QUALITY'
                  ? 'success'
                  : draft.status === 'COMPLETED'
                  ? 'primary'
                  : draft.status === 'CANCELLED'
                  ? 'error'
                  : 'warning'
              }
              sx={{ fontWeight: 700, fontSize: '13px' }}
            />
          </div>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* Master Info */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 2, my: 2 }}>
          <div>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">🚚</span>
              {t('scale.vehicle')}
            </Typography>
            <Typography variant="body1" fontWeight={700}>{draft.effective_vehicle_number || '---'}</Typography>
          </div>
          <div>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">👤</span>
              {t('scale.driver')}
            </Typography>
            <Typography variant="body1" fontWeight={700}>{draft.effective_driver_name || '---'}</Typography>
          </div>
          <div>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">🏢</span>
              {t('scale.supplier')}
            </Typography>
            <Typography variant="body1" fontWeight={700}>{draft.vendor_name || '---'}</Typography>
          </div>
          <div>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">{getProductIcon(draft.item_name || draft.item_code)}</span>
              {t('scale.item')}
            </Typography>
            <Typography variant="body1" fontWeight={700}>{draft.item_name || '---'}</Typography>
          </div>
        </Box>

        {draft.shipping_manifest && (
          <Typography variant="body1" fontWeight={700} sx={{ my: 1.5 }}>
            {lang === 'ar' ? 'رقم أمر البيع' : 'Sales order number'}: <bdi>{draft.shipping_manifest.sales_order_number || '—'}</bdi>
          </Typography>
        )}
        {draft.quotation && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              my: 1.5,
              p: 1.25,
              borderRadius: 'var(--radius-md, 8px)',
              backgroundColor: 'var(--bg-primary-soft, rgba(37, 99, 235, 0.08))',
              border: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}
          >
            <Typography variant="body2" fontWeight={700} color="var(--primary, #2563eb)">
              📋 عرض سعر الشراء: #{draft.quotation_number || draft.quotation}
            </Typography>
            {draft.quotation_sap_doc_entry && (
              <Chip
                size="small"
                variant="outlined"
                label={`SAP DocEntry: ${draft.quotation_sap_doc_entry}`}
                sx={{ height: 22, fontSize: '0.75rem', fontWeight: 600 }}
              />
            )}
            <Chip
              size="small"
              variant="outlined"
              label={`السطر: ${draft.quotation_line_index !== undefined ? draft.quotation_line_index + 1 : 1}`}
              sx={{ height: 22, fontSize: '0.75rem', fontWeight: 600 }}
            />
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />

        {/* Weights Readout Matrix */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, my: 2 }}>
          {/* Loaded / Gross */}
          <Box sx={{ p: 2, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">⚖️</span>
              {t('scale.grossWeight')}
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              {draft.net_weight_loaded ? `${Number(draft.net_weight_loaded).toLocaleString()} KG` : '---'}
            </Typography>
            {draft.loaded_time && (
              <Typography variant="caption" color="text.secondary">
                🕒 {new Date(draft.loaded_time).toLocaleTimeString()}
              </Typography>
            )}
          </Box>

          {/* Empty / Tare */}
          <Box sx={{ p: 2, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">⚖️</span>
              {t('scale.tareWeight')}
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              {draft.net_weight_empty ? `${Number(draft.net_weight_empty).toLocaleString()} KG` : '---'}
            </Typography>
            {draft.empty_time && (
              <Typography variant="caption" color="text.secondary">
                🕒 {new Date(draft.empty_time).toLocaleTimeString()}
              </Typography>
            )}
          </Box>

          {/* Product Net */}
          <Box sx={{ p: 2, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-primary-soft)', border: '2px solid var(--color-primary)' }}>
            <Typography variant="caption" color="primary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <span className="meta-label-icon" aria-hidden="true">⚖️</span>
              {t('scale.netWeight')}
            </Typography>
            <Typography variant="h5" fontWeight={900} color="primary">
              {draft.product_weight ? `${Number(draft.product_weight).toLocaleString()} KG` : '---'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {draft.is_closed ? '✓ Final Certified Weight' : 'Pending 2nd Weight'}
            </Typography>
          </Box>
        </Box>

        {/* Action Buttons Bar */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 3, flexWrap: 'wrap' }}>
          {onPrintTicket && isCompleted && (
            <PrintActionButton icon="🖨️" onClick={onPrintTicket}/>
          )}

          {onCancelDraft && draft.status !== 'CANCELLED' && !isSentToQuality && (
            <Button variant="outlined" color="error" onClick={onCancelDraft} disabled={isSubmitting}>
              ✕ {t('scale.cancelDraft')}
            </Button>
          )}


        </Box>
      </CardContent>
    </Card>
  );
}

export default ScaleDraftSummaryCard;
