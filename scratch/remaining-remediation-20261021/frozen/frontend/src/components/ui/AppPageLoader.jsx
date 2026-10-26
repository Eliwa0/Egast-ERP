import React from 'react';
import AppSpinner from './AppSpinner';
import LoadingSkeleton from './LoadingSkeleton';
import { useI18n } from '../../contexts/I18nContext';

/**
 * AppPageLoader: Graceful placeholder while a page loads its initial data.
 * Prevents flashing empty/broken UI screens.
 *
 * @param {string} title - Optional main title
 * @param {string} message - Optional informative subtitle/message
 * @param {boolean} skeleton - Whether to render skeleton cards instead of spinner
 * @param {number} skeletonRows - Number of skeleton rows if skeleton=true
 */
export default function AppPageLoader({
  title,
  message,
  skeleton = false,
  skeletonRows = 4,
  className = '',
  style,
}) {
  const { t } = useI18n();
  const effectiveTitle = title || t('common.loading');

  if (skeleton) {
    return (
      <div className={`page-shell ${className}`} style={{ padding: '24px', ...style }}>
        <LoadingSkeleton rows={skeletonRows} label={effectiveTitle} />
      </div>
    );
  }

  return (
    <div
      className={`app-page-loader ${className}`}
      style={style}
      role="status"
      aria-live="polite"
      aria-label={effectiveTitle}
    >
      <AppSpinner size="lg" />
      <h3 className="app-page-loader__title">{effectiveTitle}</h3>
      {message && <p className="app-page-loader__subtitle">{message}</p>}
    </div>
  );
}
