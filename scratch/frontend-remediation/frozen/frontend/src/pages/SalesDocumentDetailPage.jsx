/**
 * Read-only document detail, shared by Customization (Sales Quotations) and
 * Delivery (Sales Orders). Only the field labels and the fetcher differ.
 *
 * `dateFields` entries are `{ field, labelKey }`:
 *   field    - the normalized record key to read (snake_case, e.g. `valid_until`)
 *   labelKey - the i18n key under `customizationDelivery.columns` (camelCase,
 *              e.g. `validUntil`)
 * These are deliberately kept separate. Deriving the label from the field name
 * renders a raw translation key whenever the two naming styles differ.
 *
 * Values that SAP did not return render as an em dash rather than a placeholder
 * guess, so a blank cell always means "SAP has no value here".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import PageHeader from '../components/ui/PageHeader';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { formatQuantity } from './SalesDocumentListPage';
import { getProductIcon } from '../utils/productIcon';

function Field({ label, value, icon }) {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className="cd-field-item">
      <span className="cd-field-label">
        {icon && <span className="meta-label-icon" aria-hidden="true">{icon}</span>}
        {label}
      </span>
      <span className="cd-field-value">{display}</span>
    </div>
  );
}
export default function SalesDocumentDetailPage({
  title,
  backPath,
  fetcher,
  dateFields,
  renderWorkflow,
}) {
  const { t, lang } = useI18n();
  const { docEntry } = useParams();
  const navigate = useNavigate();

  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDocument(await fetcher(docEntry));
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('common.error'));
      setDocument(null);
    } finally {
      setLoading(false);
    }
  }, [docEntry, fetcher, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="home-page cd-detail-page">
      <PageHeader
        title={document?.document_number || title}
        description={t('customizationDelivery.detailSubtitle')}
        actions={
          <button
            type="button"
            className="app-button app-button--ghost"
            onClick={() => navigate(backPath)}
          >
            {t('common.back')}
          </button>
        }
      />

      {error && (
        <div className="cd-error" role="alert">
          <span>{error}</span>
          <button type="button" className="app-button app-button--ghost" onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : document ? (
        <>
          <section className="card-panel cd-section">
            <h2 className="cd-section__title">{t('customizationDelivery.section.summary')}</h2>
            <div className="cd-field-grid">
              <Field
                icon="🔢"
                label={t('customizationDelivery.columns.documentNumber')}
                value={document.document_number}
              />
              <Field
                icon="🏢"
                label={t('customizationDelivery.columns.customer')}
                value={
                  document.customer_name
                    ? `${document.customer_name}${document.customer_code ? ` (${document.customer_code})` : ''}`
                    : document.customer_code
                }
              />
              <Field
                icon="✅"
                label={t('customizationDelivery.columns.status')}
                value={document.status_label || document.status_code}
              />
              <Field
                icon="💰"
                label={t('customizationDelivery.columns.currency')}
                value={document.currency}
              />
              {dateFields.map(({ field, labelKey }) => (
                <Field
                  key={field}
                  icon="📅"
                  label={t(`customizationDelivery.columns.${labelKey}`)}
                  value={document[field]}
                />
              ))}
              {document.remarks && (
                <Field
                  icon="📝"
                  label={lang === 'ar' ? 'ملاحظات' : 'Remarks'}
                  value={document.remarks}
                />
              )}
              {document.lines?.find((l) => l.base_type === 23 && l.base_entry) && (
                <div className="cd-field-item">
                  <span className="cd-field-label">
                    <span className="meta-label-icon" aria-hidden="true">🔗</span>
                    {t('customizationDelivery.workflow.sourceQuotation')}
                  </span>
                  <span className="cd-field-value">
                    <button
                      type="button"
                      className="app-button app-button--secondary"
                      style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                      onClick={() =>
                        navigate(
                          `/customization-delivery/customization/documents/${
                            document.lines.find((l) => l.base_type === 23 && l.base_entry).base_entry
                          }`
                        )
                      }
                    >
                      #{document.lines.find((l) => l.base_type === 23 && l.base_entry).base_entry} (
                      {t('customizationDelivery.workflow.viewQuotation')} →)
                    </button>
                  </span>
                </div>
              )}
            </div>
          </section>

          {renderWorkflow && renderWorkflow({ document, onRefresh: load })}

          <section className="card-panel cd-section">
            <h2 className="cd-section__title">
              {t('customizationDelivery.section.items')}
              <span className="cd-count">{document.line_count || 0}</span>
            </h2>

            {(document.lines || []).length === 0 ? (
              <p className="cd-muted">{t('customizationDelivery.noItems')}</p>
            ) : (
              <div className="cd-table-wrap">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>{t('customizationDelivery.columns.line')}</th>
                      <th>{t('customizationDelivery.columns.item')}</th>
                      <th>{t('customizationDelivery.columns.description')}</th>
                      <th>{t('customizationDelivery.columns.quantity')}</th>
                      {(document.section === 'delivery' || document.lines.some((l) => l.delivered_quantity !== null)) && (
                        <th>{t('customizationDelivery.workflow.deliveredQty')}</th>
                      )}
                      {(document.section === 'delivery' || document.lines.some((l) => l.remaining_open_quantity !== null)) && (
                        <th>{t('customizationDelivery.workflow.openQty')}</th>
                      )}
                      {document.lines.some((l) => l.line_status) && (
                        <th>{t('customizationDelivery.workflow.lineStatus')}</th>
                      )}
                      <th>{t('customizationDelivery.columns.unit')}</th>
                      <th>{t('customizationDelivery.columns.warehouse')}</th>
                      <th>{t('customizationDelivery.columns.location')}</th>
                      <th>{t('customizationDelivery.columns.unitPrice')}</th>
                      <th>{lang === 'ar' ? 'رمز الضريبة' : 'Tax Code'}</th>
                      <th>{t('customizationDelivery.columns.lineTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.lines.map((line, index) => (
                      <tr key={`${line.line_number}-${line.item_code}-${index}`}>
                        <td>{line.line_number !== null ? line.line_number + 1 : '—'}</td>
                        <td className="cd-strong">{line.item_code || '—'}</td>
                        <td>
                          <span className="meta-label-icon" aria-hidden="true">{getProductIcon(line.item_description || line.free_text || line.item_code)}</span>{' '}
                          {line.item_description || line.free_text || '—'}
                        </td>
                        <td>{formatQuantity(line.quantity)}</td>
                        {(document.section === 'delivery' || document.lines.some((l) => l.delivered_quantity !== null)) && (
                          <td>{formatQuantity(line.delivered_quantity)}</td>
                        )}
                        {(document.section === 'delivery' || document.lines.some((l) => l.remaining_open_quantity !== null)) && (
                          <td className={Number(line.remaining_open_quantity) > 0 ? 'cd-strong' : ''}>
                            {formatQuantity(line.remaining_open_quantity)}
                          </td>
                        )}
                        {document.lines.some((l) => l.line_status) && (
                          <td>
                            <span
                              className={`cd-status ${
                                line.line_status === 'bost_Open' ? 'cd-status--open' : 'cd-status--closed'
                              }`}
                            >
                              {line.line_status === 'bost_Open'
                                ? t('customizationDelivery.workflow.statusOpen')
                                : t('customizationDelivery.workflow.statusClosed')}
                            </span>
                          </td>
                        )}
                        <td>{line.uom || '—'}</td>
                        <td>{line.warehouse_code || '—'}</td>
                        <td>{line.location_code || '—'}</td>
                        <td>{formatQuantity(line.unit_price)}</td>
                        <td>{line.tax_code || '—'}</td>
                        <td>{formatQuantity(line.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!renderWorkflow && <p className="cd-readonly-note">{t('customizationDelivery.workflowGuidanceNote')}</p>}
        </>
      ) : null}
    </div>
  );
}
