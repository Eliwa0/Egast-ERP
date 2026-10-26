import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import { useI18n } from '../../contexts/I18nContext';
import './SearchableSelect.css';
import useRemoteOptions from '../../hooks/useRemoteOptions';
import { optionsFromChildren, optionsFromProp } from './selectOptions';

function SelectChevron(props) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function renderBidiLabel(label) {
  if (!label || typeof label !== 'string') return label;
  const match = label.match(/^([A-Za-z0-9_./-]+(?:\s*\([^)]*\))?)(\s+-\s+)(.*)$/);
  if (match) {
    const [, code, sep, rest] = match;
    return (
      <span className="searchable-select__label-wrap">
        <bdi dir="ltr" className="searchable-select__code-bdi">{code}</bdi>
        <span className="searchable-select__sep" aria-hidden="true">{sep}</span>
        <bdi className="searchable-select__desc-bdi">{rest}</bdi>
      </span>
    );
  }
  return <bdi className="searchable-select__plain-bdi">{label}</bdi>;
}

function DropdownSearchPaper({ children, searchValue, onSearchChange, searchPlaceholder, searchDirection, onSearchBlur, onSearchKeyDown, ...props }) {
  return <Paper {...props}>
    <div className="searchable-select__dropdown-search" dir={searchDirection} onMouseDown={event => event.stopPropagation()}>
      <TextField fullWidth size="small" autoFocus type="search" value={searchValue}
        placeholder={searchPlaceholder} onChange={event => onSearchChange(event.target.value)} onBlur={onSearchBlur} onKeyDown={onSearchKeyDown}
        slotProps={{ htmlInput: { 'aria-label': searchPlaceholder } }} />
    </div>
    {children}
  </Paper>;
}

