import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { shippingGet, shippingPost } from '../services/shippingService';
import ShippingManifestSummary from './ShippingManifestSummary';
import '../styles/pages/shipping-loading.css';

export default function ShippingDeliveryHandoff() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { const data = await shippingGet('deliveries/'); setRows(data.operations); setNextOffset(data.next_offset); }
    catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (busy || rows.length > 50) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const data = await shippingGet('deliveries/');
        if (active) { setRows(data.operations); setNextOffset(data.next_offset); }
      } catch { /* Manual refresh reports connection errors. */ }
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, rows.length]);
  const create = async (op) => {
    setBusy(true); setError('');
    try {
      const result = await shippingPost(`operations/${op.id}/delivery/`);
      navigate(`/customization-delivery/deliveries/new/${result.sales_order_doc_entry}?draft_id=${result.delivery_id}`);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };
  const more = async () => {
    setBusy(true); setError('');
    try { const data = await shippingGet('deliveries/', { offset: nextOffset }); setRows((prev) => [...prev, ...data.operations]); setNextOffset(data.next_offset); }
    catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };
  return <section className="shipping-loading">
    <div className="shipping-actions"><h2>{ar ? 'شحنات اعتمدها الباسكول' : 'Scale-certified shipments'}</h2><button disabled={busy} onClick={refresh}>{ar ? 'تحديث' : 'Refresh'}</button></div>
    {error && <p className="shipping-error" role="alert">{error}</p>}
    {!rows.length && !busy && <p>{ar ? 'الشحنات تظهر هنا بعد اعتماد الوزنة الثانية.' : 'Shipments appear here after the second weight is certified.'}</p>}
    <div className="shipping-cards">{rows.map((op) => <article className="shipping-ticket" key={op.id}>
      <h3>{op.vehicle_number} / {op.container_number}</h3>
      <p>{op.order?.customer_name} — #{op.order?.doc_num}</p>
      <p>{op.pallet_count} {ar ? 'بالتة' : 'pallets'} · {op.box_count} {ar ? 'صندوق' : 'boxes'}</p>
      <p>{ar ? 'صافي الحاوية' : 'Container net weight'}: <strong>{op.net_weight} kg</strong></p>
      <details><summary>{ar ? 'البيان والكارتة' : 'Manifest and weights'}</summary><ShippingManifestSummary manifest={op} commercial /></details>
      {op.delivery_sap_doc_num ? <p>{ar ? 'تم الترحيل' : 'Posted'}: #{op.delivery_sap_doc_num}</p> : <button className="shipping-primary" disabled={busy} onClick={() => create(op)}>{op.delivery_id ? (ar ? 'فتح مسودة الدليفري' : 'Open delivery draft') : (ar ? 'إنشاء الدليفري من البيان' : 'Create delivery from manifest')}</button>}
    </article>)}</div>
    {nextOffset !== null && <button disabled={busy} onClick={more}>{ar ? 'المزيد' : 'More'}</button>}
  </section>;
}
