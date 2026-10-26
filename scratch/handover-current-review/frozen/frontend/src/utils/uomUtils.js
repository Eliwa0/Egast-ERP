// Shared UOM helpers — used by ReceiptWizard and ReceiptReviewPage.
// All logic here mirrors ReceiptWizard exactly so both pages stay in sync.

export function getUomEntry(uom) {
  return String(
    uom?.value ?? uom?.AbsEntry ?? uom?.absEntry ??
    uom?.entry ?? uom?.UomEntry ?? uom?.uomEntry ?? ''
  ).trim();
}

export function getUomLabel(uom) {
  return String(uom?.label ?? uom?.name ?? uom?.Name ?? uom?.code ?? '');
}

// Returns true only for KG / ton / pallet-class UOMs — identical to ReceiptWizard.
export function isWeightBasedUom(uom) {
  const text = `${uom?.label || ''} ${uom?.code || ''} ${uom?.uomName || ''} ${uom?.name || ''}`.toLowerCase();
  if (
    text.includes('جرام') || text.includes('gram') || text.includes('grams') ||
    /\bgm\b/.test(text) || /\b g\b/.test(text) || /\bg\b/.test(text)
  ) return false;
  return (
    text.includes('كيلو') || text.includes('kg') ||
    text.includes('طن')   || text.includes('ton') ||
    text.includes('pallet') || text.includes('بالت') || text.includes('بالة')
  );
}

// Full measurement parser — exact copy of ReceiptWizard's getUomMeasurement.
// Priority: parse from name/code label first; SAP weight fields as confirmation only.
// Never uses parseInt (breaks decimals). Never uses Math.max(1, …) (hides small values).
export function getUomMeasurement(uom) {
  if (!uom) return { type: 'unit', factor: 1, unitLabel: 'Unit', displayText: '1 Unit', source: 'no-uom' };

  const text = `${uom.code || ''} ${uom.label || ''}`
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  const parseNum = (regex) => {
    const m = text.match(regex);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // ton / طن
  if (/\bton\b/.test(text) || text.includes('طن')) {
    return { type: 'weight', factor: 1000, unitLabel: 'KG', displayText: '1000 KG', source: 'parsed-ton' };
  }

  // KG / كيلو
  let kg = parseNum(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg == null) kg = parseNum(/(\d+(?:\.\d+)?)\s*كيلو/);
  if (kg != null) {
    return { type: 'weight', factor: kg, unitLabel: 'KG', displayText: `${kg} KG`, source: 'parsed-kg' };
  }

  // gram / جرام
  let gram = parseNum(/(\d+(?:\.\d+)?)\s*جرام/);
  if (gram == null) gram = parseNum(/(\d+(?:\.\d+)?)\s*gram\b/);
  if (gram == null) gram = parseNum(/(\d+(?:\.\d+)?)\s*gr\b/);
  if (gram == null) gram = parseNum(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gram != null) {
    return { type: 'weight', factor: gram / 1000, unitLabel: 'KG', displayText: `${gram} g`, source: 'parsed-gram' };
  }

  // liter / لتر
  let liter = parseNum(/(\d+(?:\.\d+)?)\s*لتر/);
  if (liter == null) liter = parseNum(/(\d+(?:\.\d+)?)\s*liter\b/);
  if (liter == null) liter = parseNum(/(\d+(?:\.\d+)?)\s*litre\b/);
  if (liter == null) liter = parseNum(/(\d+(?:\.\d+)?)\s*l\b/);
  if (liter != null) {
    return { type: 'volume', factor: liter, unitLabel: 'L', displayText: `${liter} L`, source: 'parsed-liter' };
  }

  // ml / مليلتر
  let ml = parseNum(/(\d+(?:\.\d+)?)\s*مليلتر/);
  if (ml == null) ml = parseNum(/(\d+(?:\.\d+)?)\s*ملليلتر/);
  if (ml == null) ml = parseNum(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml != null) {
    return { type: 'volume', factor: ml / 1000, unitLabel: 'L', displayText: `${ml} ml`, source: 'parsed-ml' };
  }

  // cm
  const cm = parseNum(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (cm != null) {
    return { type: 'length', factor: cm, unitLabel: 'CM', displayText: `${cm} CM`, source: 'parsed-cm' };
  }

  // bare unit words
  if (/^kg$/.test(text) || /^كيلو$/.test(text)) {
    return { type: 'weight', factor: 1, unitLabel: 'KG', displayText: '1 KG', source: 'unit-word-kg' };
  }
  if (/^liter$|^litre$|^لتر$/.test(text)) {
    return { type: 'volume', factor: 1, unitLabel: 'L', displayText: '1 L', source: 'unit-word-liter' };
  }

  // SAP weight1 fallback (when name has no numeric pattern)
  const w = Number(uom.weight1);
  if (w > 0) {
    const unit = (uom.weightUnit || '').trim().toLowerCase();
    const factor = unit === 'kg' ? w : w / 1000;
    return { type: 'weight', factor, unitLabel: 'KG', displayText: `${factor} KG`, source: 'sap-weight1' };
  }
  const vol = Number(uom.volume);
  if (vol > 0) {
    return { type: 'volume', factor: vol, unitLabel: 'L', displayText: `${vol} L`, source: 'sap-volume' };
  }

  return { type: 'unit', factor: 1, unitLabel: 'Unit', displayText: '1 Unit', source: 'generic' };
}

// quantity = unit_count × uom_factor  (same formula as ReceiptWizard)
export function calculateReceiptQuantity(unitCount, uom) {
  const { factor } = getUomMeasurement(uom);
  return Math.round((Number(unitCount) || 0) * factor * 1000) / 1000;
}
