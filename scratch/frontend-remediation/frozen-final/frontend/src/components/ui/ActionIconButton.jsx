import React from 'react';
import { useI18n } from '../../contexts/I18nContext';

/**
 * Shared ActionIconButton component adhering to the Golden Reference:
 * - 32px x 32px icon-only button
 * - 6px border-radius
 * - Standard secondary border and background
 * - Accessible title and aria-label
 */
export function ActionIconButton({
  icon,
  label,
  title,
  ariaLabel,
  tone = 'neutral',
  onClick,
  disabled = false,
  className = '',
  style,
  type = 'button',
  ...rest
}) {
  const tooltip = title || label || '';
  const accessibleText = ariaLabel || label || title || '';
  const toneClass = tone ? `app-action-icon-btn--${tone}` : '';
  const combinedClass = `app-button app-button--secondary app-action-icon-btn ${toneClass} ${className}`.trim();

  return (
    <button
      type={type}
      className={combinedClass}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={accessibleText}
      style={style}
      {...rest}
    >
      <span aria-hidden="true" style={{ fontSize: 'var(--action-icon-size, 0.95rem)', lineHeight: 1 }}>
        {icon}
      </span>
    </button>
  );
}

/**
 * Dedicated ViewActionButton with Golden Reference styling:
 * - Eye icon 👁
 * - Default tooltip and aria-label: "عرض" (or localized "View" in EN)
 */
export function ViewActionButton({
  icon = "👁",
  onClick,
  disabled = false,
  title,
  ariaLabel,
  className = '',
  style,
  ...rest
}) {
  const { lang } = useI18n();
  const defaultLabel = lang === 'ar' ? 'عرض' : 'View';
  const finalLabel = title || defaultLabel;

  return (
    <ActionIconButton
      icon={icon}
      label={finalLabel}
      title={finalLabel}
      ariaLabel={ariaLabel || finalLabel}
      tone="view"
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={style}
      {...rest}
    />
  );
}

/**
 * Dedicated PrintActionButton with Golden Reference styling:
 * - Printer icon 🖨
 * - Default tooltip and aria-label: "طباعة" (or localized "Print" in EN)
 */
export function PrintActionButton({
  icon = "🖨",
  onClick,
  disabled = false,
  title,
  ariaLabel,
  className = '',
  style,
  ...rest
}) {
  const { lang } = useI18n();
  const defaultLabel = lang === 'ar' ? 'طباعة' : 'Print';
  const finalLabel = title || defaultLabel;

  return (
    <ActionIconButton
      icon={icon}
      label={finalLabel}
      title={finalLabel}
      ariaLabel={ariaLabel || finalLabel}
      tone="print"
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={style}
      {...rest}
    />
  );
}

export default ActionIconButton;
