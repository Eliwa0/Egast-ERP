import React from 'react';
import { useI18n } from '../../contexts/I18nContext';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  loading = false,
  onConfirm,
  onClose,
}) {
  const { t } = useI18n();
  if (!open) return null;

  const resolvedConfirmLabel = confirmLabel || t('common.confirm');
  const resolvedCancelLabel = cancelLabel || t('common.cancel');

  return (
    <div className="dialog-layer" role="presentation">
      <div className="dialog-backdrop" onClick={loading ? undefined : onClose} />
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="confirm-dialog__header">
          <h2 id="confirm-dialog-title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} disabled={loading} aria-label={t('common.close')}>
            x
          </button>
        </div>
        <p>{message}</p>
        <div className="confirm-dialog__actions">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={loading}>
            {resolvedCancelLabel}
          </button>
          <button type="button" className={`primary-btn ${variant === 'danger' ? 'danger-btn' : ''}`} onClick={onConfirm} disabled={loading}>
            {loading ? t('common.working') : resolvedConfirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
