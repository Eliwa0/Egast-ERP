import React from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import ShippingManifestSummary from '../../../components/ShippingManifestSummary';
import '../../../styles/pages/shipping-loading.css';

export default function ShippingSecondWeight({ draft, weight, canRecord, busy, onSubmit, onRefresh, completed = false }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const manifest = draft.shipping_manifest;
  const ready = manifest.status === 'READY';
  const net = Number(weight) - Number(draft.net_weight_empty ?? draft.weight_empty) - Number(manifest.deduction_weight);
  return <div className="shipping-loading">
    <ShippingManifestSummary manifest={manifest} />
    {completed ? <>
      <div className="shipping-success" role="status">{ar ? 'تم اعتماد الوزن الصافي. العملية ظهرت عند موظف الدليفري.' : 'Net weight certified. Shipment is available to the delivery operator.'}</div>
      <button onClick={() => window.print()}>{ar ? 'طباعة كارتة الميزان' : 'Print scale ticket'}</button>
    </> : <>
      {!ready && <p role="status">{ar ? 'بانتظار إرسال بيان التحميل من الشحن. لا يمكن تسجيل الوزنة الثانية الآن.' : 'Waiting for Shipping to submit the manifest. Second weight is blocked.'}</p>}
      {ready && <p>{ar ? 'الصافي المتوقع من القراءة الحالية' : 'Net preview from current reading'}: <strong>{net.toFixed(2)} kg</strong></p>}
      <div className="shipping-actions">
        <button disabled={busy} onClick={onRefresh}>{ar ? 'تحديث بيان الشحن' : 'Refresh shipping manifest'}</button>
        <button className="shipping-primary" disabled={busy || !ready || !canRecord || !Number.isFinite(net) || net <= 0} onClick={() => onSubmit({ weight, elements: [], allocations: [] })}>{ar ? 'اعتماد الوزنة الثانية وإرسال للدليفري' : 'Certify second weight and hand off to delivery'}</button>
      </div>
    </>}
  </div>;
}
