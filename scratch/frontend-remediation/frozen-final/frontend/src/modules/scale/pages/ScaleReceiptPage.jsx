import { PrintActionButton } from '../../../components/ui/ActionIconButton';
import React, { useState } from 'react';
import egastLogo from '../../../assets/logos/egast-logo.png';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../contexts/I18nContext';
import { useToast } from '../../../components/ui/ToastProvider';
import PageHeader from '../../../components/ui/PageHeader';
import SignaturePad from '../components/SignaturePad';
import scaleApi from '../services/scaleApi';

let idCounter = 0;
const uid = () => `row-${Date.now()}-${idCounter++}`;

const todayISO = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const emptyForm = () => ({
  receipt_number: '',
  receipt_date: todayISO(),
  vehicle_number: '',
  driver_name: '',
  driver_license: '',
  source: '',
  supplier_name: '',
  notes: '',
  items: [
    { key: uid(), item_code: '', item_name: '', count: '1', quantity_kg: '0', package_type: '', notes: '' },
  ],
  driver_signature_name: '',
  receiver_signature_name: '',
  driver_signature: '',
  receiver_signature: '',
});

const sanitizeNumeric = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  const num = Number(text);
  if (Number.isNaN(num)) return '';
  return Math.max(0, num).toString();
};

const formatNumber = (value, digits = 2) => (
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
);

