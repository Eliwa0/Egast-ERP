import { PrintActionButton } from '../../../components/ui/ActionIconButton';
import React, { useState } from 'react';
import { useI18n } from '../../../contexts/I18nContext';
import { useToast } from '../../../components/ui/ToastProvider';
import SignaturePad from './SignaturePad';
import ScaleGatePermitPrint from './ScaleGatePermitPrint';
import scaleApi from '../services/scaleApi';

let idCounter = 0;
const uid = () => `row-${Date.now()}-${idCounter++}`;

const todayISO = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

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

const emptyForm = (type) => ({
  permit_number: '',
  permit_type: type,
  permit_date: todayISO(),
  supplier_name: '',
  buyer_name: '',
  driver_name: '',
  destination: '',
  vehicle_number: '',
  inspection_result: '',
  gate_writer: '',
  inspection_head: '',
  gross_weight_kg: '',
  tare_weight_kg: '',
  net_weight_kg: '',
  scale_operator: '',
  general_manager: '',
  responsible_person: '',
  department_manager: '',
  weight_in_words: '',
  notes: '',
  items: [
    { key: uid(), item_code: '', item_name: '', count: '1', quantity_kg: '0', notes: '' },
  ],
  gate_writer_signature: '',
  inspection_head_signature: '',
  scale_operator_signature: '',
  general_manager_signature: '',
  responsible_signature: '',
  department_manager_signature: '',
});