function SearchableSelect({
  id,
  name,
  label,
  options: optionsProp,
  placeholder,
  value,
  onChange,
  children,
  className = '',
  dense = false,
  disabled = false,
  required = false,
  loading = false,
  allowClear = true,
  noOptionsText,
  openOnFocus = true,
  autoFocus = false,
  onFocus,
  fullWidth = true,
  helperText,
  'aria-label': ariaLabel,
  error,
  multiple = false,
  searchSource,
  onSearchResults,
  onSelectOption,
  selectedOptions = [],
  selectedLabel,
  onOpen,
  onClose,
  searchInDropdown = false,
  ...rest
}) {
  const { t, lang } = useI18n();
  const selectionContext = JSON.stringify([searchSource?.endpoint, searchSource?.params]);
  const [search, setSearch] = useState({ context: selectionContext, input: '' });
  const searchInput = search.context === selectionContext ? search.input : '';
  const setSearchInput = (input) => setSearch({ context: selectionContext, input });
  const [open, setOpen] = useState(false);
  const remote = useRemoteOptions(searchSource, searchInput, { enabled: !disabled && (open || !searchSource?.browse) });
  const resultsCallback = useRef(onSearchResults);
  const [remembered, setRemembered] = useState({ context: '', options: new Map() });
  useEffect(() => { resultsCallback.current = onSearchResults; }, [onSearchResults]);
  const isRemote = Boolean(searchSource);
  useEffect(() => {
    if (isRemote && !remote.loading && !remote.error) resultsCallback.current?.(remote.rows);
  }, [isRemote, remote.rows, remote.loading, remote.error]);
  const isRtl = lang === 'ar' || (typeof document !== 'undefined' && document.documentElement.dir === 'rtl');
  const popperPlacement = isRtl ? 'bottom-end' : 'bottom-start';

  const popperModifiers = useMemo(() => [
    {
      name: 'sameMinWidth',
      enabled: true,
      phase: 'beforeWrite',
      requires: ['computeStyles'],
      fn: ({ state }) => {
        const refWidth = state.rects?.reference?.width || 0;
        if (refWidth) {
          const viewportMax = typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 32) : 560;
          const hardMax = Math.min(560, viewportMax);
          const safeMinWidth = Math.min(refWidth, hardMax);
          state.styles.popper.minWidth = `${safeMinWidth}px`;
        }
      },
      effect: ({ state }) => {
        const refWidth = state.elements?.reference?.offsetWidth || 0;
        if (refWidth) {
          const viewportMax = typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 32) : 560;
          const hardMax = Math.min(560, viewportMax);
          const safeMinWidth = Math.min(refWidth, hardMax);
          state.elements.popper.style.minWidth = `${safeMinWidth}px`;
        }
      },
    },
    {
      name: 'preventOverflow',
      options: {
        padding: 16,
        altAxis: false,
      },
    },
  ], []);

  const generatedId = useId();
  const mainInput = useRef(null);
  const selectId = id || (label ? `searchable-select-${generatedId}` : undefined);
  const usesOptionsProp = Array.isArray(optionsProp);
  const stringValue = String(value ?? '');

  const options = useMemo(() => {
    if (searchSource) {
      const rows = remote.rows.map(searchSource.mapOption);
      // Existing policy-filtered local choices can be shown while the initial page loads.
      const initial = searchSource.browse && !searchInput.trim() && remote.loading
        ? (usesOptionsProp ? optionsFromProp(optionsProp) : optionsFromChildren(children)).filter((option) => option.value).slice(0, 25)
        : [];
      return optionsFromProp([...new Map([...rows, ...initial].map((option) => [String(option.value), option])).values()]);
    }
    return usesOptionsProp ? optionsFromProp(optionsProp) : optionsFromChildren(children);
  }, [children, optionsProp, usesOptionsProp, searchSource, remote.rows, remote.loading, searchInput]);

  const selectionOptions = searchSource ? optionsFromProp([
    ...options,
    ...(remembered.context === selectionContext ? remembered.options.values() : []), ...selectedOptions,
    ...(usesOptionsProp ? optionsProp : optionsFromChildren(children)),
  ]) : options;

  const selectedOption = multiple
    ? (Array.isArray(value) ? value : []).map(String).map((code) => selectionOptions.find((option) => option.value === code)
      || (searchSource ? { value: code, label: code } : null)).filter(Boolean)
    : (stringValue ? (selectionOptions.find((option) => option.value === stringValue)
      || (searchSource ? { value: stringValue, label: selectedLabel || stringValue } : null)) : null);
  const renderedPlaceholder = placeholder || (options[0]?.value === '' ? options[0].label : t('common.selectOption'));
  const listboxId = selectId ? `${selectId}-listbox` : undefined;

  const emitChange = (nextValue, sourceEvent) => {
    if (searchSource) {
      const codes = multiple ? nextValue : [nextValue];
      setRemembered((previous) => {
        const saved = new Map(previous.context === selectionContext ? previous.options : []);
        codes.forEach((code) => {
          const option = options.find((row) => row.value === String(code));
          if (option) saved.set(String(code), option);
        });
        return { context: selectionContext, options: saved };
      });
    }
    if (!onChange) return;
    if (usesOptionsProp) {
      onChange(nextValue, sourceEvent);
      return;
    }
    const event = {
      target: { value: nextValue, name, id: selectId },
      currentTarget: { value: nextValue, name, id: selectId },
    };
    onChange(event);
  };

  const rawClasses = String(className || '').split(/\s+/).filter(Boolean);
  const hasError = Boolean(error) || rawClasses.some((c) => c === 'app-input--error' || c === 'app-input--invalid' || c === 'error');
  const safeClasses = rawClasses.filter((c) => c !== 'app-input' && c !== 'app-select');

  const rootClass = [
    'searchable-select',
    dense ? 'searchable-select--dense' : '',
    hasError ? 'searchable-select--error' : '',
    ...safeClasses,
  ]
    .filter(Boolean)
    .join(' ');

  const isFieldLoading = Boolean(searchSource ? (remote.loading || remote.loadingMore) : loading);

  return (
    <Autocomplete
      id={selectId}
      className={rootClass}
      fullWidth={fullWidth}
      value={selectedOption}
      multiple={multiple}
      options={options}
      open={open}
      inputValue={searchInDropdown ? (open ? searchInput : multiple ? '' : selectedOption?.label || '') : undefined}
      clearOnBlur={searchInDropdown ? false : undefined}
      onOpen={(event) => { if (searchInDropdown) setSearchInput(''); setOpen(true); onOpen?.(event); }}
      onClose={(event, reason) => {
        if (searchInDropdown && reason === 'blur' && event?.relatedTarget?.closest?.('.searchable-select__dropdown-search')) return;
        setOpen(false); onClose?.(event, reason);
      }}
      openOnFocus={openOnFocus}
      loading={isFieldLoading}
      loadingText={t('common.loading')}
      disabled={disabled}
      popupIcon={<SelectChevron className="searchable-select__chevron" />}
      isOptionEqualToValue={(option, candidate) => option.value === candidate.value}
      getOptionLabel={(option) => option?.label ?? ''}
      getOptionDisabled={(option) => Boolean(option.disabled)}
      filterOptions={(filteredOptions, state) => {
        if (searchSource) return filteredOptions;
        const search = (state.inputValue || '').trim().toLocaleLowerCase();
        if (!search) return filteredOptions;
        return filteredOptions.filter((option) => (
          String(option.value ?? '').toLocaleLowerCase().includes(search)
          || String(option.label ?? '').toLocaleLowerCase().includes(search)
          || String(option.searchText ?? '').toLocaleLowerCase().includes(search)
        ));
      }}
      autoHighlight
      noOptionsText={searchSource && remote.error ? <>{t('searchControl.failed')} <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(true); remote.retry(); }}>{t('searchControl.retry')}</button></>
        : searchSource && !searchSource.browse && searchInput.trim().length < 1 ? t('searchControl.minimum')
          : noOptionsText || t('common.noOptions')}
      disableClearable={!allowClear}
      slots={searchInDropdown ? { paper: DropdownSearchPaper } : undefined}
      slotProps={{
        popper: {
          className: 'searchable-select__popper',
          placement: popperPlacement,
          modifiers: popperModifiers,
          style: {
            width: 'max-content',
            maxWidth: 'min(560px, calc(100vw - 32px))',
            boxSizing: 'border-box',
          },
        },
        paper: { className: 'searchable-select__paper', ...(searchInDropdown ? {
          searchValue: searchInput, onSearchChange: setSearchInput,
          searchPlaceholder: t('searchControl.searchWarehouses'), searchDirection: isRtl ? 'rtl' : 'ltr',
          onSearchBlur: (event) => {
            if (event.relatedTarget?.closest?.('.searchable-select__paper, .searchable-select')) return;
            setOpen(false); onClose?.(event, 'blur');
          },
          onSearchKeyDown: (event) => {
            if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) || event.nativeEvent?.isComposing) return;
            // The popup is outside MUI's root. Reuse its keyboard handler for options.
            const input = mainInput.current;
            if (!input) return;
            event.preventDefault();
            input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', {
              key: event.key, bubbles: true, cancelable: true,
              altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
            }));
          },
        } : {}) },
        listbox: { className: 'searchable-select__listbox', id: listboxId,
          onScroll: (event) => {
            const list = event.currentTarget;
            if (list.scrollHeight - list.scrollTop - list.clientHeight < 48 && !remote.error) remote.loadMore();
          } },
      }}
      renderOption={(optionProps, option) => {
        const { key, className: muiOptionClass, ...otherOptionProps } = optionProps;
        const isSelected = multiple
          ? selectedOption.some((selected) => selected.value === option.value)
          : selectedOption?.value === option.value;
        const optionClasses = [
          'searchable-select__option',
          muiOptionClass,
          isSelected ? 'searchable-select__option--selected' : '',
        ].filter(Boolean).join(' ');

        return (
          <li key={key} {...otherOptionProps} className={optionClasses} title={option.label}>
            {renderBidiLabel(option.label)}
          </li>
        );
      }}
      onInputChange={(_event, input, reason) => { if (reason === 'input' || reason === 'clear') setSearchInput(input); }}
      onChange={(_event, selected) => {
        onSelectOption?.(selected);
        emitChange(multiple ? (selected || []).map((option) => option.value) : (selected?.value ?? ''), _event);
      }}
      renderValue={multiple ? (selected) => (
        <span className="searchable-select__multi-value" title={selected.map((option) => option.label).join(', ')}>
          {searchInDropdown ? selected.map((option, index) => (
            <React.Fragment key={option.value}>
              {index > 0 && ', '}{renderBidiLabel(option.label)}
            </React.Fragment>
          )) : selected.map((option) => option.label).join(', ')}
        </span>
      ) : undefined}
      renderInput={(params) => {
        const { InputProps: paramsInputProps, ...otherParams } = params;
        const endAdornment = (
          <>
            {isFieldLoading ? (
              <CircularProgress color="inherit" size={18} style={{ marginInlineEnd: 4 }} />
            ) : null}
            {paramsInputProps?.endAdornment}
          </>
        );
        return (
          <TextField
            {...otherParams}
            name={name}
            label={label}
            placeholder={searchInDropdown && multiple && selectedOption.length ? '' : isFieldLoading ? t('common.loading') : renderedPlaceholder}
            size="small"
            fullWidth={fullWidth}
            helperText={searchSource && remote.error ? <>{t('searchControl.failed')} <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(true); remote.retry(); }}>{t('searchControl.retry')}</button></>
              : isFieldLoading ? t('common.loading') : helperText}
            required={required}
            disabled={disabled}
            error={hasError || Boolean(searchSource && remote.error)}
            autoFocus={autoFocus}
            slotProps={{
              ...params.slotProps,
              input: {
                ...paramsInputProps,
                ...params.slotProps?.input,
                endAdornment,
              },
              htmlInput: {
                ...params.slotProps?.htmlInput,
                'aria-label': ariaLabel,
                ref: (node) => {
                  mainInput.current = node;
                  const inputRef = params.slotProps?.htmlInput?.ref;
                  if (typeof inputRef === 'function') inputRef(node);
                  else if (inputRef) inputRef.current = node;
                },
                onFocus: (event) => {
                  params.slotProps?.htmlInput?.onFocus?.(event);
                  onFocus?.(event);
                },
              },
            }}
          />
        );
      }}
      {...rest}
    />
  );
}

export default SearchableSelect;
