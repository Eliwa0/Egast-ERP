import React from 'react';
import AppSpinner from './AppSpinner';

/**
 * AppButton: Accessible, double-submit-proof button with built-in loading state.
 *
 * @param {boolean} loading - Whether an async operation is currently in progress
 * @param {string} loadingText - Text to display during loading (e.g. "جاري الحفظ...", "Posting to SAP...")
 * @param {boolean} disabled - Standard disabled state
 * @param {React.ReactNode} icon - Optional icon shown before text when not loading
 * @param {'primary'|'secondary'|'success'|'danger'|'ghost'} variant - Button style variant
 * @param {string} className - Additional CSS classes
 * @param {function} onClick - Click handler (prevented while loading)
 */
export default function AppButton({
  children,
  loading = false,
  loadingText,
  disabled = false,
  icon,
  variant = 'primary',
  className = '',
  type = 'button',
  onClick,
  ...props
}) {
  const isDisabled = disabled || loading;

  const handleClick = (e) => {
    if (isDisabled) {
      e.preventDefault();
      return;
    }
    if (onClick) {
      onClick(e);
    }
  };

  const variantClass = variant ? `app-button--${variant}` : '';

  return (
    <button
      type={type}
      className={`app-button ${variantClass} ${loading ? 'app-button--loading' : ''} ${className}`}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : 'false'}
      onClick={handleClick}
      {...props}
    >
      {loading ? (
        <>
          <AppSpinner size="sm" />
          <span>{loadingText || children}</span>
        </>
      ) : (
        <>
          {icon && <span className="app-button__icon">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}
