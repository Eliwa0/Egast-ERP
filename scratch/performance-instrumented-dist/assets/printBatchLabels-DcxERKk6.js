import{s as e}from"./I18nContext-B8z1OFo1.js";import{r as t}from"./index-Xw-z9X3u.js";import{t as n}from"./JsBarcode-Dl2evN9B.js";var r=e(n(),1),i=e=>String(e??``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`),a=(e=``)=>{let t=String(e).toLowerCase();return t.includes(`برتقال`)||t.includes(`برتقان`)||t.includes(`orange`)?`Egyptian Fresh Orange`:t.includes(`يوسفي`)||t.includes(`tangerine`)||t.includes(`mandarin`)?`Egyptian Fresh Tangerine`:t.includes(`ليمون`)||t.includes(`لمون`)||t.includes(`lemon`)?`Egyptian Fresh Lemon`:t.includes(`جريب فروت`)||t.includes(`grapefruit`)?`Egyptian Fresh Grapefruit`:t.includes(`مانجو`)||t.includes(`مانجه`)||t.includes(`mango`)?`Egyptian Fresh Mango`:t.includes(`رمان`)||t.includes(`pomegranate`)?`Egyptian Fresh Pomegranate`:t.includes(`بطاطس`)||t.includes(`potato`)?`Egyptian Fresh Potato`:t.includes(`ذرة`)||t.includes(`ذره`)||t.includes(`corn`)||t.includes(`maize`)?`Egyptian Fresh Corn`:t.includes(`طماطم`)||t.includes(`tomato`)?`Egyptian Fresh Tomato`:t.includes(`بصل`)||t.includes(`onion`)?`Egyptian Fresh Onion`:t.includes(`فول سوداني`)||t.includes(`peanut`)?`Egyptian Fresh Peanut`:t.includes(`جزر`)||t.includes(`carrot`)?`Egyptian Fresh Carrot`:t.includes(`قرع`)||t.includes(`pumpkin`)?`Egyptian Fresh Pumpkin`:t.includes(`عنب`)||t.includes(`grape`)?`Egyptian Fresh Grapes`:t.includes(`لب`)||t.includes(`seed`)?`Egyptian Fresh Seeds`:e||`Egyptian Fresh Product`};function o(e){if(!e)return{type:`unit`,factor:1,unitLabel:`Unit`,displayText:`1 Unit`,source:`no-uom`};let t=`${e.code||``} ${e.label||``}`.toLowerCase().replace(/,/g,`.`).replace(/\s+/g,` `).trim(),n=e=>{let n=t.match(e);if(!n)return null;let r=Number(n[1]);return Number.isFinite(r)&&r>0?r:null};if(/\bton\b/.test(t)||t.includes(`طن`))return{type:`weight`,factor:1e3,unitLabel:`KG`,displayText:`1000 KG`,source:`parsed-ton`};let r=n(/(\d+(?:\.\d+)?)\s*kg\b/);if(r??=n(/(\d+(?:\.\d+)?)\s*كيلو/),r!=null)return{type:`weight`,factor:r,unitLabel:`KG`,displayText:`${r} KG`,source:`parsed-kg`};let i=n(/(\d+(?:\.\d+)?)\s*جرام/);if(i??=n(/(\d+(?:\.\d+)?)\s*gram\b/),i??=n(/(\d+(?:\.\d+)?)\s*gr\b/),i??=n(/(\d+(?:\.\d+)?)\s*g\b/),i!=null)return{type:`weight`,factor:i/1e3,unitLabel:`KG`,displayText:`${i} g`,source:`parsed-gram`};let a=n(/(\d+(?:\.\d+)?)\s*لتر/);if(a??=n(/(\d+(?:\.\d+)?)\s*liter\b/),a??=n(/(\d+(?:\.\d+)?)\s*litre\b/),a??=n(/(\d+(?:\.\d+)?)\s*l\b/),a!=null)return{type:`volume`,factor:a,unitLabel:`L`,displayText:`${a} L`,source:`parsed-liter`};let o=n(/(\d+(?:\.\d+)?)\s*مليلتر/);if(o??=n(/(\d+(?:\.\d+)?)\s*ملليلتر/),o??=n(/(\d+(?:\.\d+)?)\s*ml\b/),o!=null)return{type:`volume`,factor:o/1e3,unitLabel:`L`,displayText:`${o} ml`,source:`parsed-ml`};let s=n(/(\d+(?:\.\d+)?)\s*cm\b/);if(s!=null)return{type:`length`,factor:s,unitLabel:`CM`,displayText:`${s} CM`,source:`parsed-cm`};if(/^kg$/.test(t)||/^كيلو$/.test(t))return{type:`weight`,factor:1,unitLabel:`KG`,displayText:`1 KG`,source:`unit-word-kg`};if(/^liter$|^litre$|^لتر$/.test(t))return{type:`volume`,factor:1,unitLabel:`L`,displayText:`1 L`,source:`unit-word-liter`};let c=Number(e.weight1);if(c>0){let t=(e.weightUnit||``).trim().toLowerCase()===`kg`?c:c/1e3;return{type:`weight`,factor:t,unitLabel:`KG`,displayText:`${t} KG`,source:`sap-weight1`}}let l=Number(e.volume);return l>0?{type:`volume`,factor:l,unitLabel:`L`,displayText:`${l} L`,source:`sap-volume`}:{type:`unit`,factor:1,unitLabel:`Unit`,displayText:`1 Unit`,source:`generic`}}function s(e){try{let t=String(e||``).trim();if(!t)throw Error(`empty`);let n=document.createElementNS(`http://www.w3.org/2000/svg`,`svg`);(0,r.default)(n,t,{format:`CODE128`,width:2.8,height:90,displayValue:!1,margin:6,background:`#ffffff`,lineColor:`#111111`});let i=Number.parseFloat(n.getAttribute(`width`)),a=Number.parseFloat(n.getAttribute(`height`));return Number.isFinite(i)&&Number.isFinite(a)&&n.setAttribute(`viewBox`,`0 0 ${i} ${a}`),n.setAttribute(`xmlns`,`http://www.w3.org/2000/svg`),n.setAttribute(`preserveAspectRatio`,`xMidYMid meet`),n.outerHTML}catch{return`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="68"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="38" font-size="11" fill="#c00">Barcode unavailable</text></svg>`}}var c=`
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
`;function l(e){if(!e?.length)return;let n=window.open(``,`_blank`,`width=680,height=960`);if(!n)return;let r=e.flatMap(e=>[e,e]).map(({batchNumber:e,topLine:n,subLine:r,infoRows:a})=>`
<section class="label-page">
  <div class="label-card">

    <div class="lbl-top">
      <img class="lbl-logo" src="${i(t)}" alt="EGAST" />
      <div class="lbl-heading">
        <div class="lbl-eyebrow">EGAST • PRODUCTION LABEL</div>
        <div class="lbl-brand">${i(n)}</div>
        ${r?`<div class="lbl-product">${i(r)}</div>`:``}
      </div>
    </div>

    <div class="lbl-batch-section">
      <div class="lbl-section-label">BATCH NUMBER</div>
      <div class="lbl-batch-num">${i(e)}</div>
      <div class="lbl-barcode">${s(e)}</div>
      <div class="lbl-barcode-caption">CODE 128 • ${i(e)}</div>
    </div>

    <div class="lbl-info">
      ${a.map(e=>`
      <div class="lbl-row">
        <span class="lk">${i(e.k)}</span>
        <span class="lv">${i(e.v)}</span>
      </div>`).join(``)}
    </div>

    <div class="lbl-footer"><strong>EGAST ERP</strong><span>TRACEABILITY LABEL</span></div>
  </div>
</section>`).join(``),a=typeof document<`u`?Array.from(document.querySelectorAll(`link[rel="stylesheet"], style`)).map(e=>e.outerHTML).join(`
`):``;n.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Batch Labels</title>${a}<style>${c}</style></head><body>${r}</body></html>`),n.document.close(),n.focus(),setTimeout(()=>{n.print(),n.close()},350)}export{o as n,l as r,a as t};