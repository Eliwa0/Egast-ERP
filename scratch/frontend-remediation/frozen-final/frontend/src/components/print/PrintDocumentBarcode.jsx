import React from 'react';

function PrintDocumentBarcode({ identification, label = 'رقم المستند · DOCUMENT ID' }) {
  if (!identification) return null;

  const { documentNumber, barcodeSvg } = identification;

  return (
    <div className="print-document-barcode-card" aria-label={`Document ID ${documentNumber}`}>
      <span className="print-document-barcode-label">{label}</span>
      <div
        className="print-document-barcode-svg"
        // JsBarcode generates a trusted SVG from the operational document number only.
        dangerouslySetInnerHTML={{ __html: barcodeSvg }}
      />
      <strong className="print-document-barcode-number">{documentNumber}</strong>
    </div>
  );
}

export default PrintDocumentBarcode;
