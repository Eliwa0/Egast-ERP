import React from 'react';
import { useI18n } from '../../contexts/I18nContext';

export default function LoadingSkeleton({ rows, count = 4, className = '', label, type = 'rows' }) {
  const { t } = useI18n();
  const effectiveRows = rows !== undefined ? rows : count;
  const resolvedLabel = label || t('common.loading');

  return (
    <div
      className={`skeleton-stack ${type === 'cards' ? 'skeleton-stack--cards' : ''} ${className}`}
      aria-busy="true"
      role="status"
      aria-label={resolvedLabel}
    >
      {Array.from({ length: effectiveRows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
