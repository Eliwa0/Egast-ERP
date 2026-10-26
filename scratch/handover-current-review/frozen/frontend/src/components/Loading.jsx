import React from 'react';
import AppSpinner from './ui/AppSpinner';

/**
 * Loading: Backward-compatible adapter delegating to unified AppSpinner.
 */
function Loading({ size = 'medium', label, ...props }) {
  const sizeMap = {
    small: 'sm',
    medium: 'md',
    large: 'lg',
    xs: 'xs',
    sm: 'sm',
    md: 'md',
    lg: 'lg',
  };
  const normalizedSize = sizeMap[size] || 'md';

  return <AppSpinner size={normalizedSize} label={label} {...props} />;
}

export default Loading;