export function ScaleGatePermitForm({ type }) {
  const { t } = useI18n();
  const toast = useToast();
  const isEntry = type === 'entry';

  const [form, setForm] = useState(() => emptyForm(type));
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
      items: [...current.items, { key: uid(), item_code: '', item_name: '', count: '1', quantity_kg: '0', notes: '' }],
    }));
  };

  const removeRow = (key) => {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((item) => item.key !== key) : current.items,
    }));
  };

  const grossKg = Number(form.gross_weight_kg) || 0;
  const tareKg = Number(form.tare_weight_kg) || 0;
  const netKg = grossKg - tareKg;
  const displayNet = form.gross_weight_kg !== '' && Number(form.gross_weight_kg) >= 0 && grossKg >= tareKg;

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
          notes: item.notes.trim(),
        };
      })
      .filter((item) => item.item_name || item.item_code || item.quantity_kg > 0);

    const common = {
      permit_type: formData.permit_type,
      permit_date: formData.permit_date || todayISO(),
      driver_name: formData.driver_name.trim(),
      vehicle_number: formData.vehicle_number.trim(),
      weight_in_words: formData.weight_in_words.trim(),
      notes: formData.notes.trim(),
      items,
      general_manager: formData.general_manager.trim(),
      general_manager_signature: formData.general_manager_signature || '',
    };

    if (isEntry) {
      const gross = Number(formData.gross_weight_kg);
      const tare = Number(formData.tare_weight_kg);
      return {
        ...common,
        supplier_name: formData.supplier_name.trim(),
        inspection_result: formData.inspection_result.trim(),
        gate_writer: formData.gate_writer.trim(),
        inspection_head: formData.inspection_head.trim(),
        gross_weight_kg: formData.gross_weight_kg === '' ? null : gross,
        tare_weight_kg: formData.tare_weight_kg === '' ? null : tare,
        net_weight_kg: gross >= tare && formData.gross_weight_kg !== '' ? Number((gross - tare).toFixed(2)) : null,
        scale_operator: formData.scale_operator.trim(),
        gate_writer_signature: formData.gate_writer_signature || '',
        inspection_head_signature: formData.inspection_head_signature || '',
        scale_operator_signature: formData.scale_operator_signature || '',
      };
    }

    return {
      ...common,
      buyer_name: formData.buyer_name.trim(),
      destination: formData.destination.trim(),
      responsible_person: formData.responsible_person.trim(),
      department_manager: formData.department_manager.trim(),
      responsible_signature: formData.responsible_signature || '',
      department_manager_signature: formData.department_manager_signature || '',
    };
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = buildPayload(form);
      const wasSaved = Boolean(savedId);
      const res = wasSaved
        ? await scaleApi.updateEntryExitPermit(savedId, payload)
        : await scaleApi.createEntryExitPermit(payload);
      setSavedId(res.data.id);
      setForm((current) => ({ ...current, permit_number: res.data.permit_number }));
      toast.success(wasSaved ? t('scale.permitUpdatedSuccess') : t('scale.permitSavedSuccess'));
      return res.data;
    } catch (err) {
      const errors = err?.response?.data?.errors;
      toast.error(errors ? JSON.stringify(errors) : err?.response?.data?.error || err.message);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    const dirty = form.vehicle_number || form.driver_name || form.supplier_name || form.buyer_name || form.items.some(
      (item) => item.item_name || item.item_code || Number(item.quantity_kg) > 0
    );
    if (dirty && !window.confirm(t('scale.confirmClearPermit'))) return;
    setSavedId(null);
    setForm(emptyForm(type));
  };

  const totalKg = form.items.reduce((sum, item) => sum + (Number(item.quantity_kg) || 0), 0);
  const totalTon = totalKg / 1000;

  const headerFields = isEntry
    ? [
        { label: t('scale.permitDate'), children: (
          <input className="app-input" type="date" value={form.permit_date} onChange={(event) => setField('permit_date', event.target.value)} />
        ) },
        { label: t('scale.supplierName'), children: (
          <input className="app-input" value={form.supplier_name} onChange={(event) => setField('supplier_name', event.target.value)} />
        ) },
        { label: t('scale.permitDriverName'), children: (
          <input className="app-input" value={form.driver_name} onChange={(event) => setField('driver_name', event.target.value)} />
        ) },
        { label: t('scale.vehicleNumber'), children: (
          <input className="app-input" value={form.vehicle_number} onChange={(event) => setField('vehicle_number', event.target.value)} />
        ) },
      ]
    : [
        { label: t('scale.permitDate'), children: (
          <input className="app-input" type="date" value={form.permit_date} onChange={(event) => setField('permit_date', event.target.value)} />
        ) },
        { label: t('scale.buyerName'), children: (
          <input className="app-input" value={form.buyer_name} onChange={(event) => setField('buyer_name', event.target.value)} />
        ) },
        { label: t('scale.destination'), children: (
          <input className="app-input" value={form.destination} onChange={(event) => setField('destination', event.target.value)} />
        ) },
        { label: t('scale.permitDriverName'), children: (
          <input className="app-input" value={form.driver_name} onChange={(event) => setField('driver_name', event.target.value)} />
        ) },
        { label: t('scale.vehicleNumber'), children: (
          <input className="app-input" value={form.vehicle_number} onChange={(event) => setField('vehicle_number', event.target.value)} />
        ) },
      ];

  const entryInspectionFields = [
    { label: t('scale.gateWriter'), children: (
      <input className="app-input" value={form.gate_writer} onChange={(event) => setField('gate_writer', event.target.value)} />
    ) },
    { label: t('scale.inspectionHead'), children: (
      <input className="app-input" value={form.inspection_head} onChange={(event) => setField('inspection_head', event.target.value)} />
    ) },
  ];

  const entryWeighingFields = [
    {
      label: t('scale.grossWeight'),
      children: (
        <input
          className="app-input pe-num-input"
          type="number"
          min="0"
          step="0.01"
          value={form.gross_weight_kg}
          onChange={(event) => setField('gross_weight_kg', sanitizeNumeric(event.target.value))}
        />
      ),
    },
    {
      label: t('scale.tareWeight'),
      children: (
        <input
          className="app-input pe-num-input"
          type="number"
          min="0"
          step="0.01"
          value={form.tare_weight_kg}
          onChange={(event) => setField('tare_weight_kg', sanitizeNumeric(event.target.value))}
        />
      ),
    },
    {
      label: `${t('scale.netWeight')} (${t('scale.kgLabel')})`,
      children: (
        <input className="app-input pe-num-input pe-readonly" readOnly value={displayNet ? formatNumber(netKg) : ''} />
      ),
    },
    {
      label: `${t('scale.netWeight')} (${t('scale.tonLabel')})`,
      children: (
        <input className="app-input pe-num-input pe-readonly" readOnly value={displayNet ? formatNumber(netKg / 1000, 3) : ''} />
      ),
    },
  ];

  const signatureCards = isEntry
    ? [
        { key: 'gate_writer', title: t('scale.gateWriter'), name: form.gate_writer, signature: form.gate_writer_signature, nameField: 'gate_writer', sigField: 'gate_writer_signature' },
        { key: 'inspection_head', title: t('scale.inspectionHead'), name: form.inspection_head, signature: form.inspection_head_signature, nameField: 'inspection_head', sigField: 'inspection_head_signature' },
        { key: 'scale_operator', title: t('scale.scaleOperator'), name: form.scale_operator, signature: form.scale_operator_signature, nameField: 'scale_operator', sigField: 'scale_operator_signature' },
        { key: 'general_manager', title: t('scale.generalManager'), name: form.general_manager, signature: form.general_manager_signature, nameField: 'general_manager', sigField: 'general_manager_signature' },
      ]
    : [
        { key: 'responsible', title: t('scale.responsiblePerson'), name: form.responsible_person, signature: form.responsible_signature, nameField: 'responsible_person', sigField: 'responsible_signature' },
        { key: 'department', title: t('scale.departmentManager'), name: form.department_manager, signature: form.department_manager_signature, nameField: 'department_manager', sigField: 'department_manager_signature' },
        { key: 'general_manager', title: t('scale.generalManager'), name: form.general_manager, signature: form.general_manager_signature, nameField: 'general_manager', sigField: 'general_manager_signature' },
      ];

  return (
    <div className="scale-permit-form">
      <div className="pe-toolbar">
        <button type="button" className="app-button app-button--primary" disabled={isSaving} onClick={handleSave}>
          {isSaving ? '...' : `💾 ${t('scale.savePermit')}`}
        </button>
        <PrintActionButton icon="🖨️" disabled={isSaving} onClick={() => window.print()}/>
        <button type="button" className="app-button" onClick={handleClear}>
          {t('scale.clearPermit')}
        </button>
        {form.permit_number && <span className="pe-permit-number">{form.permit_number}</span>}
      </div>

      <div className="card-panel pe-sheet">
        <div className="pe-head">
          {headerFields.map((field, index) => (
            <div key={index} className="form-field">
              <label>{field.label}</label>
              {field.children}
            </div>
          ))}
        </div>

        <div className="pe-section-head">
          <h2>{t('scale.productsTable')}</h2>
          <button type="button" className="app-button app-button--primary app-button--sm" onClick={addRow}>
            ＋ {t('scale.addRow')}
          </button>
        </div>

        <div className="pe-table-scroll">
          <table className="pe-edit-table">
            <thead>
              <tr>
                <th>{t('scale.itemCode')}</th>
                <th>{t('scale.itemName')}</th>
                <th>{t('scale.count')}</th>
                <th>{isEntry ? t('scale.recordKg') : t('scale.weightKg')}</th>
                <th>{t('scale.tonLabel')}</th>
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
                      className="app-input pe-num-input"
                      type="number"
                      min="0"
                      value={item.count}
                      onChange={(event) => handleItemChange(item.key, 'count', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input pe-num-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.quantity_kg}
                      onChange={(event) => handleItemChange(item.key, 'quantity_kg', event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="app-input pe-num-input pe-readonly"
                      readOnly
                      value={formatNumber((Number(item.quantity_kg) || 0) / 1000, 3)}
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
                      className="pe-remove-btn"
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
                <td colSpan="3" className="pe-total-label">{t('scale.totalKg')}</td>
                <td className="pe-total-value">{formatNumber(totalKg)}</td>
                <td className="pe-total-value">{formatNumber(totalTon, 3)}</td>
                <td colSpan="2" />
              </tr>
            </tfoot>
          </table>
        </div>

        {isEntry && (
          <>
            <div className="pe-detail-grid">
              <div className="pe-detail-card card-panel">
                <h3 className="pe-detail-title">{t('scale.inspectionSection')}</h3>
                <div className="pe-detail-fields">
                  {entryInspectionFields.map((field, index) => (
                    <div key={index} className="form-field">
                      <label>{field.label}</label>
                      {field.children}
                    </div>
                  ))}
                  <div className="form-field pe-full">
                    <label>{t('scale.inspectionResult')}</label>
                    <textarea
                      className="app-input"
                      rows="2"
                      value={form.inspection_result}
                      onChange={(event) => setField('inspection_result', event.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="pe-detail-card card-panel">
                <h3 className="pe-detail-title">{t('scale.weighingSection')}</h3>
                <div className="pe-detail-fields">
                  {entryWeighingFields.map((field, index) => (
                    <div key={index} className="form-field">
                      <label>{field.label}</label>
                      {field.children}
                    </div>
                  ))}
                  <div className="form-field pe-full">
                    <label>{t('scale.onlyAndAmount')}</label>
                    <input
                      className="app-input"
                      value={form.weight_in_words}
                      onChange={(event) => setField('weight_in_words', event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pe-detail-card card-panel pe-notes-card">
              <div className="form-field pe-notes-field">
                <label>{t('scale.notes')}</label>
                <textarea
                  className="app-input"
                  rows="2"
                  value={form.notes}
                  onChange={(event) => setField('notes', event.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {!isEntry && (
          <div className="pe-detail-card card-panel pe-notes-card">
            <div className="pe-notes-grid">
              <div className="form-field">
                <label>{t('scale.onlyAndAmount')}</label>
                <input
                  className="app-input"
                  value={form.weight_in_words}
                  onChange={(event) => setField('weight_in_words', event.target.value)}
                />
              </div>
              <div className="form-field">
                <label>{t('scale.notes')}</label>
                <textarea
                  className="app-input"
                  rows="1"
                  value={form.notes}
                  onChange={(event) => setField('notes', event.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="pe-signatures-edit">
          {signatureCards.map((card) => (
            <div key={card.key} className="pe-sig-edit-card card-panel">
              <div className="pe-sig-edit-title">{card.title}</div>
              <div className="form-field">
                <label>{t('scale.signatureName')}</label>
                <input
                  className="app-input"
                  value={card.name}
                  onChange={(event) => setField(card.nameField, event.target.value)}
                />
              </div>
              <div className="form-field">
                <label>{t('scale.signatureDraw')}</label>
                <SignaturePad
                  value={card.signature}
                  onChange={(value) => setField(card.sigField, value || '')}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <ScaleGatePermitPrint type={type} form={form} />

      <style>{`
        .scale-permit-page {
          width: min(1100px, 100%);
          margin: 0 auto;
          padding-bottom: 32px;
        }
        .scale-permit-page .page-header {
          margin: 0 0 14px;
        }
        .scale-permit-form { }
        .pe-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          margin: 0 auto 14px;
          width: min(1100px, 100%);
        }
        .pe-toolbar .app-button { min-height: 40px; }
        .pe-permit-number {
          margin-inline-start: auto;
          font-weight: 800;
          color: var(--color-primary);
          background: var(--color-primary-soft);
          border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
          border-radius: var(--radius-sm);
          padding: 4px 12px;
        }
        .pe-sheet {
          width: min(1100px, 100%);
          margin: 0 auto;
          padding: 18px 24px;
        }
        .pe-head {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }
        .pe-head .form-field { margin-bottom: 0; }
        .pe-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .pe-section-head h2 { margin: 0; font-size: 1.1rem; color: var(--color-text); }
        .pe-table-scroll { overflow-x: auto; margin-bottom: 12px; }
        .pe-edit-table { width: 100%; min-width: 760px; border-collapse: collapse; }
        .pe-edit-table th {
          background: var(--bg-muted);
          color: var(--color-text-muted);
          text-align: start;
          padding: 8px 10px;
          font-size: 0.84rem;
          border: 1px solid var(--color-border);
        }
        .pe-edit-table td {
          padding: 6px 8px;
          border: 1px solid var(--color-border);
          vertical-align: middle;
        }
        .pe-edit-table .app-input { min-width: 0; width: 100%; padding: 6px 8px; }
        .pe-num-input { text-align: end; direction: ltr; }
        .pe-readonly { background: var(--bg-muted); color: var(--color-text-muted); }
        .pe-remove-btn {
          width: 28px;
          height: 28px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--danger, #dc2626);
          cursor: pointer;
          font-size: 13px;
        }
        .pe-remove-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pe-edit-table tfoot td {
          background: var(--bg-muted);
          font-weight: 800;
          font-size: 0.9rem;
        }
        .pe-total-label { color: var(--color-text-muted); }
        .pe-total-value { text-align: end; direction: ltr; white-space: nowrap; }
        .pe-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 14px;
        }
        .pe-detail-card { padding: 14px 16px; margin-bottom: 14px; }
        .pe-detail-grid .pe-detail-card { margin-bottom: 0; }
        .pe-detail-title {
          font-weight: 800;
          color: var(--color-text);
          margin: 0 0 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
          font-size: 1rem;
        }
        .pe-detail-fields {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px 12px;
        }
        .pe-detail-fields .form-field { margin-bottom: 0; }
        .pe-detail-fields .pe-full { grid-column: 1 / -1; }
        .pe-full textarea { resize: vertical; min-height: 54px; }
        .pe-notes-card { margin-bottom: 14px; }
        .pe-notes-field { margin-bottom: 0; }
        .pe-notes-field textarea { resize: vertical; min-height: 54px; }
        .pe-notes-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .pe-notes-grid .form-field { margin-bottom: 0; }
        .pe-signatures-edit {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .pe-sig-edit-card { padding: 14px 16px; }
        .pe-sig-edit-card .form-field { margin-bottom: 10px; }
        .pe-sig-edit-title {
          font-weight: 800;
          color: var(--color-text);
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
        }
        .signature-pad { position: relative; }
        .signature-pad__canvas {
          width: 100%;
          border: 1px dashed var(--color-border);
          border-radius: var(--radius-sm);
          background: var(--color-surface);
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
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
          background: var(--color-surface-muted);
          color: var(--color-text-muted);
          cursor: pointer;
        }

        @media (max-width: 980px) {
          .pe-signatures-edit { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .pe-detail-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 680px) {
          .pe-sheet { padding: 16px 14px; }
          .pe-signatures-edit { grid-template-columns: 1fr; }
          .pe-notes-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

export default ScaleGatePermitForm;