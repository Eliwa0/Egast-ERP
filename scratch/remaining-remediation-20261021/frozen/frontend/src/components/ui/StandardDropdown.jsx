import React, { useId } from 'react';
import { Checkbox, FormControl, FormHelperText, InputLabel, MenuItem, Select } from '@mui/material';
import { useI18n } from '../../contexts/I18nContext';
import { optionsFromChildren, optionsFromProp } from './selectOptions';
import './SearchableSelect.css';

// Finite choices. Preserve both existing contracts: options => value, children => event.
export default function StandardDropdown({ id, name, label, options: supplied, children, value, onChange,
  disabled = false, required = false, loading = false, allowClear = true, placeholder, helperText,
  error, multiple = false, className = '', fullWidth = true, dense = false, size = 'small',
  'aria-label': ariaLabel, ...rest }) {
  const { t, lang } = useI18n();
  const generated = useId();
  const controlId = id || `dropdown-${generated}`;
  const options = Array.isArray(supplied) ? optionsFromProp(supplied) : optionsFromChildren(children);
  const change = (event) => onChange?.(Array.isArray(supplied) ? event.target.value : event, event);
  const message = helperText || (loading ? t('common.loading') : options.length === 0 ? t('common.noOptions') : '');
  if (multiple) {
    return <FormControl size={size === 'medium' ? 'medium' : 'small'} fullWidth={fullWidth} disabled={disabled} error={Boolean(error)} className={`standard-dropdown-multiple ${String(className).split(/\s+/).filter((entry) => entry !== 'app-select' && entry !== 'app-input').join(' ')}`}>
      {label && <InputLabel id={`${controlId}-label`}>{label}</InputLabel>}
      <Select {...rest} id={controlId} name={name} labelId={label ? `${controlId}-label` : undefined} label={label}
        multiple displayEmpty={!label} value={(Array.isArray(value) ? value : []).map(String)} onChange={change}
        inputProps={{ 'aria-label': ariaLabel || label || placeholder }}
        renderValue={(codes) => codes.length ? codes.map((code) => options.find((option) => option.value === code)?.label || code).join(', ') : placeholder || t('common.selectOption')}
        MenuProps={{ slotProps: { paper: { className: 'searchable-select__paper', dir: lang === 'ar' ? 'rtl' : 'ltr' } } }}>
        {options.map((option) => <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
          <Checkbox checked={(value || []).map(String).includes(option.value)} size="small" />{option.label}
        </MenuItem>)}
      </Select>
      {message && <FormHelperText>{message}</FormHelperText>}
    </FormControl>;
  }
  const selected = String(value ?? '');
  return <div className={`standard-dropdown${dense ? ' standard-dropdown--dense' : ''}`} style={fullWidth ? { width: '100%', minWidth: 0 } : undefined}>
    {label && <label className="form-label" htmlFor={controlId}>{label}</label>}
    <select {...rest} id={controlId} name={name} className={`app-select ${className}`} value={selected}
      disabled={disabled} required={required} onChange={change} aria-label={ariaLabel || label || placeholder}
      aria-invalid={Boolean(error)} aria-describedby={message ? `${controlId}-help` : undefined}>
      {!options.some((option) => option.value === '') && (allowClear || !selected) && <option value="" disabled={!allowClear}>{placeholder || t('common.selectOption')}</option>}
      {selected && !options.some((option) => option.value === selected) && <option value={selected} disabled>{selected}</option>}
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    {message && <small id={`${controlId}-help`}>{message}</small>}
  </div>;
}
