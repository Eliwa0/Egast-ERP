import React, { useEffect, useState } from 'react';
import API from '../services/api';
import { useI18n } from '../contexts/I18nContext';

export default function ProductionPalletTypesPanel() {
  const { lang } = useI18n(); const ar = lang === 'ar';
  const [rows, setRows] = useState([]); const [name, setName] = useState('');
  const [weight, setWeight] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { const { data } = await API.get('/production/pallet-types/', { params: { all: 1 } }); setRows(data.types); };
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await API.post('/production/pallet-types/', { name, capacity_kg: weight }); await load(); setName(''); setWeight(''); }
    catch (err) { setError(err.response?.data?.error || err.message); } finally { setBusy(false); }
  };
  const toggle = async (row) => {
    setBusy(true); setError('');
    try { await API.patch('/production/pallet-types/', { id: row.id, is_active: !row.is_active }); await load(); }
    catch (err) { setError(err.response?.data?.error || err.message); } finally { setBusy(false); }
  };
  return <div className="rules-tab-layout" dir={ar ? 'rtl' : 'ltr'}>
    <section className="card-panel rules-sidebar">
      <h2 className="rules-sidebar__title">{ar ? 'أنواع البالتات المسجلة' : 'Configured pallet types'}</h2>
      {!rows.length && <p className="rules-sidebar__empty">{ar ? 'لم تُضف أنواع بالتات بعد.' : 'No pallet types configured yet.'}</p>}
      <div className="rules-sidebar__list">{rows.map((row) => <div className="field-rule-editor" key={row.id}>
        <strong className="field-rule-editor__title"><bdi>{row.name}</bdi></strong>
        <p><bdi>{Number(row.capacity_kg).toLocaleString()} kg</bdi> · {row.is_active ? (ar ? 'نشط' : 'Active') : (ar ? 'غير نشط' : 'Inactive')}</p>
        <button className="app-button app-button--secondary" disabled={busy} onClick={() => toggle(row)}>{row.is_active ? (ar ? 'تعطيل' : 'Deactivate') : (ar ? 'تفعيل' : 'Activate')}</button>
      </div>)}</div>
    </section>
    <section className="card-panel rules-panel">
    <div className="rules-panel__info-box"><span className="rules-panel__info-icon">📦</span><div><div className="rules-panel__info-title">{ar ? 'أنواع البالتات وحدود الوزن' : 'Pallet types and weight limits'}</div>
    <div className="rules-panel__info-sub">{ar ? 'الحد الأقصى لوزن المنتج بالكيلو، والنواقص مسموحة.' : 'Maximum product weight in kg; partial pallets are allowed.'}</div></div></div>
    {error && <p role="alert" className="feedback-message feedback-message--error">{error}</p>}
    <form onSubmit={save}>
      <label className="form-field rules-panel__form-mb"><span className="form-label">{ar ? 'اسم النوع' : 'Type name'}</span><input className="app-input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="form-field rules-panel__form-mb"><span className="form-label">{ar ? 'الوزن الأقصى (كجم)' : 'Maximum weight (kg)'}</span><input className="app-input" dir="ltr" type="number" min="0.001" step="0.001" required value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
      <button className="app-button app-button--primary rules-save-btn" disabled={busy}>{ar ? 'إضافة نوع بالتة' : 'Add pallet type'}</button>
    </form>
  </section></div>;
}
