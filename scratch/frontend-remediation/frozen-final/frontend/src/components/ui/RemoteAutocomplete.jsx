import { cloneElement, useEffect, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import useRemoteOptions from '../../hooks/useRemoteOptions';
import { useI18n } from '../../contexts/I18nContext';
import './SearchableSelect.css';

// Object-valued adapter for existing MUI workflows, including free-text entry.
export default function RemoteAutocomplete({ searchSource, onResults, onInputChange, renderInput, disabled, onOpen, onClose, ...props }) {
  const { t, lang } = useI18n();
  const searchContext = JSON.stringify([searchSource?.endpoint, searchSource?.params]);
  const [search, setSearch] = useState({ context: searchContext, input: '' });
  const input = search.context === searchContext ? search.input : '';
  const setInput = (text) => setSearch({ context: searchContext, input: text });
  const [open, setOpen] = useState(false);
  const remote = useRemoteOptions(searchSource, input, { enabled: !disabled && (open || !searchSource?.browse) });
  const callback = useRef(onResults);
  useEffect(() => { callback.current = onResults; }, [onResults]);
  useEffect(() => { if (!remote.loading && !remote.error) callback.current?.(remote.rows); }, [remote.rows, remote.loading, remote.error]);
  return <Autocomplete {...props} disabled={disabled}
    className={`searchable-select ${props.className || ''}`}
    slotProps={{ ...props.slotProps,
      popper: { ...props.slotProps?.popper, placement: lang === 'ar' ? 'bottom-end' : 'bottom-start',
        className: 'searchable-select__popper', dir: lang === 'ar' ? 'rtl' : 'ltr' },
      paper: { ...props.slotProps?.paper, className: 'searchable-select__paper' },
      listbox: { ...props.slotProps?.listbox, className: 'searchable-select__listbox', onScroll: (event) => {
        props.slotProps?.listbox?.onScroll?.(event);
        const list = event.currentTarget;
        if (list.scrollHeight - list.scrollTop - list.clientHeight < 48 && !remote.error) remote.loadMore();
      } } }}
    open={open} onOpen={(event) => { setOpen(true); onOpen?.(event); }}
    onClose={(event, reason) => { setOpen(false); onClose?.(event, reason); }}
    options={remote.rows} loading={remote.loading} loadingText={t('common.loading')}
    filterOptions={(rows) => rows} openOnFocus autoHighlight
    noOptionsText={remote.error ? <>{t('searchControl.failed')} <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(true); remote.retry(); }}>{t('searchControl.retry')}</button></>
      : !searchSource?.browse && input.trim().length < 1 ? t('searchControl.minimum') : t('common.noOptions')}
    onInputChange={(event, text, reason) => {
      if (reason === 'input' || reason === 'clear') setInput(text);
      onInputChange?.(event, text, reason);
    }}
    renderInput={(params) => {
      const { InputProps: _removed, ...cleanParams } = params;
      const endAdornment = (
        <>
          {(remote.loading || remote.loadingMore) ? (
            <CircularProgress color="inherit" size={18} style={{ marginInlineEnd: 4 }} />
          ) : null}
          {params.slotProps?.input?.endAdornment || params.InputProps?.endAdornment}
        </>
      );
      const slotProps = {
        ...params.slotProps,
        input: {
          ...params.InputProps,
          ...params.slotProps?.input,
          endAdornment,
        },
      };
      const resolvedParams = {
        ...cleanParams,
        slotProps,
      };
      const field = renderInput ? renderInput(resolvedParams) : <TextField {...resolvedParams} size="small" placeholder={remote.loading ? t('common.loading') : undefined} />;
      if (!remote.error && !remote.loadingMore && !remote.loading) return field;
      return cloneElement(field, { error: remote.error,
        helperText: remote.error ? <>{t('searchControl.failed')} <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(true); remote.retry(); }}>{t('searchControl.retry')}</button></> : (remote.loading || remote.loadingMore) ? t('common.loading') : undefined });
    }} />;
}
