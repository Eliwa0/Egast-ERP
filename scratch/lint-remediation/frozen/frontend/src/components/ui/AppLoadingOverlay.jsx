import React from 'react';
import AppSpinner from './AppSpinner';
import { useI18n } from '../../contexts/I18nContext';

/**
 * AppLoadingOverlay: Subtle, semi-transparent overlay for sections, tables, or modals
 * while fetching updates or executing local actions without hiding underlying elements.
 *
 * @param {boolean} active - Whether the overlay is visible
 * @param {string} text - Optional descriptive text (e.g. "جاري التحديث...", "Refreshing...")
 * @param {'sm'|'md'|'lg'} spinnerSize - Size of spinner
 */
export default function AppLoadingOverlay({
  active = true,
  text,
  spinnerSize = 'md',
  className = '',
  children,
}) {
  const { t } = useI18n();
  if (!active) return children || null;

  const resolvedText = text || t('common.loading');

  return (
    <div
      className={`app-loading-overlay ${className}`}
      role="status"
      aria-live="polite"
      aria-label={resolvedText}
    >
      <AppSpinner size={spinnerSize} />
      {resolvedText && <span className="app-loading-overlay__text">{resolvedText}</span>}
      {children}
    </div>
  );
}
