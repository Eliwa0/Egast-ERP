import JsBarcode from 'jsbarcode';

export const getOperationalDocumentNumber = (record) => {
  const visibleNumber = record?.sap_doc_num;
  return String(visibleNumber && visibleNumber !== '-' ? visibleNumber : record?.id ?? '');
};

const createBarcodeSvg = (documentNumber) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  JsBarcode(svg, documentNumber, {
    format: 'CODE128',
    displayValue: false,
    lineColor: '#000000',
    background: '#ffffff',
    width: 2,
    height: 52,
    margin: 12,
  });

  // The human-readable number is rendered as controlled HTML below the bars.
  svg.querySelectorAll('text').forEach((textNode) => textNode.remove());

  const width = Number.parseFloat(svg.getAttribute('width'));
  const height = Number.parseFloat(svg.getAttribute('height'));
  if (Number.isFinite(width) && Number.isFinite(height)) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `CODE128 ${documentNumber}`);

  return svg.outerHTML;
};

export const createPrintDocumentBarcodeIdentification = (documentNumber) => {
  const documentNumberText = String(documentNumber ?? '');
  if (!documentNumberText) {
    throw new Error('A visible document number is required for barcode generation.');
  }

  return {
    documentNumber: documentNumberText,
    barcodeSvg: createBarcodeSvg(documentNumberText),
  };
};

export const prepareShippingReceivingPrintRecord = (record) => {
  const documentNumber = getOperationalDocumentNumber(record);
  if (!documentNumber) {
    throw new Error('A visible operational document number is required for printing.');
  }

  return {
    ...record,
    _printIdentification: createPrintDocumentBarcodeIdentification(documentNumber),
  };
};
