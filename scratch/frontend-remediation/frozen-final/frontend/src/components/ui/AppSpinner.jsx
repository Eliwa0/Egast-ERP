import React from 'react';

/**
 * AppSpinner: Unified spinner component adhering to the application design system.
 * Supports light, dark, and colored button backgrounds with proper accessibility attributes.
 *
 * @param {'xs'|'sm'|'md'|'lg'} size - Spinner dimension (default: 'sm')
 * @param {string} label - Optional text label displayed alongside the spinner
 * @param {string} ariaLabel - Accessible label (defaults to label or 'Loading...')
 * @param {string} className - Additional CSS class names
 * @param {string} style - Inline styles
 */
export default function AppSpinner({
  size = 'sm',
  label = '',
  ariaLabel,
  className = '',
  style,
  ...props
}) {
  const normalizedSize = ['xs', 'sm', 'md', 'lg'].includes(size) ? size : 'sm';
  const effectiveAriaLabel = ariaLabel || label || 'Loading...';

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={effectiveAriaLabel}
      className={`app-spinner app-spinner--${normalizedSize} ${className}`}
      style={style}
      {...props}
    >
      <span className="app-spinner__circle" aria-hidden="true" />
      {label && <span className="app-spinner__label">{label}</span>}
    </span>
  );
}
