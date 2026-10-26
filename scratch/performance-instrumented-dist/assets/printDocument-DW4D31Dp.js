var e=`/assets/cairo-v31-arabic-CJWMIGCx.woff2`,t=`/assets/cairo-v31-latin-PfPtmrPZ.woff2`,n=`width=900,height=1100`,r=e=>String(e||``).replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`).replaceAll(`'`,`&#39;`),i=()=>Array.from(document.querySelectorAll(`link[rel="stylesheet"], style`)).map(e=>e.outerHTML).join(`
`),a=({title:n,sheets:a,orientation:o=`portrait`,direction:s=`rtl`,sales:c=!1,identity:l=``})=>{let u=o===`landscape`,d=u?`297mm`:`210mm`,f=u?`210mm`:`297mm`;return`
<!doctype html>
<html lang="${s===`rtl`?`ar`:`en`}" dir="${s}">
  <head>
    <meta charset="utf-8" />
    <base href="${r(document.baseURI)}" />
    <title>${r(n||`Quality Inspection Report`)}</title>
    ${i()}
    <style>
      @font-face { font-family: SalesPrint; src: url('${e}') format('woff2'); unicode-range: U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF; }
      @font-face { font-family: SalesPrint; src: url('${t}') format('woff2'); unicode-range: U+0000-00FF; }
      @page {
        size: A4 ${o};
        margin: 0;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #000000;
        direction: ${s} !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .quality-print-document {
        width: ${d};
        background: #ffffff;
      }

      .quality-print-document .a4-print-sheet {
        border: none !important;
        box-shadow: none !important;
        position: relative !important;
        width: ${d} !important;
        height: ${f} !important;
        max-width: none !important;
        min-height: ${f} !important;
        margin: 0 !important;
        padding: 5mm 5mm 10mm !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        background: #ffffff !important;
        page-break-after: always !important;
        break-after: page;
      }

      .quality-print-document .a4-print-sheet:last-child {
        page-break-after: auto;
        break-after: auto;
      }

      .quality-print-page-number {
        position: absolute;
        right: 5mm;
        bottom: 3mm;
        left: 5mm;
        margin: 0;
        padding-top: 1.5mm;
        border-top: 1px solid #cbd5e1;
        color: #475569;
        font-size: 8px;
        text-align: center;
        direction: ltr;
      }

      .quality-print-content {
        width: 100%;
        transform-origin: top right;
      }
      .quality-print-document .delivery-print-sheet,
      .quality-print-document .delivery-print-sheet .report-info-grid,
      .quality-print-document .delivery-print-sheet .delivery-print-table {
        direction: ${s} !important;
      }

      .quality-print-document .report-print-logo-row {
        margin-bottom: 2mm !important;
        padding-bottom: 2mm !important;
      }

      .quality-print-document .report-header-logo {
        width: 16mm !important;
        height: 16mm !important;
        object-fit: contain !important;
      }

      .quality-print-document .report-header-text h2 { font-size: 14px !important; }
      .quality-print-document .report-header-text p,
      .quality-print-document .report-main-title h1 { font-size: 11px !important; }
      .quality-print-document .report-doc-no,
      .quality-print-document .report-main-title span { font-size: 8.5px !important; }

      .quality-print-document .report-main-title,
      .quality-print-document .report-info-grid,
      .quality-print-document .report-kpi-row,
      .quality-print-document .print-notes-box,
      .quality-print-document .report-signature-row,
      .quality-print-document .report-print-footer {
        margin-top: 2mm !important;
        margin-bottom: 2mm !important;
      }

      .quality-print-document .report-info-grid,
      .quality-print-document .report-kpi-row { gap: 1.5mm !important; }

      .quality-print-document .info-cell,
      .quality-print-document .report-info-grid > div,
      .quality-print-document .report-kpi-row > div,
      .quality-print-document .print-notes-box {
        min-height: 0 !important;
        padding: 1mm 1.5mm !important;
        line-height: 1.2 !important;
      }

      .quality-print-document .report-section-header {
        min-height: 0 !important;
        margin: 2mm 0 1mm !important;
        padding: 1mm 2mm !important;
        font-size: 9px !important;
        line-height: 1.2 !important;
      }

      .quality-print-document table {
        width: 100% !important;
        margin-top: 0 !important;
        margin-bottom: 2mm !important;
        border-collapse: collapse !important;
        table-layout: fixed !important;
      }

      .quality-print-document table th,
      .quality-print-document table td {
        height: auto !important;
        padding: 1mm 1.5mm !important;
        font-size: 8.5px !important;
        line-height: 1.2 !important;
        vertical-align: middle !important;
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: clip !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }

      .quality-print-document .report-print-footer {
        padding-top: 1.5mm !important;
        font-size: 8px !important;
      }

      .no-print,
      .Toastify,
      [role="dialog"],
      [role="presentation"],
      .MuiSnackbar-root,
      .MuiDialog-root,
      .MuiPopover-root,
      .MuiModal-root,
      .MuiBackdrop-root {
        display: none !important;
      }

      @media screen {
        body {
          padding: 16px;
        }

        .quality-print-document .a4-print-sheet {
          max-width: 820px !important;
          min-height: ${f} !important;
          margin: 0 auto 24px auto !important;
          padding: 50px 40px !important;
          border: 1.5px solid #cbd5e1 !important;
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14) !important;
        }
      }
      ${c?`
      @page { margin: 8mm 5mm 12mm;
        @top-center { content: ${JSON.stringify(l?`SAP #${l}`:``).replaceAll(`<`,`\\3C `).replaceAll(`>`,`\\3E `)}; font: 9px Arial; direction: ltr; }
        @bottom-center { content: counter(page) " / " counter(pages); font: 9px Arial; direction: ltr; } }
      .quality-print-document, .quality-print-document .delivery-print-sheet { width: 100% !important; }
      .quality-print-document .delivery-print-sheet { height: auto !important; min-height: 0 !important; overflow: visible !important; padding: 0 !important; break-after: auto !important; }
      .delivery-print-sheet * { font-family: SalesPrint, Arial, sans-serif !important; }
      .delivery-print-sheet .quality-print-content { transform: none !important; width: 100% !important; }
      .delivery-print-table thead { display: table-header-group; }
      .delivery-print-table tr { break-inside: avoid; page-break-inside: avoid; }
      .delivery-print-section { break-inside: auto !important; page-break-inside: auto !important; }
      .delivery-print-section .report-section-header { break-after: avoid; page-break-after: avoid; }
      .quality-print-document .delivery-print-table td { font-size: 11px !important; line-height: 1.35 !important; }
      .delivery-print-table th:nth-child(1) { width: 4%; }
      .delivery-print-table th:nth-child(2) { width: 34%; }
      .delivery-print-table th:nth-child(3) { width: 9%; }
      .delivery-print-table th:nth-child(4) { width: 7%; }
      .delivery-print-table th:nth-child(5) { width: 13%; }
      .delivery-print-table th:nth-child(6) { width: 15%; }
      .delivery-print-table th:nth-child(7) { width: 18%; }
      .delivery-print-identity, .delivery-print-header { break-inside: avoid; }
      .delivery-print-sheet .quality-print-page-number { display: none; }
      `:``}
    </style>
  </head>
  <body>
    <main class="quality-print-document">
      ${a}
    </main>
    <script>
      window.addEventListener('load', async function () {
        window.__printReady = false;
        try {
          if (${c}) {
          document.body.getBoundingClientRect();
          await document.fonts.load('14px SalesPrint', 'USD 6000 العربية');
          await Promise.all([
            document.fonts.ready,
            ...Array.from(document.images).map(function(image) { return image.decode(); })
          ]);
          }
        } catch (error) {
          document.body.insertAdjacentHTML('afterbegin', '<p role="alert">${s===`rtl`?`تعذّر تحميل أصول الطباعة. أعد محاولة الطباعة.`:`Print assets failed to load. Retry printing.`}</p>');
          return;
        }
        window.__printReady = true;
        document.querySelectorAll('.a4-print-sheet').forEach(function (sheet) {
          if (${c}) return;
          var content = sheet.querySelector('.quality-print-content');
          if (!content) return;
          var availableHeight = sheet.clientHeight
            - parseFloat(getComputedStyle(sheet).paddingTop)
            - parseFloat(getComputedStyle(sheet).paddingBottom);
          var availableWidth = sheet.clientWidth
            - parseFloat(getComputedStyle(sheet).paddingLeft)
            - parseFloat(getComputedStyle(sheet).paddingRight);
          var scale = Math.min(1, availableHeight / content.scrollHeight, availableWidth / content.scrollWidth);
          if (scale < 1) {
            content.style.transform = 'scale(' + scale + ')';
            content.style.width = (100 / scale) + '%';
          }
        });
        window.setTimeout(function () {
          if (${c}) {
            document.documentElement.setAttribute('data-print-assets', JSON.stringify({
              ready: window.__printReady, fonts: document.fonts.status,
              images: Array.from(document.images).map(function(image) { return image.naturalWidth; })
            }));
          }
          window.focus();
          window.print();
        }, 250);
      });
      window.addEventListener('afterprint', function () {
        if (window.location.protocol === 'blob:') URL.revokeObjectURL(window.location.href);
        window.close();
      });
      window.addEventListener('pagehide', function () {
        if (window.location.protocol === 'blob:') URL.revokeObjectURL(window.location.href);
      });
    <\/script>
  </body>
</html>
`};function o(){return window.open(``,`_blank`,n)}function s({printWindow:e,title:t,elements:n,orientation:r=`portrait`,direction:i=`rtl`}){let o=(Array.isArray(n)?n:[n]).filter(Boolean);if(o.length===0||!e)return!1;let s=o.every(e=>e.classList.contains(`delivery-print-sheet`)),c=a({title:t,sheets:o.map((e,t)=>{let n=e.cloneNode(!0);n.removeAttribute(`aria-hidden`),n.style.removeProperty(`display`),n.style.pageBreakAfter=t<o.length-1?`always`:`auto`;let r=document.createElement(`div`);for(r.className=`quality-print-content`;n.firstChild;)r.appendChild(n.firstChild);n.appendChild(r);let i=document.createElement(`div`);return i.className=`quality-print-page-number`,i.textContent=`Page ${t+1} / ${o.length}`,n.appendChild(i),n.outerHTML}).join(`
`),orientation:r,direction:i,sales:s,identity:o.length===1?o[0].dataset.printDocumentNumber:``});return s?e.location.replace(URL.createObjectURL(new Blob([c],{type:`text/html`}))):(e.document.open(),e.document.write(c),e.document.close()),!0}function c({printWindow:e,title:t,element:n}){if(!e||!n)return!1;let a=n.cloneNode(!0);return a.removeAttribute(`aria-hidden`),a.style.removeProperty(`display`),e.document.open(),e.document.write(`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>${r(t)}</title>${i()}
<style>
@page { size: A4 portrait; margin: 10mm; @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8px Arial, sans-serif; color: #64748b; } }
html, body { margin: 0; padding: 0; background: #fff; }
.delivery-flow-print { width: 100%; max-width: none; margin: 0; }
.delivery-flow-print .delivery-print-report { width: 100%; height: auto; min-height: 0; max-width: none; padding: 0; margin: 0; border: 0; box-shadow: none; overflow: visible; break-after: auto; }
.delivery-flow-print .delivery-print-section { break-inside: auto; page-break-inside: auto; }
.delivery-flow-print .delivery-print-section .report-section-header { break-after: avoid; page-break-after: avoid; }
.delivery-flow-print .delivery-print-table { width: 100%; table-layout: fixed; }
.delivery-flow-print .delivery-print-table thead { display: table-header-group; }
.delivery-flow-print .delivery-print-table tr { break-inside: avoid; page-break-inside: avoid; }
.delivery-flow-print .delivery-print-header, .delivery-flow-print .delivery-print-title,
.delivery-flow-print .delivery-print-filters, .delivery-flow-print .delivery-print-kpis,
.delivery-flow-print .delivery-print-footer { break-inside: avoid; page-break-inside: avoid; }
@media print { .delivery-flow-print .delivery-print-report { width: 100% !important; height: auto !important; min-height: 0 !important; padding: 0 !important; overflow: visible !important; } }
</style></head><body><main class="delivery-flow-print">${a.outerHTML}</main>
<script>window.addEventListener('load', function () { window.setTimeout(function () { window.focus(); window.print(); }, 250); }); window.addEventListener('afterprint', function () { window.close(); });<\/script>
</body></html>`),e.document.close(),!0}function l({title:e,elements:t,orientation:n=`portrait`}){return s({printWindow:o(),title:e,elements:t,orientation:n})}export{s as i,l as n,c as r,o as t};