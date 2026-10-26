import React, { useMemo } from 'react';
import egastLogo from '../../assets/logos/egast-logo.png';
import { createPrintDocumentBarcodeIdentification } from '../../utils/shippingReceivingPrintIdentifiers';
import PrintDocumentBarcode from './PrintDocumentBarcode';

function QualityPrintHeader({ reportNumber, review = false }) {
  const arabicTitle = review ? 'تقرير مراجعة الجودة' : 'تقرير فحص الجودة';
  const englishTitle = review ? 'QUALITY REVIEW REPORT' : 'QUALITY INSPECTION REPORT';
  const badge = review ? 'مراجعة جودة معتمدة' : 'فحص جودة معتمد';
  const barcodeIdentification = useMemo(
    () => createPrintDocumentBarcodeIdentification(reportNumber),
    [reportNumber],
  );

  return (
    <>
      <div className="report-print-logo-row quality-print-header">
        <div className="report-header-brand">
          <img src={egastLogo} alt="EGAST Group" className="report-header-logo" />
          <div className="report-header-text">
            <h2>الشركة المصرية للخدمات الزراعية (إيجاست)</h2>
            <p>EGAST QUALITY ASSURANCE</p>
          </div>
        </div>
        <div className="report-doc-no quality-report-identity">
          <span className="report-badge">{badge}</span>
          <PrintDocumentBarcode
            identification={barcodeIdentification}
            label="رقم التقرير · REPORT NO."
          />
        </div>
      </div>

      <div className="report-main-title quality-report-title">
        <h1>{arabicTitle}</h1>
        <span>{englishTitle}</span>
      </div>
    </>
  );
}

export default QualityPrintHeader;
