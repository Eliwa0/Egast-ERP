import React from 'react';
import { useI18n } from '../contexts/I18nContext';

export default function ShippingManifestSummary({ manifest, commercial = false }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  if (!manifest) return null;
  return <section className="shipping-ticket">
    <h3>{ar ? 'بيان تحميل الحاوية' : 'Container loading manifest'} #{manifest.id}</h3>
    <p>{ar ? 'العربية / الحاوية' : 'Truck / Container'}: <strong>{manifest.vehicle_number} / {manifest.container_number}</strong></p>
    <p>{ar ? 'تذكرة الميزان' : 'Scale ticket'}: {manifest.ticket_number}</p>
    {commercial && <p>{ar ? 'العميل / الأوردر' : 'Customer / Order'}: {manifest.order?.customer_name} / #{manifest.order?.doc_num}</p>}
    <p><strong>{manifest.pallet_count} {ar ? 'بالتة' : 'pallets'} · {manifest.box_count} {ar ? 'صندوق' : 'boxes'}</strong></p>
    {manifest.pallets.map((p, index) => <div className="shipping-ticket" key={p.batch_number || index}>
      <strong>{index + 1}. {p.item_name || p.item_code}</strong>
      {commercial && <p>{ar ? 'نوع بالتة الإنتاج' : 'Production pallet type'}: {p.without_pallet ? (ar ? 'بدون بالتات' : 'No pallets') : p.production_pallet_type_name || '—'}</p>}
      <p>{p.pallet_count} × {p.pallet_type} ({p.pallet_unit_weight} kg) · {p.box_count} × {p.box_type} ({p.box_unit_weight} kg)</p>
      <span>{ar ? 'وزن الخصم' : 'Packaging deduction'}: {p.deduction_weight} kg</span>
      {commercial && <p>{p.batch_number} — {p.quantity} {p.uom} — {p.source_warehouse} / {p.bin_code}</p>}
    </div>)}
    <p>{ar ? 'الفارغ' : 'Empty'}: {manifest.first_weight} kg · {ar ? 'خصومات التغليف' : 'Packaging deductions'}: {manifest.deduction_weight} kg</p>
    {manifest.gross_weight && <p>{ar ? 'القائم' : 'Gross'}: {manifest.gross_weight} kg</p>}
    {manifest.net_weight && <p><strong>{ar ? 'صافي الحاوية الإجمالي' : 'Total container net weight'}: {manifest.net_weight} kg</strong></p>}
  </section>;
}
