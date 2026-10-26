import React, { useEffect, useMemo, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import egastLogo from '../../../assets/logos/egast-logo.png';

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatInteger = (value, fallback = '-') => {
  const number = numberOrNull(value);
  return number === null
    ? fallback
    : Math.round(number).toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const firstValue = (...values) => values.find(
  (value) => value !== null && value !== undefined && value !== '',
);

function InfluencingElements({ title, elements }) {
  if (!elements.length) return null;

  return (
    <div className="label-elements-stage">
      <strong>{title}:</strong>
      {elements.map((element, index) => {
        const count = numberOrNull(element.count) ?? 0;
        const unitWeight = numberOrNull(element.unit_weight) ?? 0;
        const totalWeight = firstValue(
          numberOrNull(element.total_weight),
          Math.abs(count * unitWeight),
        );
        const sign = element.action === 'add' ? '+' : '-';
        const name = firstValue(
          element.name,
          element.item_element_name,
          element.item_element?.name,
          `عنصر ${index + 1}`,
        );

        return (
          <div className="label-element-line" key={element.id || `${title}-${index}`}>
            <b className={sign === '+' ? 'element-added' : 'element-removed'}>{sign}</b>{' '}
            {name} × {formatInteger(count, '0')} = {formatInteger(totalWeight, '0')} كجم
          </div>
        );
      })}
    </div>
  );
}

export function ScalePrintableTicket({ draft }) {
  const [qrCode, setQrCode] = useState('');

  const cardNumber = firstValue(draft?.id, draft?.draft_number, '-');
  const allocations = useMemo(
    () => draft?.batches || draft?.allocations || [],
    [draft?.allocations, draft?.batches],
  );
  const firstAllocation = allocations[0] || {};
  const rawElements = draft?.draft_elements || draft?.elements || [];
  const elements = rawElements.filter((element) => (
    firstValue(element.name, element.item_element_name, element.item_element?.name)
    && (numberOrNull(element.count) ?? 0) > 0
  ));
  const loadedElements = elements.filter((element) => element.stage === 'loaded');
  const emptyElements = elements.filter((element) => element.stage === 'empty');
  const isOutbound = Boolean(draft?.shipping_manifest) || draft?.start_type === 'empty';
  const shippingElements = useMemo(() => {
    const grouped = new Map();
    for (const pallet of draft?.shipping_manifest?.pallets || []) {
      for (const [type, count] of [[pallet.pallet_type, pallet.pallet_count], [pallet.box_type, pallet.box_count]]) {
        if (!type || !(Number(count) > 0)) continue;
        grouped.set(type, (grouped.get(type) || 0) + Number(count));
      }
    }
    return [...grouped].map(([type, count]) => ({ type, count }));
  }, [draft?.shipping_manifest]);

  const vehicleNumber = firstValue(
    draft?.effective_vehicle_number,
    draft?.vehicle_number,
    draft?.vehicle?.vehicle_number,
    '-',
  );
  const driverName = firstValue(
    draft?.direct_driver_name,
    draft?.driver_name,
    draft?.vehicle?.driver_name,
    '-',
  );
  const shippingPallets = draft?.shipping_manifest?.pallets || [];
  const itemName = firstValue([...new Set(shippingPallets.map((p) => p.item_name || p.item_code).filter(Boolean))].join(' / '), draft?.item_name, draft?.item?.name, firstAllocation.item_name, '-');
  const itemCode = firstValue([...new Set(shippingPallets.map((p) => p.item_code).filter(Boolean))].join(' / '), draft?.item?.code, draft?.item_code, firstAllocation.item_code, '-');
  const supplier = firstValue(
    draft?.supplier,
    draft?.supplier_name,
    draft?.vendor_name,
    firstAllocation.vendor_name,
    '-',
  );

  useEffect(() => {
    let active = true;
    if (!draft) return undefined;

    const qrData = JSON.stringify({
      id: cardNumber,
      date: draft.created_at,
      vehicle: vehicleNumber,
      item: itemName,
      supplier,
      weight: draft.product_weight,
    });

    QRCode.toDataURL(qrData, { margin: 2, width: 256, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (active) setQrCode(url);
      })
      .catch(() => {
        if (active) setQrCode('');
      });

    return () => {
      active = false;
    };
  }, [cardNumber, draft, itemName, supplier, vehicleNumber]);

  const barcodeSvg = useMemo(() => {
    if (!draft || cardNumber === '-') return '';
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, String(cardNumber), {
        format: 'CODE128',
        displayValue: false,
        height: 38,
        margin: 6,
        width: 1.5,
      });
      const svgWidth = Number.parseFloat(svg.getAttribute('width'));
      const svgHeight = Number.parseFloat(svg.getAttribute('height'));
      if (Number.isFinite(svgWidth) && Number.isFinite(svgHeight)) {
        svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
      }
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      return svg.outerHTML;
    } catch {
      return '';
    }
  }, [cardNumber, draft]);

  if (!draft) return null;

  const totalBoxes = allocations.reduce((total, batch) => total + (
    numberOrNull(firstValue(
      batch.box_count,
      batch.boxes_count,
      batch.container_quantity,
      batch.package_count,
      batch.count,
    )) ?? 0
  ), 0);

  return (
    <div className="scale-print-ticket-container" dir="rtl">
      <style>{`
        .scale-print-ticket-container { display: none; }

        @media print {
          @page { margin: 0; size: A4 portrait; }

          html, body {
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          body * { visibility: hidden !important; }
          .scale-print-ticket-container,
          .scale-print-ticket-container * { visibility: visible !important; }

          .scale-print-ticket-container {
            display: block !important;
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            color: #000 !important;
            background: #fff !important;
            direction: rtl !important;
            font-family: 'Cairo', Arial, 'Segoe UI', sans-serif !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .final-weight-label {
            width: 210mm !important;
            min-height: 99mm !important;
            height: auto !important;
            box-sizing: border-box !important;
            padding: 6mm 5mm !important;
            overflow: visible !important;
            border: 1px solid #cbd5e1 !important;
            border-top: 3px solid #163a5f !important;
            background: #fff !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            font-size: 9px !important;
            line-height: 1.28 !important;
          }

          .label-header {
            display: grid !important;
            grid-template-columns: 18mm 1fr 18mm !important;
            align-items: center !important;
            min-height: 17mm !important;
            margin-bottom: 1.5mm !important;
            padding-bottom: 1.5mm !important;
            border-bottom: 1px solid #cbd5e1 !important;
          }

          .label-logo,
          .label-qr,
          .label-qr-placeholder {
            width: 16mm !important;
            height: 16mm !important;
            object-fit: contain !important;
            display: block !important;
          }

          .label-logo { justify-self: start !important; }
          .label-qr,
          .label-qr-placeholder { justify-self: end !important; }
          .label-qr-placeholder {
            box-sizing: border-box !important;
            border: 1px dashed #94a3b8 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            color: #555 !important;
            font-size: 7px !important;
          }

          .label-heading { text-align: center !important; }
          .label-company-name { color: #0f2942 !important; font-size: 14px !important; font-weight: 800 !important; }
          .label-title { margin-top: .5mm !important; color: #163a5f !important; font-size: 11px !important; font-weight: 900 !important; }
          .label-title-en { margin-top: .2mm !important; color: #64748b !important; font-size: 7px !important; font-weight: 800 !important; letter-spacing: .7px !important; direction: ltr !important; }
          .label-meta { margin-top: .45mm !important; color: #475569 !important; font-size: 8px !important; font-weight: 700 !important; }
          .label-scan-caption { margin-top: .3mm !important; color: #64748b !important; font-size: 6px !important; font-weight: 800 !important; text-align: center !important; direction: ltr !important; letter-spacing: .4px !important; }

          .label-information {
            display: grid !important;
            grid-template-columns: 1fr 1fr 1.25fr !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 2px !important;
            margin-bottom: 1.5mm !important;
          }

          .label-info-column {
            min-width: 0 !important;
            padding: 1.1mm 1.5mm !important;
            border-left: 1px solid #e2e8f0 !important;
          }
          .label-info-column:last-child { border-left: 0 !important; }
          .label-column-title { display: block !important; margin-bottom: .5mm !important; padding-bottom: .35mm !important; color: #163a5f !important; border-bottom: 1px solid #e2e8f0 !important; font-size: 9px !important; font-weight: 900 !important; }
          .label-info-line { margin-top: .35mm !important; }
          .label-elements-stage + .label-elements-stage { margin-top: .4mm !important; }
          .label-element-line { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; overflow-wrap: anywhere !important; }
          .element-added { color: #2e7d32 !important; }
          .element-removed { color: #c62828 !important; }
          .label-no-elements { padding-top: .8mm !important; text-align: center !important; }

          .label-weights {
            display: grid !important;
            grid-template-columns: 1fr 1.1fr 1fr !important;
            align-items: center !important;
            border-top: 1px solid #163a5f !important;
            border-bottom: 1px solid #163a5f !important;
            background: #f8fafc !important;
            padding: 1.2mm 0 !important;
            margin-bottom: 1.5mm !important;
            text-align: center !important;
          }
          .label-weight-block + .label-weight-block { border-right: 1px solid #cbd5e1 !important; }
          .label-weight-title { color: #64748b !important; font-size: 8px !important; font-weight: 800 !important; }
          .label-weight-value { margin-top: .4mm !important; font-size: 11px !important; font-weight: 800 !important; }
          .label-weight-net { margin-top: .3mm !important; font-size: 8px !important; font-weight: 700 !important; }
          .label-final-weight { margin: -1.2mm 0 !important; padding: 1.2mm 0 !important; background: #edf4fa !important; border-top: 2px solid #163a5f !important; border-bottom: 2px solid #163a5f !important; }
          .label-final-weight .label-weight-title { color: #163a5f !important; }
          .label-final-weight .label-weight-value { color: #2e7d32 !important; font-size: 16px !important; font-weight: 900 !important; }

          .label-barcode-section {
            display: grid !important;
            grid-template-columns: 20mm 1fr 20mm !important;
            align-items: center !important;
            min-height: 10mm !important;
            margin-bottom: 1.2mm !important;
            text-align: center !important;
          }
          .label-barcode-title { color: #163a5f !important; font-weight: 900 !important; }
          .label-barcode svg { width: auto !important; max-width: 72mm !important; height: 8mm !important; display: block !important; margin: 0 auto !important; }
          .label-barcode-placeholder { height: 8mm !important; border: 1px dashed #777 !important; line-height: 8mm !important; color: #555 !important; }
          .label-card-id { font-weight: 800 !important; direction: ltr !important; }

          .label-batches-title { margin-bottom: .6mm !important; color: #163a5f !important; font-size: 9px !important; font-weight: 900 !important; }
          .label-batches-table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; font-size: 7.5px !important; }
          .label-batches-table th,
          .label-batches-table td { border: 1px solid #000 !important; padding: .4mm .7mm !important; text-align: center !important; overflow: visible !important; text-overflow: clip !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.15 !important; }
          .label-batches-table th { color: #fff !important; font-weight: 800 !important; background: #163a5f !important; border-color: #163a5f !important; }
          .label-batches-table tbody tr:nth-child(even) td { background: #f8fafc !important; }
          .label-batches-table th:nth-child(1) { width: 5%; }
          .label-batches-table th:nth-child(2) { width: 31%; }
          .label-batches-table th:nth-child(3) { width: 22%; }
          .label-batches-table th:nth-child(4) { width: 18%; }
          .label-batches-table th:nth-child(5) { width: 24%; }
          .label-total-row td { color: #0f2942 !important; background: #e8eef5 !important; border-top: 2px solid #163a5f !important; font-weight: 900 !important; }
          .label-shipping-table { margin-top: 1mm !important; }
          .label-shipping-table th:nth-child(n) { width: auto !important; }
          .label-shipping-table th:nth-child(3) { width: 26% !important; }
          .label-shipping-table thead { display: table-header-group !important; }
          .label-shipping-table tr { break-inside: avoid !important; }
          .final-weight-label:has(.label-shipping-table) { break-inside: auto !important; page-break-inside: auto !important; }
        }
      `}</style>

      <article className="final-weight-label">
        <header className="label-header">
          <img className="label-logo" src={egastLogo} alt="EGAST Group" />
          <div className="label-heading">
            <div className="label-company-name">الشركة المصرية للخدمات الزراعية (إيجاست)</div>
            <div className="label-title">{isOutbound ? 'كارت الوزن النهائي — صادر' : 'كارت الوزن النهائي'}</div>
            <div className="label-title-en">{isOutbound ? 'OUTBOUND FINAL WEIGHT TICKET' : 'FINAL WEIGHT TICKET'}</div>
            <div className="label-meta">رقم: #{cardNumber} | التاريخ: {formatDate(draft.created_at)}</div>
          </div>
          {qrCode ? (
            <div>
              <img className="label-qr" src={qrCode} alt={`QR للكارت رقم ${cardNumber}`} />
              <div className="label-scan-caption">SCAN TO VERIFY</div>
            </div>
          ) : (
            <div className="label-qr-placeholder">QR</div>
          )}
        </header>

        <section className="label-information">
          <div className="label-info-column">
            <strong className="label-column-title">العربية والسائق:</strong>
            <div className="label-info-line"><strong>رقم العربية:</strong> {vehicleNumber}</div>
            <div className="label-info-line"><strong>اسم السائق:</strong> {driverName}</div>
            {draft.shipping_manifest && <div className="label-info-line"><strong>رقم أمر البيع:</strong> <bdi>{draft.shipping_manifest.sales_order_number || '—'}</bdi></div>}
          </div>
          <div className="label-info-column">
            <strong className="label-column-title">{draft.shipping_manifest ? 'الأصناف المحمّلة:' : 'الصنف والمورد:'}</strong>
            <div className="label-info-line"><strong>اسم الصنف:</strong> {itemName}</div>
            <div className="label-info-line"><strong>الكود:</strong> {itemCode}</div>
            {!draft.shipping_manifest && <div className="label-info-line"><strong>المورد:</strong> {supplier}</div>}
          </div>
          <div className="label-info-column">
            <strong className="label-column-title">العناصر المؤثرة:</strong>
            <InfluencingElements title="للقايم" elements={loadedElements} />
            <InfluencingElements title="للفارغ" elements={emptyElements} />
            {!loadedElements.length && !emptyElements.length && (
              <div className="label-no-elements">لا توجد عناصر مؤثرة</div>
            )}
          </div>
        </section>

        <section className="label-weights">
          <div className="label-weight-block">
            <div className="label-weight-title">الوزن القايم:</div>
            <div className="label-weight-value">{formatInteger(draft.weight_loaded)} كجم</div>
            <div className="label-weight-net">صافي: {formatInteger(firstValue(draft.calculated_net_weight_loaded, draft.net_weight_loaded))} كجم</div>
          </div>
          <div className="label-weight-block label-final-weight">
            <div className="label-weight-title">الوزن النهائي:</div>
            <div className="label-weight-value">{formatInteger(draft.product_weight)} كجم</div>
          </div>
          <div className="label-weight-block">
            <div className="label-weight-title">الوزن الفارغ:</div>
            <div className="label-weight-value">{formatInteger(draft.weight_empty)} كجم</div>
            <div className="label-weight-net">صافي: {formatInteger(firstValue(draft.calculated_net_weight_empty, draft.net_weight_empty))} كجم</div>
          </div>
        </section>

        <section className="label-barcode-section">
          <div className="label-barcode-title">رقم الكارت:</div>
          {barcodeSvg ? (
            <div className="label-barcode" dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
          ) : (
            <div className="label-barcode-placeholder">Barcode</div>
          )}
          <div className="label-card-id">#{cardNumber}</div>
        </section>

        {draft.shipping_manifest && <section className="label-batches">
          <strong>بيان الصادر — الحاوية: <bdi>{draft.shipping_manifest.container_number}</bdi></strong>
          {shippingElements.map(({ type, count }) => <div className="label-element-line" key={type}>
            <bdi dir="ltr">{formatInteger(count, '0')}</bdi> × <bdi>{type}</bdi>
          </div>)}
          <div className="label-batches-title">تفاصيل الباتشات — العدد: {shippingPallets.length}</div>
          <table className="label-batches-table label-shipping-table">
            <thead><tr><th>الباتش</th><th>كود الصنف</th><th>اسم الصنف</th><th>البراند</th><th>السايز</th><th>التصنيف</th><th>التعبئة / الموسم / المواصفات</th></tr></thead>
            <tbody>{shippingPallets.map((p, index) => <tr key={p.batch_number || index}>
              <td><bdi>{p.batch_number || '-'}</bdi></td><td><bdi>{p.item_code || '-'}</bdi></td><td><bdi>{p.item_name || p.item_code || '-'}</bdi></td>
              <td><bdi>{p.attributes?.brand || '-'}</bdi></td><td><bdi>{p.attributes?.size || '-'}</bdi></td><td><bdi>{p.attributes?.category || '-'}</bdi></td>
              <td><bdi>{[p.attributes?.packing, p.attributes?.season, p.attributes?.extra_specification].filter(Boolean).join(' / ') || '-'}</bdi></td>
            </tr>)}</tbody>
          </table>
        </section>}
        {allocations.length > 0 && (
          <section className="label-batches">
            <div className="label-batches-title">📦 توزيع البيفوتات</div>
            <table className="label-batches-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>المورد</th>
                  <th>رقم البيفوت</th>
                  <th>عدد الصناديق</th>
                  <th>الوزن الموزع (كجم)</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((batch, index) => (
                  <tr key={batch.id || index}>
                    <td>{index + 1}</td>
                    <td>{firstValue(batch.supplier, batch.supplier_name, batch.vendor_name, '-')}</td>
                    <td>{firstValue(batch.pivot_number, batch.batch_number, '-')}</td>
                    <td>{formatInteger(firstValue(batch.box_count, batch.boxes_count, batch.container_quantity, batch.package_count, batch.count))}</td>
                    <td>{formatInteger(firstValue(batch.actual_weight, batch.allocated_weight, batch.weight, batch.quantity))}</td>
                  </tr>
                ))}
                <tr className="label-total-row">
                  <td colSpan="3">المجموع</td>
                  <td>{formatInteger(totalBoxes, '0')}</td>
                  <td>{formatInteger(draft.product_weight)} كجم</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}
      </article>
    </div>
  );
}

export default ScalePrintableTicket;
