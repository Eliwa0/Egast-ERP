import JsBarcode from 'jsbarcode';
import egastLogo from '../assets/logos/egast-logo.png';

// ── HTML escape ───────────────────────────────────────────────────────────────

export const escapeHtml = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── Product name normaliser ───────────────────────────────────────────────────

export const getCleanProductName = (rawName = '') => {
  const v = String(rawName).toLowerCase();
  if (v.includes('برتقال') || v.includes('برتقان') || v.includes('orange'))        return 'Egyptian Fresh Orange';
  if (v.includes('يوسفي')  || v.includes('tangerine') || v.includes('mandarin'))   return 'Egyptian Fresh Tangerine';
  if (v.includes('ليمون')  || v.includes('لمون')  || v.includes('lemon'))         return 'Egyptian Fresh Lemon';
  if (v.includes('جريب فروت') || v.includes('grapefruit'))                         return 'Egyptian Fresh Grapefruit';
  if (v.includes('مانجو')  || v.includes('مانجه') || v.includes('mango'))         return 'Egyptian Fresh Mango';
  if (v.includes('رمان')   || v.includes('pomegranate'))                           return 'Egyptian Fresh Pomegranate';
  if (v.includes('بطاطس')  || v.includes('potato'))                                return 'Egyptian Fresh Potato';
  if (v.includes('ذرة')    || v.includes('ذره')   || v.includes('corn') || v.includes('maize')) return 'Egyptian Fresh Corn';
  if (v.includes('طماطم')  || v.includes('tomato'))                                return 'Egyptian Fresh Tomato';
  if (v.includes('بصل')    || v.includes('onion'))                                 return 'Egyptian Fresh Onion';
  if (v.includes('فول سوداني') || v.includes('peanut'))                            return 'Egyptian Fresh Peanut';
  if (v.includes('جزر')    || v.includes('carrot'))                                return 'Egyptian Fresh Carrot';
  if (v.includes('قرع')    || v.includes('pumpkin'))                               return 'Egyptian Fresh Pumpkin';
  if (v.includes('عنب')    || v.includes('grape'))                                 return 'Egyptian Fresh Grapes';
  if (v.includes('لب')     || v.includes('seed'))                                  return 'Egyptian Fresh Seeds';
  return rawName || 'Egyptian Fresh Product';
};

// ── UOM measurement parser ────────────────────────────────────────────────────

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

  if (/\bton\b/.test(text) || text.includes('طن')) {
    return { type: 'weight', factor: 1000, unitLabel: 'KG', displayText: '1000 KG', source: 'parsed-ton' };
  }

  let kg = parseNum(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg == null) kg = parseNum(/(\d+(?:\.\d+)?)\s*كيلو/);
  if (kg != null) return { type: 'weight', factor: kg, unitLabel: 'KG', displayText: `${kg} KG`, source: 'parsed-kg' };

  let gram = parseNum(/(\d+(?:\.\d+)?)\s*جرام/);
  if (gram == null) gram = parseNum(/(\d+(?:\.\d+)?)\s*gram\b/);
  if (gram == null) gram = parseNum(/(\d+(?:\.\d+)?)\s*gr\b/);
  if (gram == null) gram = parseNum(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gram != null) return { type: 'weight', factor: gram / 1000, unitLabel: 'KG', displayText: `${gram} g`, source: 'parsed-gram' };

  let liter = parseNum(/(\d+(?:\.\d+)?)\s*لتر/);
  if (liter == null) liter = parseNum(/(\d+(?:\.\d+)?)\s*liter\b/);
  if (liter == null) liter = parseNum(/(\d+(?:\.\d+)?)\s*litre\b/);
  if (liter == null) liter = parseNum(/(\d+(?:\.\d+)?)\s*l\b/);
  if (liter != null) return { type: 'volume', factor: liter, unitLabel: 'L', displayText: `${liter} L`, source: 'parsed-liter' };

  let ml = parseNum(/(\d+(?:\.\d+)?)\s*مليلتر/);
  if (ml == null) ml = parseNum(/(\d+(?:\.\d+)?)\s*ملليلتر/);
  if (ml == null) ml = parseNum(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml != null) return { type: 'volume', factor: ml / 1000, unitLabel: 'L', displayText: `${ml} ml`, source: 'parsed-ml' };

  const cm = parseNum(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (cm != null) return { type: 'length', factor: cm, unitLabel: 'CM', displayText: `${cm} CM`, source: 'parsed-cm' };

  if (/^kg$/.test(text) || /^كيلو$/.test(text)) return { type: 'weight', factor: 1, unitLabel: 'KG', displayText: '1 KG', source: 'unit-word-kg' };
  if (/^liter$|^litre$|^لتر$/.test(text)) return { type: 'volume', factor: 1, unitLabel: 'L', displayText: '1 L', source: 'unit-word-liter' };

  const w = Number(uom.weight1);
  if (w > 0) {
    const unit = (uom.weightUnit || '').trim().toLowerCase();
    const factor = unit === 'kg' ? w : w / 1000;
    return { type: 'weight', factor, unitLabel: 'KG', displayText: `${factor} KG`, source: 'sap-weight1' };
  }
  const vol = Number(uom.volume);
  if (vol > 0) return { type: 'volume', factor: vol, unitLabel: 'L', displayText: `${vol} L`, source: 'sap-volume' };

  return { type: 'unit', factor: 1, unitLabel: 'Unit', displayText: '1 Unit', source: 'generic' };
}

