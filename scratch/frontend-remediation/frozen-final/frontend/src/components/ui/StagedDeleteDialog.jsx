import React from 'react';
import { useI18n } from '../../contexts/I18nContext';

export default function StagedDeleteDialog({
  open,
  step,
  title,
  message,
  secondTitle,
  secondMessage,
  confirmationValue,
  error,
  loading = false,
  onConfirmationChange,
  onContinue,
  onDelete,
  onClose,
}) {
  const { t } = useI18n();
  if (!open) return null;

  const isFinalStep = step === 'confirm-text';
  const confirmText = confirmationValue || '';

  return (
    <div className="simple-modal-backdrop" role="presentation">
      <div className="simple-modal-card" role="dialog" aria-modal="true" aria-labelledby="staged-delete-dialog-title">
        <div className="simple-modal__header">
          <h2 id="staged-delete-dialog-title" className="simple-modal__title">
            {isFinalStep ? secondTitle : title}
          </h2>
          <button type="button" className="simple-modal__close" onClick={onClose} disabled={loading} aria-label={t('common.close')}>
            x
          </button>
        </div>
        <div className="um-modal-form">
          <p className="staged-delete-dialog__message">{isFinalStep ? secondMessage : message}</p>
          {isFinalStep && (
            <div className="form-field">
              <label className="form-label" htmlFor="staged-delete-confirmation">{t('common.typeDelete')}</label>
              <input
                id="staged-delete-confirmation"
                className="app-input"
                value={confirmText}
                onChange={(event) => onConfirmationChange(event.target.value)}
                autoFocus
              />
            </div>
          )}
          {error && <div className="feedback-message feedback-message--error">{error}</div>}
          <div className="modal-btn-row">
            <button type="button" className="app-button app-button--secondary" onClick={onClose} disabled={loading}>
              {t('common.cancel')}
            </button>
            {isFinalStep ? (
              <button
                type="button"
                className="app-button app-button--danger"
                onClick={onDelete}
                disabled={loading || confirmText !== 'DELETE'}
              >
                {loading ? t('common.working') : t('common.delete')}
              </button>
            ) : (
              <button type="button" className="app-button app-button--danger" onClick={onContinue}>
                {t('common.continue')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