function ScaleReceiptPrintDocument({ form }) {
  const { t } = useI18n();
  const items = form.items;
  const totalKg = items.reduce((sum, item) => sum + (Number(item.quantity_kg) || 0), 0);
  const totalTon = totalKg / 1000;
  const hasItems = items.some((item) => item.item_name || item.item_code || Number(item.quantity_kg) > 0);

  const printDate = form.receipt_date
    ? new Date(`${form.receipt_date}T00:00:00`).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  return (
    <div className="scale-receipt-print-container" dir="rtl">
      <div className="sr-doc">
        <div className="sr-header">
          <div className="sr-brand-section">
            <img src={egastLogo} alt="EGAST Group" className="sr-logo" />
            <div className="sr-brand-text">
              <div className="sr-brand-name">الشركة المصرية للخدمات الزراعية</div>
              <div className="sr-brand-en">EGAST — Egyptian Agricultural Services Co.</div>
              <div className="sr-doc-title">إيصال استلام</div>
              <div className="sr-doc-title-en">SCALE GOODS RECEIPT</div>
            </div>
          </div>
          <div className="sr-meta">
            <div className="sr-form-badge">نموذج رقم: EG.ST.F04</div>
            <div className="sr-receipt-no">{form.receipt_number || '—'}</div>
            <div className="sr-date">{printDate}</div>
          </div>
        </div>

        <div className="sr-info-grid">
          <div className="sr-info-cell">
            <div className="sr-info-label">التاريخ</div>
            <div className="sr-info-value">{printDate}</div>
          </div>
          <div className="sr-info-cell">
            <div className="sr-info-label">رقم السيارة</div>
            <div className="sr-info-value">{form.vehicle_number || '—'}</div>
          </div>
          <div className="sr-info-cell">
            <div className="sr-info-label">اسم السائق</div>
            <div className="sr-info-value">{form.driver_name || '—'}</div>
          </div>
          <div className="sr-info-cell">
            <div className="sr-info-label">رقم الرخصة</div>
            <div className="sr-info-value">{form.driver_license || '—'}</div>
          </div>
          <div className="sr-info-cell">
            <div className="sr-info-label">من المصدر</div>
            <div className="sr-info-value">{form.source || '—'}</div>
          </div>
        </div>

        <table className="sr-table">
          <thead>
            <tr>
              <th>الرقم الكودي</th>
              <th>اسم الصنف</th>
              <th>العدد</th>
              <th>الكمية بالكيلو</th>
              <th>الكمية بالطن</th>
              <th>نوع العبوة</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {hasItems ? (
              items.map((item, index) => (
                <tr key={item.key || index}>
                  <td>{item.item_code || '—'}</td>
                  <td>{item.item_name || '—'}</td>
                  <td>{item.count || 0}</td>
                  <td>{formatNumber(item.quantity_kg)}</td>
                  <td>{formatNumber((Number(item.quantity_kg) || 0) / 1000, 3)}</td>
                  <td>{item.package_type || '—'}</td>
                  <td>{item.notes || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="sr-table-empty">لا توجد أصناف مسجلة</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="sr-totals-row">
              <td colSpan="3">{t('scale.totalKg')}</td>
              <td>{formatNumber(totalKg)}</td>
              <td colSpan="2">{t('scale.totalTon')}</td>
              <td>{formatNumber(totalTon, 3)}</td>
            </tr>
          </tfoot>
        </table>

        {form.notes && (
          <div className="sr-notes">
            <strong>ملاحظات: </strong>
            {form.notes}
          </div>
        )}

        <div className="sr-signatures">
          <div className="sr-sig-card">
            <div className="sr-sig-title">السائق</div>
            <div className="sr-sig-name">الاسم: {form.driver_signature_name || '________________'}</div>
            <div className="sr-sig-image">
              {form.driver_signature
                ? <img src={form.driver_signature} alt="" />
                : <span>التوقيع: ________________</span>}
            </div>
          </div>
          <div className="sr-sig-card">
            <div className="sr-sig-title">المستلم بقيمة البضاعة</div>
            <div className="sr-sig-name">الاسم: {form.receiver_signature_name || '________________'}</div>
            <div className="sr-sig-image">
              {form.receiver_signature
                ? <img src={form.receiver_signature} alt="" />
                : <span>التوقيع: ________________</span>}
            </div>
          </div>
        </div>

        <div className="sr-footer">
          <div>نظام إدارة الميزان والبسكول — EGAST ERP Weighbridge System</div>
          <div>مستند رسمي معتمد · صفحة 1 من 1</div>
        </div>
      </div>
    </div>
  );
}

export function ScaleReceiptPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const toast = useToast();

  const [form, setForm] = useState(emptyForm);
  const [savedId, setSavedId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleItemChange = (key, field, rawValue) => {
    const value = field === 'count' || field === 'quantity_kg' ? sanitizeNumeric(rawValue) : rawValue;
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    }));
  };

  const addRow = () => {
    setForm((current) => ({
      ...current,
      items: [...current.items, { key: uid(), item_code: '', item_name: '', count: '1', quantity_kg: '0', package_type: '', notes: '' }],
    }));
  };

  const removeRow = (key) => {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((item) => item.key !== key) : current.items,
    }));
  };

  const buildPayload = (formData) => {
    const items = formData.items
      .map((item) => {
        const kg = Number(item.quantity_kg) || 0;
        return {
          item_code: item.item_code.trim(),
          item_name: item.item_name.trim(),
          count: Math.max(0, Number(item.count) || 0),
          quantity_kg: kg,
          quantity_ton: kg / 1000,
          package_type: item.package_type.trim(),
          notes: item.notes.trim(),
        };
      })
      .filter((item) => item.item_name || item.item_code || item.quantity_kg > 0);

    return {
      receipt_date: formData.receipt_date || todayISO(),
      vehicle_number: formData.vehicle_number.trim(),
      driver_name: formData.driver_name.trim(),
      driver_license: formData.driver_license.trim(),
      source: formData.source.trim(),
      supplier_name: formData.supplier_name.trim(),
      items,
      driver_signature_name: formData.driver_signature_name.trim(),
      receiver_signature_name: formData.receiver_signature_name.trim(),
      driver_signature: formData.driver_signature || '',
      receiver_signature: formData.receiver_signature || '',
      notes: formData.notes.trim(),
    };
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = buildPayload(form);
      const wasSaved = Boolean(savedId);
      const res = wasSaved
        ? await scaleApi.updateReceipt(savedId, payload)
        : await scaleApi.createReceipt(payload);
      setSavedId(res.data.id);
      setForm((current) => ({ ...current, receipt_number: res.data.receipt_number }));
      toast.success(wasSaved ? t('scale.receiptUpdatedSuccess') : t('scale.receiptSavedSuccess'));
      return res.data;
    } catch (err) {
      const errors = err?.response?.data?.errors;
      toast.error(errors ? JSON.stringify(errors) : err?.response?.data?.error || err.message);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndClose = async () => {
    const saved = await handleSave();
    if (saved) navigate('/scale');
  };

  const handleClear = () => {
    const dirty = form.vehicle_number || form.driver_name || form.source || form.items.some(
      (item) => item.item_name || item.item_code || Number(item.quantity_kg) > 0
    );
    if (dirty && !window.confirm(t('scale.confirmClearReceipt'))) return;
    setSavedId(null);
    setForm(emptyForm());
  };

  const totalKg = form.items.reduce((sum, item) => sum + (Number(item.quantity_kg) || 0), 0);
  const totalTon = totalKg / 1000;

  return (
    <div className="home-page scale-receipt-page">
      <PageHeader
        eyebrow={t('scale.title')}
        title={t('scale.receiptTitle')}
        description={t('scale.receiptSubtitle')}
      />

      <div className="scale-receipt-toolbar">
        <button type="button" className="app-button app-button--primary" disabled={isSaving} onClick={handleSave}>
          {isSaving ? '...' : `💾 ${t('scale.saveReceipt')}`}
        </button>
        <button type="button" className="app-button app-button--primary" disabled={isSaving} onClick={handleSaveAndClose}>
          {t('scale.saveAndClose')}
        </button>
        <button type="button" className="app-button" onClick={handleClear}>
          {t('scale.clearReceipt')}
        </button>
        <PrintActionButton icon="🖨️" onClick={() => window.print()}/>
        {form.receipt_number && <span className="scale-receipt-number">{form.receipt_number}</span>}
      </div>

      <div className="card-panel scale-receipt-sheet">
        <div className="sr-edit-head">
          <div className="form-field">
            <label>{t('scale.receiptDate')}</label>
            <input
              className="app-input"
              type="date"
              value={form.receipt_date}
              onChange={(event) => setField('receipt_date', event.target.value)}
            />
          </div>
          <div className="form-field">
            <label>{t('scale.vehicleNumber')}</label>
            <input
              className="app-input"
              value={form.vehicle_number}
              onChange={(event) => setField('vehicle_number', event.target.value)}
            />
          </div>
          <div className="form-field">
            <label>{t('scale.driverName')}</label>
            <input
              className="app-input"
              value={form.driver_name}
              onChange={(event) => setField('driver_name', event.target.value)}
            />
          </div>
          <div className="form-field">
            <label>{t('scale.driverLicense')}</label>
            <input
              className="app-input"
              value={form.driver_license}
              onChange={(event) => setField('driver_license', event.target.value)}
            />
          </div>
          <div className="form-field">
            <label>{t('scale.receiptSource')}</label>
            <input
              className="app-input"
              value={form.source}
              onChange={(event) => setField('source', event.target.value)}
            />
          </div>
        </div>

        <div className="sr-products-head">
          <h2>{t('scale.productsTable')}</h2>
          <button type="button" className="app-button app-button--primary app-button--sm" onClick={addRow}>
            ＋ {t('scale.addRow')}
          </button>
        </div>

        <div className="sr-table-scroll">
          <table className="sr-edit-table">
            <thead>
              <tr>
                <th>{t('scale.itemCode')}</th>
                <th>{t('scale.itemName')}</th>
                <th>{t('scale.count')}</th>
                <th>{t('scale.quantityKg')}</th>
                <th>{t('scale.packageType')}</th>
                <th>{t('scale.notes')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.items.map((item) => (
                <tr key={item.key}>
                  <td>
                    <input
                      className="app-input"
                      value={item.item_code}
                      onChange={(event) => handleItemChange(item.key, 'item_code', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input"
                      value={item.item_name}
                      onChange={(event) => handleItemChange(item.key, 'item_name', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input sr-num-input"
                      type="number"
                      min="0"
                      value={item.count}
                      onChange={(event) => handleItemChange(item.key, 'count', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input sr-num-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.quantity_kg}
                      onChange={(event) => handleItemChange(item.key, 'quantity_kg', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input"
                      value={item.package_type}
                      onChange={(event) => handleItemChange(item.key, 'package_type', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input"
                      value={item.notes}
                      onChange={(event) => handleItemChange(item.key, 'notes', event.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="sr-remove-btn"
                      onClick={() => removeRow(item.key)}
                      disabled={form.items.length === 1}
                      title={t('scale.removeRow')}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" className="sr-total-label">{t('scale.totalKg')}</td>
                <td className="sr-total-value">{formatNumber(totalKg)}</td>
                <td colSpan="2" className="sr-total-label">{t('scale.totalTon')}</td>
                <td className="sr-total-value">{formatNumber(totalTon, 3)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="sr-edit-foot">
          <div className="form-field sr-notes-field">
            <label>{t('scale.notes')}</label>
            <textarea
              className="app-input"
              rows="2"
              value={form.notes}
              onChange={(event) => setField('notes', event.target.value)}
            />
          </div>
        </div>

        <div className="sr-signatures-edit">
          <div className="sr-sig-edit-card card-panel">
            <div className="sr-sig-edit-title">{t('scale.driverSignature')}</div>
            <div className="form-field">
              <label>{t('scale.signatureName')}</label>
              <input
                className="app-input"
                value={form.driver_signature_name}
                onChange={(event) => setField('driver_signature_name', event.target.value)}
              />
            </div>
            <div className="form-field">
              <label>{t('scale.signatureDraw')}</label>
              <SignaturePad
                value={form.driver_signature}
                onChange={(value) => setField('driver_signature', value || '')}
              />
            </div>
          </div>
          <div className="sr-sig-edit-card card-panel">
            <div className="sr-sig-edit-title">{t('scale.receiverSignature')}</div>
            <div className="form-field">
              <label>{t('scale.signatureName')}</label>
              <input
                className="app-input"
                value={form.receiver_signature_name}
                onChange={(event) => setField('receiver_signature_name', event.target.value)}
              />
            </div>
            <div className="form-field">
              <label>{t('scale.signatureDraw')}</label>
              <SignaturePad
                value={form.receiver_signature}
                onChange={(value) => setField('receiver_signature', value || '')}
              />
            </div>
          </div>
        </div>
      </div>

      <ScaleReceiptPrintDocument form={form} />

      <style>{`
        .scale-receipt-print-container { display: none; }

        .scale-receipt-page { padding-bottom: 40px; }
        .scale-receipt-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          margin: 0 auto 18px;
          width: min(1100px, 100%);
        }
        .scale-receipt-toolbar .app-button { min-height: 40px; }
        .scale-receipt-number {
          margin-inline-start: auto;
          font-weight: 800;
          color: var(--color-primary);
          background: var(--color-primary-soft);
          border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
          border-radius: var(--radius-sm);
          padding: 4px 12px;
        }
        .scale-receipt-sheet {
          width: min(1100px, 100%);
          margin: 0 auto;
          padding: 22px 24px;
        }
        .sr-edit-head {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 20px;
        }
        .sr-edit-head .form-field { margin-bottom: 0; }
        .sr-products-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .sr-products-head h2 { margin: 0; font-size: 1.1rem; color: var(--color-text); }
        .sr-table-scroll { overflow-x: auto; margin-bottom: 16px; }
        .sr-edit-table { width: 100%; min-width: 760px; border-collapse: collapse; }
        .sr-edit-table th {
          background: var(--bg-muted);
          color: var(--color-text-muted);
          text-align: start;
          padding: 8px 10px;
          font-size: 0.84rem;
          border: 1px solid var(--color-border);
        }
        .sr-edit-table td {
          padding: 6px 8px;
          border: 1px solid var(--color-border);
          vertical-align: middle;
        }
        .sr-edit-table .app-input { min-width: 0; width: 100%; padding: 6px 8px; }
        .sr-num-input { text-align: end; direction: ltr; }
        .sr-remove-btn {
          width: 28px;
          height: 28px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--danger, #dc2626);
          cursor: pointer;
          font-size: 13px;
        }
        .sr-remove-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sr-edit-table tfoot td {
          background: var(--bg-muted);
          font-weight: 800;
          font-size: 0.9rem;
        }
        .sr-total-label { color: var(--color-text-muted); }
        .sr-total-value { text-align: end; direction: ltr; white-space: nowrap; }
        .sr-edit-foot { margin-bottom: 20px; }
        .sr-notes-field { margin-bottom: 0; }
        .sr-notes-field textarea { resize: vertical; min-height: 54px; }
        .sr-signatures-edit {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .sr-sig-edit-card { padding: 16px; }
        .sr-sig-edit-card .form-field { margin-bottom: 12px; }
        .sr-sig-edit-title {
          font-weight: 800;
          color: var(--color-text);
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
        }
        .signature-pad { position: relative; }
        .signature-pad__canvas {
          width: 100%;
          border: 1px dashed var(--color-border);
          border-radius: var(--radius-sm);
          background: #fff;
          touch-action: none;
        }
        .signature-pad__clear {
          position: absolute;
          top: 4px;
          inset-inline-start: 4px;
          width: 24px;
          height: 24px;
          line-height: 1;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: var(--color-surface);
          color: var(--color-text-muted);
          cursor: pointer;
        }

        @media (max-width: 900px) {
          .sr-edit-head { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        @media (max-width: 680px) {
          .scale-receipt-sheet { padding: 16px 14px; }
          .sr-edit-head { grid-template-columns: 1fr; gap: 10px; }
          .sr-signatures-edit { grid-template-columns: 1fr; }
        }

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
          .scale-receipt-print-container,
          .scale-receipt-print-container * { visibility: visible !important; }
          .scale-receipt-print-container {
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
          .sr-doc {
            border: 2px solid #064e3b !important;
            border-radius: 6px !important;
            padding: 16px 20px !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }
          .sr-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            border-bottom: 2px solid #064e3b !important;
            padding-bottom: 10px !important;
            margin-bottom: 12px !important;
          }
          .sr-brand-section {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
          }
          .sr-logo {
            height: 48px !important;
            max-height: 48px !important;
            width: auto !important;
            object-fit: contain !important;
            display: block !important;
          }
          .sr-brand-name { margin: 0 !important; font-size: 19px !important; font-weight: 900 !important; color: #064e3b !important; }
          .sr-brand-en { margin: 2px 0 0 0 !important; font-size: 13px !important; font-weight: 800 !important; color: #047857 !important; letter-spacing: 0.5px !important; }
          .sr-doc-title { margin: 4px 0 0 0 !important; font-size: 15px !important; font-weight: 800 !important; color: #334155 !important; }
          .sr-meta { text-align: left !important; direction: ltr !important; }
          .sr-form-badge {
            display: inline-block !important;
            border: 1.5px solid #064e3b !important;
            background: #f0fdf4 !important;
            color: #064e3b !important;
            padding: 3px 10px !important;
            border-radius: 4px !important;
            font-size: 13px !important;
            font-weight: 900 !important;
          }
          .sr-receipt-no { margin-top: 4px !important; font-size: 14px !important; font-weight: 900 !important; color: #0f172a !important; }
          .sr-date { font-size: 11px !important; color: #475569 !important; margin-top: 2px !important; font-weight: 600 !important; }
          .sr-info-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 1fr) !important;
            gap: 6px !important;
            margin-bottom: 12px !important;
          }
          .sr-info-cell { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 5px 8px !important; }
          .sr-info-label { font-size: 10px !important; font-weight: 700 !important; color: #64748b !important; }
          .sr-info-value { font-size: 12.5px !important; font-weight: 800 !important; color: #0f172a !important; margin-top: 2px !important; }
          .sr-table { width: 100% !important; border-collapse: collapse !important; margin-bottom: 10px !important; }
          .sr-table th {
            background: #064e3b !important;
            color: #ffffff !important;
            padding: 6px 8px !important;
            font-size: 11.5px !important;
            font-weight: 800 !important;
            border: 1px solid #064e3b !important;
            text-align: right !important;
          }
          .sr-table td {
            padding: 6px 8px !important;
            border: 1px solid #cbd5e1 !important;
            font-size: 12px !important;
            color: #0f172a !important;
          }
          .sr-table-empty { text-align: center !important; color: #64748b !important; }
          .sr-totals-row td { font-weight: 900 !important; font-size: 13px !important; background: #f0fdf4 !important; }
          .sr-notes { border: 1px dashed #94a3b8 !important; background: #f8fafc !important; padding: 6px 10px !important; border-radius: 4px !important; font-size: 11.5px !important; margin-bottom: 12px !important; color: #334155 !important; }
          .sr-signatures {
            display: grid !important;
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 14px !important;
            margin-top: 14px !important;
            padding-top: 12px !important;
            border-top: 1.5px solid #064e3b !important;
          }
          .sr-sig-card { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 8px 10px !important; background: #ffffff !important; }
          .sr-sig-title { font-size: 12.5px !important; font-weight: 900 !important; color: #0f172a !important; margin-bottom: 8px !important; }
          .sr-sig-name { font-size: 11.5px !important; color: #334155 !important; font-weight: 700 !important; margin-bottom: 6px !important; }
          .sr-sig-image img { max-height: 56px !important; max-width: 180px !important; display: block !important; }
          .sr-sig-image span { font-size: 11px !important; color: #64748b !important; }
          .sr-footer {
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
          .scale-receipt-print-container {
            width: 210mm !important;
            height: 297mm !important;
            padding: 5mm !important;
            overflow: visible !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .sr-doc {
            width: 200mm !important;
            height: 287mm !important;
            padding: 4mm !important;
            overflow: visible !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .sr-header { padding-bottom: 2mm !important; margin-bottom: 3mm !important; }
          .sr-brand-section { gap: 3mm !important; }
          .sr-logo { width: 16mm !important; height: 16mm !important; max-height: 16mm !important; }
          .sr-brand-name { font-size: 14px !important; }
          .sr-brand-en { font-size: 9px !important; }
          .sr-doc-title { margin-top: 1mm !important; font-size: 11px !important; }
          .sr-form-badge, .sr-receipt-no { font-size: 9px !important; }
          .sr-form-badge { padding: 1mm 2mm !important; }
          .sr-date { font-size: 8px !important; }
          .sr-info-grid { gap: 1.5mm !important; margin-bottom: 2mm !important; }
          .sr-info-cell { padding: 1mm 1.5mm !important; }
          .sr-info-label { font-size: 8px !important; }
          .sr-info-value { margin-top: .5mm !important; font-size: 9px !important; overflow-wrap: anywhere !important; }
          .sr-table { table-layout: fixed !important; margin-bottom: 2mm !important; }
          .sr-table th, .sr-table td {
            padding: 1mm 1.5mm !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
          }
          .sr-totals-row td { font-size: 9px !important; }
          .sr-notes { padding: 1mm 1.5mm !important; margin-bottom: 2mm !important; font-size: 8.5px !important; line-height: 1.2 !important; }
          .sr-signatures { gap: 2mm !important; margin-top: 2mm !important; padding-top: 2mm !important; }
          .sr-sig-card { padding: 1.5mm !important; }
          .sr-sig-title { margin-bottom: 1.5mm !important; font-size: 9px !important; }
          .sr-sig-name { margin-bottom: 1mm !important; font-size: 8.5px !important; }
          .sr-sig-image img { max-height: 12mm !important; max-width: 36mm !important; }
          .sr-sig-image span { font-size: 8px !important; }
          .sr-footer { margin-top: 2mm !important; padding-top: 1.5mm !important; font-size: 8px !important; }
          .sr-doc { border: 1px solid #cbd5e1 !important; border-top: 3px solid #163a5f !important; border-radius: 2px !important; }
          .sr-header { border-bottom-color: #163a5f !important; }
          .sr-brand-name { color: #0f2942 !important; }
          .sr-brand-en, .sr-doc-title { color: #163a5f !important; }
          .sr-doc-title-en { margin-top: .3mm !important; color: #64748b !important; font-size: 7px !important; font-weight: 800 !important; letter-spacing: .7px !important; direction: ltr !important; }
          .sr-form-badge { color: #163a5f !important; background: #f1f5f9 !important; border-color: #cbd5e1 !important; border-radius: 2px !important; }
          .sr-info-cell { background: #f8fafc !important; border-color: #e2e8f0 !important; border-radius: 2px !important; border-top: 2px solid #163a5f !important; }
          .sr-info-label { color: #64748b !important; }
          .sr-info-value { color: #0f2942 !important; }
          .sr-table th { color: #fff !important; background: #163a5f !important; border-color: #163a5f !important; }
          .sr-table td { border-color: #cbd5e1 !important; }
          .sr-table tbody tr:nth-child(even) td { background: #f8fafc !important; }
          .sr-totals-row td { color: #0f2942 !important; background: #e8eef5 !important; border-top: 2px solid #163a5f !important; }
          .sr-notes { background: #f8fafc !important; border-color: #cbd5e1 !important; border-inline-start: 3px solid #163a5f !important; border-radius: 2px !important; }
          .sr-signatures { border-top-color: #163a5f !important; }
          .sr-sig-card { border-color: #e2e8f0 !important; border-radius: 2px !important; }
          .sr-sig-title { color: #0f2942 !important; }
          .sr-footer { color: #64748b !important; border-top-color: #cbd5e1 !important; }
        }
      `}</style>
    </div>
  );
}

export default ScaleReceiptPage;
