import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useI18n } from '../../contexts/I18nContext';

const ToastContext = createContext(null);
const DEFAULT_TTL = 4500;

export function ToastProvider({ children }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState([]);
  const labels = useMemo(() => ({
    success: t('common.success'),
    error: t('common.error'),
    warning: t('common.warning'),
    info: t('common.info'),
  }), [t]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message, type = 'info', options = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const toast = {
        id,
        type,
        message,
        title: options.title || labels[type] || labels.info,
      };

      setToasts((current) => [...current.slice(-4), toast]);

      const ttl = options.ttl ?? DEFAULT_TTL;
      if (ttl !== 0) {
        window.setTimeout(() => dismiss(id), ttl);
      }

      return id;
    },
    [dismiss, labels]
  );

  const value = useMemo(
    () => ({
      show,
      dismiss,
      success: (message, options) => show(message, 'success', options),
      error: (message, options) => show(message, 'error', options),
      warning: (message, options) => show(message, 'warning', options),
      info: (message, options) => show(message, 'info', options),
    }),
    [dismiss, show]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.type}`} key={toast.id}>
            <div className="toast__mark" aria-hidden="true">
              {toast.type === 'success' ? 'OK' : toast.type === 'warning' ? '!' : toast.type === 'error' ? 'X' : 'i'}
            </div>
            <div className="toast__body">
              <strong>{toast.title}</strong>
              <span>{toast.message}</span>
            </div>
            <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label={t('common.dismissNotification')}>
              x
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return context;
}