// ── Code 128 barcode SVG via jsbarcode ───────────────────────────────────────

function buildBarcodeSvg(value) {
  try {
    const text = String(value || '').trim();
    if (!text) throw new Error('empty');
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svgEl, text, {
      format: 'CODE128',
      width: 2.8,
      height: 90,
      displayValue: false,
      margin: 6,
      background: '#ffffff',
      lineColor: '#111111',
    });
    const svgWidth = Number.parseFloat(svgEl.getAttribute('width'));
    const svgHeight = Number.parseFloat(svgEl.getAttribute('height'));
    if (Number.isFinite(svgWidth) && Number.isFinite(svgHeight)) {
      svgEl.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    }
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return svgEl.outerHTML;
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="68"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="38" font-size="11" fill="#c00">Barcode unavailable</text></svg>`;
  }
}

// ── Label CSS (shared between all callers) ────────────────────────────────────

const LABEL_CSS = `
*{box-sizing:border-box;margin:0;padding:0;}
@page{size:10cm 15cm;margin:0;}
html,body{width:10cm;height:15cm;margin:0;padding:0;font-family:'Cairo',Arial,'Segoe UI',sans-serif;background:#fff;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact;}

.label-page{width:10cm;height:15cm;page-break-after:always;break-after:page;box-sizing:border-box;padding:0.45cm;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff;}
.label-page:last-child{page-break-after:auto;break-after:auto;}
.label-card{width:9.1cm;max-width:9.1cm;min-height:14.1cm;margin:0 auto;border:1px solid #cbd5e1;border-top:4px solid #163a5f;background:#fff;display:flex;flex-direction:column;}

.lbl-top{display:grid;grid-template-columns:1.45cm 1fr;gap:.28cm;align-items:center;padding:.32cm .38cm;border-bottom:1px solid #cbd5e1;background:#f8fafc;}
.lbl-logo{width:1.35cm;height:1.35cm;object-fit:contain;display:block;}
.lbl-heading{min-width:0;}
.lbl-eyebrow{font-size:7.5px;line-height:1;color:#64748b;font-weight:800;letter-spacing:.7px;text-transform:uppercase;margin-bottom:4px;}
.lbl-brand{font-size:25px;font-weight:900;letter-spacing:-.35px;line-height:1.05;color:#0f2942;overflow-wrap:anywhere;}
.lbl-product{font-size:11px;color:#64748b;margin-top:4px;line-height:1.25;font-weight:700;overflow-wrap:anywhere;}

.lbl-batch-section{padding:.34cm .38cm .3cm;border-bottom:1px solid #cbd5e1;}
.lbl-section-label{font-size:7.5px;color:#64748b;font-weight:800;letter-spacing:.7px;text-transform:uppercase;text-align:center;}
.lbl-batch-num{font-family:Consolas,'Courier New',monospace;font-size:20px;font-weight:900;letter-spacing:.7px;text-align:center;color:#0f2942;margin:5px 0 7px;overflow-wrap:anywhere;}
.lbl-barcode{padding:.08cm .18cm;background:#fff;}
.lbl-barcode svg{width:100%;height:3cm;display:block;}
.lbl-barcode-caption{margin-top:4px;text-align:center;font-size:7px;font-weight:800;letter-spacing:.6px;color:#64748b;}

.lbl-info{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-bottom:1px solid #cbd5e1;}
.lbl-row{min-height:1.45cm;padding:.24cm .3cm;border-inline-end:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;display:flex;flex-direction:column;justify-content:center;}
.lbl-row:nth-child(even){border-inline-end:0;}
.lbl-row:last-child:nth-child(odd){grid-column:1/-1;border-inline-end:0;}
.lk{font-size:7.5px;color:#64748b;text-transform:uppercase;letter-spacing:.45px;font-weight:800;white-space:nowrap;margin-bottom:3px;}
.lv{font-size:14px;font-weight:900;color:#111827;word-break:break-word;line-height:1.2;}
.lbl-row:last-child .lv{font-size:17px;color:#2e7d32;}

.lbl-footer{margin-top:auto;padding:.22cm .35cm;display:flex;justify-content:space-between;align-items:center;gap:.2cm;color:#64748b;font-size:7px;font-weight:700;letter-spacing:.25px;background:#f8fafc;border-top:1px solid #e2e8f0;}
.lbl-footer strong{color:#163a5f;font-weight:900;}

@media print{html,body{width:10cm;height:15cm;margin:0;padding:0;}.label-page{overflow:hidden;}}
`;

// ── Main print function ───────────────────────────────────────────────────────
//
// labelSpecs: Array of { batchNumber, topLine, subLine, infoRows }
//   batchNumber  - string - encoded in barcode + shown as text
//   topLine      - string - large brand/product heading
//   subLine      - string|null - optional smaller product sub-heading
//   infoRows     - [{ k, v }] - table rows (UOM, Packages, Net Weight, Warehouse…)

export function printBatchLabels(labelSpecs) {
  if (!labelSpecs?.length) return;
  const win = window.open('', '_blank', 'width=680,height=960');
  if (!win) return;

  const labelsHtml = labelSpecs.flatMap((spec) => [spec, spec]).map(({ batchNumber, topLine, subLine, infoRows }) => `
<section class="label-page">
  <div class="label-card">

    <div class="lbl-top">
      <img class="lbl-logo" src="${escapeHtml(egastLogo)}" alt="EGAST" />
      <div class="lbl-heading">
        <div class="lbl-eyebrow">EGAST • PRODUCTION LABEL</div>
        <div class="lbl-brand">${escapeHtml(topLine)}</div>
        ${subLine ? `<div class="lbl-product">${escapeHtml(subLine)}</div>` : ''}
      </div>
    </div>

    <div class="lbl-batch-section">
      <div class="lbl-section-label">BATCH NUMBER</div>
      <div class="lbl-batch-num">${escapeHtml(batchNumber)}</div>
      <div class="lbl-barcode">${buildBarcodeSvg(batchNumber)}</div>
      <div class="lbl-barcode-caption">CODE 128 • ${escapeHtml(batchNumber)}</div>
    </div>

    <div class="lbl-info">
      ${infoRows.map((r) => `
      <div class="lbl-row">
        <span class="lk">${escapeHtml(r.k)}</span>
        <span class="lv">${escapeHtml(r.v)}</span>
      </div>`).join('')}
    </div>

    <div class="lbl-footer"><strong>EGAST ERP</strong><span>TRACEABILITY LABEL</span></div>
  </div>
</section>`).join('');

  const copiedStyles = typeof document !== 'undefined'
    ? Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map((node) => node.outerHTML)
        .join('\n')
    : '';

  win.document.write(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Batch Labels</title>${copiedStyles}<style>${LABEL_CSS}</style></head><body>${labelsHtml}</body></html>`,
  );
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 350);
}
