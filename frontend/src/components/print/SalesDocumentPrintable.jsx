import React from 'react';
import egastLogo from '../../assets/logos/egast-logo.png';

function PrintHeader({ title, subtitle }) {
  return (
    <>
      <div className="report-print-logo-row delivery-print-header">
        <div className="report-header-brand">
          <img src={egastLogo} alt="EGAST Group" className="report-header-logo" />
          <div className="report-header-text">
            <h2>الشركة المصرية للخدمات الزراعية (إيجاست)</h2>
            <p>EGAST SALES &amp; DISTRIBUTION OPERATIONS</p>
          </div>
        </div>
      </div>
      <div className="report-main-title delivery-print-title">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
    </>
  );
}

function Section({ title, headers, rows }) {
  return (
    <section className="delivery-print-section">
      <h2 className="report-section-header">{title}</h2>
      <table className="delivery-print-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Footer({ generatedAt, t }) {
  return (
    <footer className="report-print-footer delivery-print-footer">
      {t('customizationDelivery.reportGeneratedAt')}: {generatedAt}
    </footer>
  );
}

export default function SalesDocumentPrintable({ document, generatedAt, t }) {
  if (!document) return null;

  const {
    documentType, // 'QUOTATION' | 'SALES_ORDER' | 'DELIVERY'
    docNum,
    docEntry,
    customerName,
    customerCode,
    docDate,
    dueDate,
    currency,
    remarks,
    baseDocumentNum,
    lines = [],
    totalAmount,
    totalQuantity,
  } = document;

  const isQuotation = documentType === 'QUOTATION';
  const isOrder = documentType === 'SALES_ORDER';

  const docTitle = isQuotation
    ? (t('customizationDelivery.quotationDocument') || 'عرض سعر المبيعات')
    : isOrder
    ? (t('customizationDelivery.salesOrderDocument') || 'أمر بيع المبيعات')
    : (t('customizationDelivery.deliveryDocument') || 'مستند التسليم');

  const headers = [
    '#',
    t('customizationDelivery.item') || 'الصنف',
    t('customizationDelivery.quantity') || 'الكمية',
    t('customizationDelivery.uom') || 'الوحدة',
    t('customizationDelivery.columns.warehouse'),
    t('customizationDelivery.unitPrice') || 'سعر الوحدة',
    t('customizationDelivery.lineTotal') || 'الإجمالي',
  ];

  const rows = lines.map((line, idx) => {
    const qty = Number(line.quantity ?? line.customized_quantity ?? line.delivery_quantity ?? 0);
    const unitPrice = Number(line.unit_price ?? line.customized_unit_price ?? 0);
    const lineTotal = Number(line.line_total ?? qty * unitPrice * (1 - Number(line.discount_percent || 0) / 100));

    return [
      idx + 1,
      `${line.item_code || ''} - ${line.item_description || line.item_code || ''}`,
      qty.toLocaleString(),
      line.uom || 'Unit',
      line.warehouse_code || '—',
      line.unit_price != null || line.customized_unit_price != null ? `${unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}` : '—',
      line.line_total != null || line.unit_price != null || line.customized_unit_price != null ? `${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}` : '—',
    ];
  });

  return (
    <div className="a4-print-sheet quality-print-sheet delivery-print-sheet" data-print-document-number={docNum || ''}>
      <PrintHeader title={docTitle} subtitle={`#${docNum || '—'}`} />
      
      <div className="report-info-grid delivery-print-identity">
        <div className="info-cell">
          <span className="cell-lbl">
            {t('customizationDelivery.columns.documentNumber')}
          </span>
          <strong>#{docNum || '—'}</strong>
        </div>
        <div className="info-cell">
          <span className="cell-lbl">SAP DocEntry</span>
          <strong>{docEntry}</strong>
        </div>
        <div className="info-cell">
          <span className="cell-lbl">{t('customizationDelivery.columns.currency')}</span>
          <strong>{currency || '—'}</strong>
        </div>
        {baseDocumentNum && (
          <div className="info-cell">
            <span className="cell-lbl">
              {isOrder ? t('customizationDelivery.workflow.sourceQuotation') : t('customizationDelivery.sourceSalesOrder')}
            </span>
            <strong>#{baseDocumentNum}</strong>
          </div>
        )}
        <div className="info-cell">
          <span className="cell-lbl">{t('customizationDelivery.customer')}</span>
          <strong>{customerName || customerCode || '—'}</strong>
        </div>
        <div className="info-cell">
          <span className="cell-lbl">
            {t('customizationDelivery.columns.documentDate')}
          </span>
          <strong>{docDate || '—'}</strong>
        </div>
        {dueDate && (
          <div className="info-cell">
            <span className="cell-lbl">
              {t('customizationDelivery.columns.dueDate')}
            </span>
            <strong>{dueDate}</strong>
          </div>
        )}
        {totalQuantity !== undefined && totalQuantity !== null && (
          <div className="info-cell">
            <span className="cell-lbl">{t('customizationDelivery.printTotalQuantity')}</span>
            <strong>{Number(totalQuantity).toLocaleString()}</strong>
          </div>
        )}
        {totalAmount !== undefined && totalAmount !== null && Number(totalAmount) > 0 && (
          <div className="info-cell">
            <span className="cell-lbl">{t('customizationDelivery.printTotalAmount')}</span>
            <strong>{Number(totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency || ''}</strong>
          </div>
        )}
      </div>

      {remarks && (
        <div className="delivery-print-note" style={{ marginBottom: '12px' }}>
          <strong>{t('customizationDelivery.workflow.notes')}:</strong> {remarks}
        </div>
      )}

      <Section
        title={t('customizationDelivery.printLineDetails')}
        headers={headers}
        rows={rows}
      />

      <div className="delivery-print-note">
        {t('customizationDelivery.printSapCreated')}
      </div>

      <Footer generatedAt={generatedAt} t={t} />
    </div>
  );
}
