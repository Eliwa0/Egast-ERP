// Browser-test entry only. It is never imported by the production application.
import React, { useState } from 'react';
import TextField from '@mui/material/TextField';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../src/contexts/AuthContext';
import { I18nProvider } from '../../src/contexts/I18nContext';
import StandardDropdown from '../../src/components/ui/StandardDropdown';
import SearchableSelect from '../../src/components/ui/SearchableSelect';
import RemoteAutocomplete from '../../src/components/ui/RemoteAutocomplete';
import { warehouseSearch, userSearch, customerSearch, binSearch, itemSearch } from '../../src/services/masterDataSearch';
import '../../src/styles/selects.css';
import '../../src/styles/global.css';
import '../../src/styles/design-system.css';

export function Harness() {
  const [values, setValues] = useState({ stage: 'S1', roles: ['transfer'], warehouse: '', bin: '', user: '', customer: '', item: null, location: 'L1', general: 'G1' });
  const set = (field, value) => setValues((previous) => ({ ...previous, [field]: value, ...(field === 'warehouse' ? { bin: '' } : {}) }));
  return <main style={{ width: '100%', maxWidth: 600, minWidth: 0, boxSizing: 'border-box', padding: 16, display: 'grid', gap: 16, color: 'var(--text-primary)' }}>
    <SearchableSelect label="Saved warehouse" options={[]} searchSource={warehouseSearch} value="SAVED" selectedLabel="Saved warehouse label" disabled />
    <StandardDropdown label="Stage" allowClear={false} value={values.stage} onChange={(event) => set('stage', event.target.value)}>
      <option value="S1">Stage 1</option><option value="S2">Stage 2</option><option value="S3">Stage 3</option>
    </StandardDropdown>
    <StandardDropdown label="Roles" multiple options={[{ value: 'transfer', label: 'Transfer' }, { value: 'quality', label: 'Quality' }]} value={values.roles} onChange={(value) => set('roles', value)} />
    <SearchableSelect label="Warehouse" options={[]} searchSource={warehouseSearch} value={values.warehouse} onChange={(value) => set('warehouse', value)} />
    <SearchableSelect label="Bin" options={[]} searchSource={binSearch(values.warehouse, { valueKey: 'absEntry', physicalOnly: true })} value={values.bin} disabled={!values.warehouse} onChange={(value) => set('bin', value)} />
    <SearchableSelect label="User" options={[]} searchSource={{ ...userSearch, params: { module: 'transfer', level: 'USER' } }} value={values.user} onChange={(value) => set('user', value)} />
    <SearchableSelect label="Customer" options={[]} searchSource={customerSearch} value={values.customer} onChange={(value) => set('customer', value)} />
    <RemoteAutocomplete searchSource={itemSearch} value={values.item} renderInput={(params) => <TextField {...params} label="Item" />} getOptionLabel={(row) => row.item_name || ''} isOptionEqualToValue={(a, b) => a.item_code === b.item_code} onChange={(_, value) => set('item', value)} />
    <SearchableSelect label="Location" options={[{ value: 'L1', label: 'Location One' }, { value: 'L2', label: 'Location Two' }]} value={values.location} onChange={(value) => set('location', value)} />
    <SearchableSelect label="General" options={[{ value: 'G1', label: 'General One' }, { value: 'G2', label: 'General Two' }]} value={values.general} onChange={(value) => set('general', value)} />
    <output style={{ minWidth: 0, overflowWrap: 'anywhere' }} data-testid="values">{JSON.stringify(values)}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<AuthProvider><I18nProvider><Harness /></I18nProvider></AuthProvider>);
