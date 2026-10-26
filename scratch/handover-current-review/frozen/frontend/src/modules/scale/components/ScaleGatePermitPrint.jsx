import React from 'react';
import egastLogo from '../../../assets/logos/egast-logo.png';

const formatNumber = (value, digits = 2) => (
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
);

const toTon = (kg) => (Number(kg || 0) / 1000);

const fmtDate = (iso) => {
  if (!iso) return '—';
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * Print-only gate permit document. Renders the EG.ST.F05 (entry) or EG.ST.F06 (exit)
 * paper form and injects the print stylesheet needed to isolate it during window.print().
 */
export function ScaleGatePermitPrint({ type, form }) {
  const isEntry = type === 'entry';
  const formBadge = isEntry ? 'EG.ST.F05' : 'EG.ST.F06';
  const docTitle = isEntry ? 'تصريح دخول' : 'تصريح خروج';
  const docTitleEn = isEntry ? 'SCALE ENTRY PERMIT' : 'SCALE EXIT PERMIT';
  const partyLabel = isEntry ? 'اسم المورد' : 'اسم المشتري';
  const partyName = isEntry ? form.supplier_name : form.buyer_name;

  const items = form.items || [];
  const totalKg = items.reduce((sum, row) => sum + (Number(row.quantity_kg) || 0), 0);

  const grossKg = Number(form.gross_weight_kg) || 0;
  const tareKg = Number(form.tare_weight_kg) || 0;
  const netKg = Number(form.net_weight_kg);
  const hasValidNet = !Number.isNaN(netKg) && Number(netKg) >= 0;

  const sigRoles = isEntry
    ? [
        { name: form.gate_writer, sig: form.gate_writer_signature, title: 'كاتب البوابة' },
        { name: form.inspection_head, sig: form.inspection_head_signature, title: 'رئيس قسم التفتيش الوارد' },
        { name: form.scale_operator, sig: form.scale_operator_signature, title: 'مسؤول الباسكول' },
        { name: form.general_manager, sig: form.general_manager_signature, title: 'مدير عام الشركة' },
      ]
    : [
        { name: form.responsible_person, sig: form.responsible_signature, title: 'المسؤول' },
        { name: form.department_manager, sig: form.department_manager_signature, title: 'مدير الإدارة' },
        { name: form.general_manager, sig: form.general_manager_signature, title: 'مدير عام الشركة' },
      ];

  return (
    <div className="gp-permit-print-container" dir="rtl">
      <div className="gp-doc">
        <div className="gp-header">
          <div className="gp-brand-section">
            <img src={egastLogo} alt="EGAST Group" className="gp-logo" />
            <div className="gp-brand-text">
              <div className="gp-brand-name">الشركة المصرية للخدمات الزراعية</div>
              <div className="gp-brand-en">EGAST — Egyptian Agricultural Services Co.</div>
              <div className="gp-doc-title">{docTitle}</div>
              <div className="gp-doc-title-en">{docTitleEn}</div>
            </div>
          </div>
          <div className="gp-meta">
            <div className="gp-form-badge">نموذج رقم: {formBadge}</div>
            <div className="gp-permit-no">رقم التصريح: {form.permit_number || '________________'}</div>
            <div className="gp-date">التاريخ: {fmtDate(form.permit_date)}</div>
          </div>
        </div>

        <div className="gp-info-grid">
          <div className="gp-info-cell">
            <div className="gp-info-label">التاريخ</div>
            <div className="gp-info-value">{fmtDate(form.permit_date)}</div>
          </div>
          <div className="gp-info-cell">
            <div className="gp-info-label">{partyLabel}</div>
            <div className="gp-info-value">{partyName || '—'}</div>
          </div>
          <div className="gp-info-cell">
            <div className="gp-info-label">اسم السائق</div>
            <div className="gp-info-value">{form.driver_name || '—'}</div>
          </div>
          {!isEntry && (
            <div className="gp-info-cell">
              <div className="gp-info-label">الجهة</div>
              <div className="gp-info-value">{form.destination || '—'}</div>
            </div>
          )}
          <div className="gp-info-cell">
            <div className="gp-info-label">رقم السيارة</div>
            <div className="gp-info-value">{form.vehicle_number || '—'}</div>
          </div>
        </div>

        <table className="gp-table">
          <thead>
            <tr>
              <th>الرقم الكودي</th>
              <th>اسم الصنف</th>
              <th>العدد</th>
              <th>{isEntry ? 'مسجل كيلو' : 'الوزن كيلو'}</th>
              <th>{isEntry ? 'مسجل طن' : 'الوزن طن'}</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((row, index) => (
                <tr key={row.key || index}>
                  <td>{row.item_code || '—'}</td>
                  <td>{row.item_name || '—'}</td>
                  <td>{row.count || 0}</td>
                  <td>{formatNumber(row.quantity_kg)}</td>
                  <td>{formatNumber(toTon(row.quantity_kg), 3)}</td>
                  <td>{row.notes || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="gp-table-empty">لا توجد أصناف مسجلة</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="gp-totals-row">
              <td colSpan="3">الإجمالي</td>
              <td>{formatNumber(totalKg)}</td>
              <td>{formatNumber(toTon(totalKg), 3)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {isEntry && (
          <>
            <table className="gp-table gp-weight-table">
              <thead>
                <tr>
                  <th>بيان وزن الحمولة</th>
                  <th>كيلو</th>
                  <th>طن</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="gp-weight-label">القائم</td>
                  <td>{formatNumber(grossKg)}</td>
                  <td>{formatNumber(toTon(grossKg), 3)}</td>
                </tr>
                <tr>
                  <td className="gp-weight-label">الفارغ</td>
                  <td>{formatNumber(tareKg)}</td>
                  <td>{formatNumber(toTon(tareKg), 3)}</td>
                </tr>
                <tr>
                  <td className="gp-weight-label">الصافي</td>
                  <td>{hasValidNet ? formatNumber(netKg) : '—'}</td>
                  <td>{hasValidNet ? formatNumber(toTon(netKg), 3) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {isEntry && (form.inspection_result || form.gate_writer || form.inspection_head) && (
          <div className="gp-inspection">
            <div><strong>نتيجة الفحص والمعاينة: </strong>{form.inspection_result || '—'}</div>
            <div className="gp-inspection-sub">
              كاتب البوابة: {form.gate_writer || '—'} · رئيس قسم التفتيش الوارد: {form.inspection_head || '—'}
            </div>
          </div>
        )}

        {form.weight_in_words && (
          <div className="gp-only-amount">
            <strong>فقط وقدره: </strong>{form.weight_in_words}
          </div>
        )}

        {form.notes && (
          <div className="gp-notes">
            <strong>ملاحظات: </strong>{form.notes}
          </div>
        )}

        <div className="gp-signatures">
          {sigRoles.map((role) => (
            <div key={role.title} className="gp-sig-card">
              <div className="gp-sig-title">{role.title}</div>
              <div className="gp-sig-name">الاسم: {role.name || '________________'}</div>
              <div className="gp-sig-image">
                {role.sig
                  ? <img src={role.sig} alt="" />
                  : <span>التوقيع: ________________</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="gp-footer">
          <div>نظام إدارة الميزان والبسكول — EGAST ERP Weighbridge System</div>
          <div>مستند رسمي معتمد · صفحة 1 من 1</div>
        </div>
      </div>

      <style>{`
        .gp-permit-print-container { display: none; }

        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * { visibility: hidden !important; }
          .gp-permit-print-container,
          .gp-permit-print-container * { visibility: visible !important; }
          .gp-permit-print-container {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            box-sizing: border-box !important;
          }
          .gp-doc {
            border: 2px solid #064e3b !important;
            border-radius: 6px !important;
            padding: 16px 20px !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }
          .gp-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            border-bottom: 2px solid #064e3b !important;
            padding-bottom: 10px !important;
            margin-bottom: 12px !important;
          }
          .gp-brand-section {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
          }
          .gp-logo {
            height: 48px !important;
            max-height: 48px !important;
            width: auto !important;
            object-fit: contain !important;
            display: block !important;
          }
          .gp-brand-name { margin: 0 !important; font-size: 19px !important; font-weight: 900 !important; color: #064e3b !important; }
          .gp-brand-en { margin: 2px 0 0 0 !important; font-size: 13px !important; font-weight: 800 !important; color: #047857 !important; letter-spacing: 0.5px !important; }
          .gp-doc-title { margin: 4px 0 0 0 !important; font-size: 15px !important; font-weight: 800 !important; color: #334155 !important; }
          .gp-meta { text-align: left !important; direction: ltr !important; }
          .gp-form-badge {
            display: inline-block !important;
            border: 1.5px solid #064e3b !important;
            background: #f0fdf4 !important;
            color: #064e3b !important;
            padding: 3px 10px !important;
            border-radius: 4px !important;
            font-size: 13px !important;
            font-weight: 900 !important;
          }
          .gp-permit-no { margin-top: 4px !important; font-size: 14px !important; font-weight: 900 !important; color: #0f172a !important; }
          .gp-date { font-size: 11px !important; color: #475569 !important; margin-top: 2px !important; font-weight: 600 !important; }
          .gp-info-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 1fr) !important;
            gap: 6px !important;
            margin-bottom: 12px !important;
          }
          .gp-info-cell { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 5px 8px !important; }
          .gp-info-label { font-size: 10px !important; font-weight: 700 !important; color: #64748b !important; }
          .gp-info-value { font-size: 12.5px !important; font-weight: 800 !important; color: #0f172a !important; margin-top: 2px !important; }
          .gp-table { width: 100% !important; border-collapse: collapse !important; margin-bottom: 10px !important; }
          .gp-table th {
            background: #064e3b !important;
            color: #ffffff !important;
            padding: 6px 8px !important;
            font-size: 11.5px !important;
            font-weight: 800 !important;
            border: 1px solid #064e3b !important;
            text-align: right !important;
          }
          .gp-table td {
            padding: 6px 8px !important;
            border: 1px solid #cbd5e1 !important;
            font-size: 12px !important;
            color: #0f172a !important;
            text-align: right !important;
          }
          .gp-table-empty { text-align: center !important; color: #64748b !important; }
          .gp-totals-row td { font-weight: 900 !important; font-size: 13px !important; background: #f0fdf4 !important; }
          .gp-weight-table { width: 45% !important; }
          .gp-weight-label { font-weight: 800 !important; }
          .gp-inspection {
            border: 1px dashed #94a3b8 !important;
            background: #f8fafc !important;
            padding: 6px 10px !important;
            border-radius: 4px !important;
            font-size: 11.5px !important;
            margin-bottom: 8px !important;
            color: #334155 !important;
          }
          .gp-inspection-sub { margin-top: 4px !important; font-size: 11px !important; color: #475569 !important; }
          .gp-only-amount, .gp-notes {
            border: 1px dashed #94a3b8 !important;
            background: #f8fafc !important;
            padding: 6px 10px !important;
            border-radius: 4px !important;
            font-size: 11.5px !important;
            margin-bottom: 8px !important;
            color: #334155 !important;
          }
          .gp-signatures {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 12px !important;
            margin-top: 14px !important;
            padding-top: 12px !important;
            border-top: 1.5px solid #064e3b !important;
          }
          .gp-sig-card { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 8px 10px !important; background: #ffffff !important; }
          .gp-sig-title { font-size: 12.5px !important; font-weight: 900 !important; color: #0f172a !important; margin-bottom: 8px !important; }
          .gp-sig-name { font-size: 11.5px !important; color: #334155 !important; font-weight: 700 !important; margin-bottom: 6px !important; }
          .gp-sig-image img { max-height: 52px !important; max-width: 150px !important; display: block !important; }
          .gp-sig-image span { font-size: 11px !important; color: #64748b !important; }
          .gp-sig-card:nth-child(4) { grid-column: 4; }
          .gp-signatures:has(.gp-sig-card:nth-child(3)) { grid-template-columns: repeat(3, 1fr) !important; }
          .gp-footer {
            margin-top: 10px !important;
            padding-top: 6px !important;
            border-top: 1px solid #e2e8f0 !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            font-size: 10px !important;
            color: #64748b !important;
          }

          /* A4 single-page geometry and compact print rhythm. */
          @page { size: A4 portrait; margin: 0; }
          .gp-permit-print-container {
            width: 210mm !important;
            height: 297mm !important;
            padding: 5mm !important;
            overflow: visible !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .gp-doc {
            width: 200mm !important;
            height: 287mm !important;
            padding: 4mm !important;
            overflow: visible !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .gp-header { padding-bottom: 2mm !important; margin-bottom: 3mm !important; }
          .gp-brand-section { gap: 3mm !important; }
          .gp-logo { width: 16mm !important; height: 16mm !important; max-height: 16mm !important; }
          .gp-brand-name { font-size: 14px !important; }
          .gp-brand-en { font-size: 9px !important; }
          .gp-doc-title { margin-top: 1mm !important; font-size: 11px !important; }
          .gp-form-badge, .gp-permit-no { font-size: 9px !important; }
          .gp-form-badge { padding: 1mm 2mm !important; }
          .gp-date { font-size: 8px !important; }
          .gp-info-grid { gap: 1.5mm !important; margin-bottom: 2mm !important; }
          .gp-info-cell { padding: 1mm 1.5mm !important; }
          .gp-info-label { font-size: 8px !important; }
          .gp-info-value { margin-top: .5mm !important; font-size: 9px !important; overflow-wrap: anywhere !important; }
          .gp-table { table-layout: fixed !important; margin-bottom: 2mm !important; }
          .gp-table th, .gp-table td {
            padding: 1mm 1.5mm !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
          }
          .gp-totals-row td { font-size: 9px !important; }
          .gp-inspection, .gp-only-amount, .gp-notes {
            padding: 1mm 1.5mm !important;
            margin-bottom: 2mm !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
          }
          .gp-inspection-sub { margin-top: 1mm !important; font-size: 8px !important; }
          .gp-signatures { gap: 2mm !important; margin-top: 2mm !important; padding-top: 2mm !important; }
          .gp-sig-card { padding: 1.5mm !important; }
          .gp-sig-title { margin-bottom: 1.5mm !important; font-size: 9px !important; }
          .gp-sig-name { margin-bottom: 1mm !important; font-size: 8.5px !important; }
          .gp-sig-image img { max-height: 12mm !important; max-width: 32mm !important; }
          .gp-sig-image span { font-size: 8px !important; }
          .gp-footer { margin-top: 2mm !important; padding-top: 1.5mm !important; font-size: 8px !important; }
          .gp-doc { border: 1px solid #cbd5e1 !important; border-top: 3px solid #163a5f !important; border-radius: 2px !important; }
          .gp-header { border-bottom-color: #163a5f !important; }
          .gp-brand-name { color: #0f2942 !important; }
          .gp-brand-en, .gp-doc-title { color: #163a5f !important; }
          .gp-doc-title-en { margin-top: .3mm !important; color: #64748b !important; font-size: 7px !important; font-weight: 800 !important; letter-spacing: .7px !important; direction: ltr !important; }
          .gp-form-badge { color: #163a5f !important; background: #f1f5f9 !important; border-color: #cbd5e1 !important; border-radius: 2px !important; }
          .gp-info-cell { background: #f8fafc !important; border-color: #e2e8f0 !important; border-radius: 2px !important; border-top: 2px solid #163a5f !important; }
          .gp-info-label { color: #64748b !important; }
          .gp-info-value { color: #0f2942 !important; }
          .gp-table th { color: #fff !important; background: #163a5f !important; border-color: #163a5f !important; }
          .gp-table td { border-color: #cbd5e1 !important; }
          .gp-table tbody tr:nth-child(even) td { background: #f8fafc !important; }
          .gp-totals-row td { color: #0f2942 !important; background: #e8eef5 !important; border-top: 2px solid #163a5f !important; }
          .gp-weight-table tbody tr:last-child td { color: #2e7d32 !important; background: #eef7ef !important; font-weight: 900 !important; }
          .gp-inspection, .gp-only-amount, .gp-notes { background: #f8fafc !important; border-color: #cbd5e1 !important; border-inline-start: 3px solid #163a5f !important; border-radius: 2px !important; }
          .gp-signatures { border-top-color: #163a5f !important; }
          .gp-sig-card { border-color: #e2e8f0 !important; border-radius: 2px !important; }
          .gp-sig-title { color: #0f2942 !important; }
          .gp-footer { color: #64748b !important; border-top-color: #cbd5e1 !important; }
        }
      `}</style>
    </div>
  );
}

export default ScaleGatePermitPrint;
