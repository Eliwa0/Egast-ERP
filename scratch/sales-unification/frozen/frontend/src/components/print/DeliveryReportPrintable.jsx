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
            <p>EGAST SALES &amp; DELIVERY OPERATIONS</p>
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
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </section>
  );
}

function Footer({ generatedAt, t }) {
  return <footer className="report-print-footer delivery-print-footer">{t('customizationDelivery.reportGeneratedAt')}: {generatedAt}</footer>;
}

export default function DeliveryReportPrintable({ report, filters, filterLabels, delivery, generatedAt, t }) {
  if (delivery) {
    const { draft, date, quantity } = delivery;
    return (
      <div className="a4-print-sheet quality-print-sheet delivery-print-sheet">
        <PrintHeader title={t('customizationDelivery.deliveryDocument')} subtitle={`#${draft.sap_doc_num}`} />
        <div className="report-info-grid delivery-print-identity">
          <div className="info-cell"><span className="cell-lbl">{t('customizationDelivery.deliveryNumber')}</span><strong>#{draft.sap_doc_num}</strong></div>
          <div className="info-cell"><span className="cell-lbl">{t('customizationDelivery.deliveryDocEntry')}</span><strong>{draft.sap_doc_entry}</strong></div>
          <div className="info-cell"><span className="cell-lbl">{t('customizationDelivery.sourceSalesOrder')}</span><strong>#{draft.sales_order_doc_num}</strong></div>
          <div className="info-cell"><span className="cell-lbl">{t('customizationDelivery.customer')}</span><strong>{draft.customer_name || draft.customer_code}</strong></div>
          <div className="info-cell"><span className="cell-lbl">{t('customizationDelivery.deliveryDate')}</span><strong>{date}</strong></div>
          <div className="info-cell"><span className="cell-lbl">{t('customizationDelivery.deliveredQuantity')}</span><strong>{quantity.toLocaleString()}</strong></div>
        </div>
        <Section title={t('customizationDelivery.deliveryDetails')} headers={[t('customizationDelivery.item'), t('customizationDelivery.deliveredQuantity'), t('customizationDelivery.uom')]} rows={(draft.lines || []).map((line) => [line.item_description || line.item_code, Number(line.delivery_quantity || 0).toLocaleString(), line.uom || '—'])} />
        <div className="delivery-print-note"><strong>{t('customizationDelivery.deliveryStatus')}:</strong> {t('customizationDelivery.deliveryCreated')}</div>
        <Footer generatedAt={generatedAt} t={t} />
      </div>
    );
  }

  const selectedCriteria = Object.entries(filters)
    .filter(([, value]) => value)
    .map(([key, value]) => ({ label: t(`customizationDelivery.filter_${key}`), value: filterLabels[key] || value }));

  return (
      <div className="a4-print-sheet quality-print-sheet delivery-print-sheet delivery-print-report">
        <PrintHeader title={t('customizationDelivery.deliveryReport')} subtitle="DELIVERY REPORT" />
        {selectedCriteria.length > 0 && (
          <div className="delivery-print-scope">
            {selectedCriteria.map(({ label, value }) => <span key={label}><strong>{label}:</strong> {value}</span>)}
          </div>
        )}
        <section className="delivery-print-section">
          <h2 className="report-section-header">{t('customizationDelivery.deliverySummary')}</h2>
          <div className="report-kpi-row delivery-print-kpis">
            {[
              ['deliveries', report.summary.deliveries], ['quantity', report.summary.quantity.toLocaleString()],
              ['customers', report.summary.customers], ['salesOrders', report.summary.salesOrders], ['items', report.summary.items],
            ].map(([key, value]) => <div className="kpi-mini-box" key={key}><span className="kpi-lbl">{t(`customizationDelivery.summary_${key}`)}</span><strong>{value}</strong></div>)}
          </div>
        </section>
        <Section title={t('customizationDelivery.deliveryDetails')} headers={[t('customizationDelivery.deliveryNumber'), t('customizationDelivery.sourceSalesOrder'), t('customizationDelivery.customer'), t('customizationDelivery.item'), t('customizationDelivery.deliveredQuantity'), t('customizationDelivery.deliveryDate')]} rows={report.details.map(({ draft, date, items, quantity }) => [`#${draft.sap_doc_num}`, `#${draft.sales_order_doc_num}`, draft.customer_name || draft.customer_code, items, quantity.toLocaleString(), date])} />
        {report.byItem.length > 0 && <Section title={t('customizationDelivery.byItem')} headers={[t('customizationDelivery.item'), t('customizationDelivery.summary_quantity')]} rows={report.byItem.map((group) => [group.label, group.quantity.toLocaleString()])} />}
        <Footer generatedAt={generatedAt} t={t} />
      </div>
  );
}
