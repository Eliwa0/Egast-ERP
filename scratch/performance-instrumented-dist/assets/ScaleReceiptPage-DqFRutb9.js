import{i as e,n as t,r as n,s as r}from"./I18nContext-B8z1OFo1.js";import{O as i,n as a,r as o}from"./index-Xw-z9X3u.js";import{t as s}from"./PageHeader-u6pETJqK.js";import{n as c}from"./scaleApi-BHJB3X64.js";import{n as l}from"./ActionIconButton-BE2SE7B7.js";import{t as u}from"./SignaturePad-C3tPtx5J.js";var d=r(e(),1),f=n(),p=0,m=()=>`row-${Date.now()}-${p++}`,h=()=>{let e=new Date,t=String(e.getMonth()+1).padStart(2,`0`),n=String(e.getDate()).padStart(2,`0`);return`${e.getFullYear()}-${t}-${n}`},g=()=>({receipt_number:``,receipt_date:h(),vehicle_number:``,driver_name:``,driver_license:``,source:``,supplier_name:``,notes:``,items:[{key:m(),item_code:``,item_name:``,count:`1`,quantity_kg:`0`,package_type:``,notes:``}],driver_signature_name:``,receiver_signature_name:``,driver_signature:``,receiver_signature:``}),_=e=>{let t=String(e??``).trim();if(t===``)return``;let n=Number(t);return Number.isNaN(n)?``:Math.max(0,n).toString()},v=(e,t=2)=>Number(e||0).toLocaleString(`en-US`,{minimumFractionDigits:t,maximumFractionDigits:t});function y({form:e}){let{t:n}=t(),r=e.items,i=r.reduce((e,t)=>e+(Number(t.quantity_kg)||0),0),a=i/1e3,s=r.some(e=>e.item_name||e.item_code||Number(e.quantity_kg)>0),c=e.receipt_date?new Date(`${e.receipt_date}T00:00:00`).toLocaleDateString(`ar-EG`,{year:`numeric`,month:`long`,day:`numeric`}):`—`;return(0,f.jsx)(`div`,{className:`scale-receipt-print-container`,dir:`rtl`,children:(0,f.jsxs)(`div`,{className:`sr-doc`,children:[(0,f.jsxs)(`div`,{className:`sr-header`,children:[(0,f.jsxs)(`div`,{className:`sr-brand-section`,children:[(0,f.jsx)(`img`,{src:o,alt:`EGAST Group`,className:`sr-logo`}),(0,f.jsxs)(`div`,{className:`sr-brand-text`,children:[(0,f.jsx)(`div`,{className:`sr-brand-name`,children:`الشركة المصرية للخدمات الزراعية`}),(0,f.jsx)(`div`,{className:`sr-brand-en`,children:`EGAST — Egyptian Agricultural Services Co.`}),(0,f.jsx)(`div`,{className:`sr-doc-title`,children:`إيصال استلام`}),(0,f.jsx)(`div`,{className:`sr-doc-title-en`,children:`SCALE GOODS RECEIPT`})]})]}),(0,f.jsxs)(`div`,{className:`sr-meta`,children:[(0,f.jsx)(`div`,{className:`sr-form-badge`,children:`نموذج رقم: EG.ST.F04`}),(0,f.jsx)(`div`,{className:`sr-receipt-no`,children:e.receipt_number||`—`}),(0,f.jsx)(`div`,{className:`sr-date`,children:c})]})]}),(0,f.jsxs)(`div`,{className:`sr-info-grid`,children:[(0,f.jsxs)(`div`,{className:`sr-info-cell`,children:[(0,f.jsx)(`div`,{className:`sr-info-label`,children:`التاريخ`}),(0,f.jsx)(`div`,{className:`sr-info-value`,children:c})]}),(0,f.jsxs)(`div`,{className:`sr-info-cell`,children:[(0,f.jsx)(`div`,{className:`sr-info-label`,children:`رقم السيارة`}),(0,f.jsx)(`div`,{className:`sr-info-value`,children:e.vehicle_number||`—`})]}),(0,f.jsxs)(`div`,{className:`sr-info-cell`,children:[(0,f.jsx)(`div`,{className:`sr-info-label`,children:`اسم السائق`}),(0,f.jsx)(`div`,{className:`sr-info-value`,children:e.driver_name||`—`})]}),(0,f.jsxs)(`div`,{className:`sr-info-cell`,children:[(0,f.jsx)(`div`,{className:`sr-info-label`,children:`رقم الرخصة`}),(0,f.jsx)(`div`,{className:`sr-info-value`,children:e.driver_license||`—`})]}),(0,f.jsxs)(`div`,{className:`sr-info-cell`,children:[(0,f.jsx)(`div`,{className:`sr-info-label`,children:`من المصدر`}),(0,f.jsx)(`div`,{className:`sr-info-value`,children:e.source||`—`})]})]}),(0,f.jsxs)(`table`,{className:`sr-table`,children:[(0,f.jsx)(`thead`,{children:(0,f.jsxs)(`tr`,{children:[(0,f.jsx)(`th`,{children:`الرقم الكودي`}),(0,f.jsx)(`th`,{children:`اسم الصنف`}),(0,f.jsx)(`th`,{children:`العدد`}),(0,f.jsx)(`th`,{children:`الكمية بالكيلو`}),(0,f.jsx)(`th`,{children:`الكمية بالطن`}),(0,f.jsx)(`th`,{children:`نوع العبوة`}),(0,f.jsx)(`th`,{children:`ملاحظات`})]})}),(0,f.jsx)(`tbody`,{children:s?r.map((e,t)=>(0,f.jsxs)(`tr`,{children:[(0,f.jsx)(`td`,{children:e.item_code||`—`}),(0,f.jsx)(`td`,{children:e.item_name||`—`}),(0,f.jsx)(`td`,{children:e.count||0}),(0,f.jsx)(`td`,{children:v(e.quantity_kg)}),(0,f.jsx)(`td`,{children:v((Number(e.quantity_kg)||0)/1e3,3)}),(0,f.jsx)(`td`,{children:e.package_type||`—`}),(0,f.jsx)(`td`,{children:e.notes||`—`})]},e.key||t)):(0,f.jsx)(`tr`,{children:(0,f.jsx)(`td`,{colSpan:`7`,className:`sr-table-empty`,children:`لا توجد أصناف مسجلة`})})}),(0,f.jsx)(`tfoot`,{children:(0,f.jsxs)(`tr`,{className:`sr-totals-row`,children:[(0,f.jsx)(`td`,{colSpan:`3`,children:n(`scale.totalKg`)}),(0,f.jsx)(`td`,{children:v(i)}),(0,f.jsx)(`td`,{colSpan:`2`,children:n(`scale.totalTon`)}),(0,f.jsx)(`td`,{children:v(a,3)})]})})]}),e.notes&&(0,f.jsxs)(`div`,{className:`sr-notes`,children:[(0,f.jsx)(`strong`,{children:`ملاحظات: `}),e.notes]}),(0,f.jsxs)(`div`,{className:`sr-signatures`,children:[(0,f.jsxs)(`div`,{className:`sr-sig-card`,children:[(0,f.jsx)(`div`,{className:`sr-sig-title`,children:`السائق`}),(0,f.jsxs)(`div`,{className:`sr-sig-name`,children:[`الاسم: `,e.driver_signature_name||`________________`]}),(0,f.jsx)(`div`,{className:`sr-sig-image`,children:e.driver_signature?(0,f.jsx)(`img`,{src:e.driver_signature,alt:``}):(0,f.jsx)(`span`,{children:`التوقيع: ________________`})})]}),(0,f.jsxs)(`div`,{className:`sr-sig-card`,children:[(0,f.jsx)(`div`,{className:`sr-sig-title`,children:`المستلم بقيمة البضاعة`}),(0,f.jsxs)(`div`,{className:`sr-sig-name`,children:[`الاسم: `,e.receiver_signature_name||`________________`]}),(0,f.jsx)(`div`,{className:`sr-sig-image`,children:e.receiver_signature?(0,f.jsx)(`img`,{src:e.receiver_signature,alt:``}):(0,f.jsx)(`span`,{children:`التوقيع: ________________`})})]})]}),(0,f.jsxs)(`div`,{className:`sr-footer`,children:[(0,f.jsx)(`div`,{children:`نظام إدارة الميزان والبسكول — EGAST ERP Weighbridge System`}),(0,f.jsx)(`div`,{children:`مستند رسمي معتمد · صفحة 1 من 1`})]})]})})}function b(){let e=i(),{t:n}=t(),r=a(),[o,p]=(0,d.useState)(g),[b,x]=(0,d.useState)(null),[S,C]=(0,d.useState)(!1),w=(e,t)=>{p(n=>({...n,[e]:t}))},T=(e,t,n)=>{let r=t===`count`||t===`quantity_kg`?_(n):n;p(n=>({...n,items:n.items.map(n=>n.key===e?{...n,[t]:r}:n)}))},E=()=>{p(e=>({...e,items:[...e.items,{key:m(),item_code:``,item_name:``,count:`1`,quantity_kg:`0`,package_type:``,notes:``}]}))},D=e=>{p(t=>({...t,items:t.items.length>1?t.items.filter(t=>t.key!==e):t.items}))},O=e=>{let t=e.items.map(e=>{let t=Number(e.quantity_kg)||0;return{item_code:e.item_code.trim(),item_name:e.item_name.trim(),count:Math.max(0,Number(e.count)||0),quantity_kg:t,quantity_ton:t/1e3,package_type:e.package_type.trim(),notes:e.notes.trim()}}).filter(e=>e.item_name||e.item_code||e.quantity_kg>0);return{receipt_date:e.receipt_date||h(),vehicle_number:e.vehicle_number.trim(),driver_name:e.driver_name.trim(),driver_license:e.driver_license.trim(),source:e.source.trim(),supplier_name:e.supplier_name.trim(),items:t,driver_signature_name:e.driver_signature_name.trim(),receiver_signature_name:e.receiver_signature_name.trim(),driver_signature:e.driver_signature||``,receiver_signature:e.receiver_signature||``,notes:e.notes.trim()}},k=async()=>{C(!0);try{let e=O(o),t=!!b,i=t?await c.updateReceipt(b,e):await c.createReceipt(e);return x(i.data.id),p(e=>({...e,receipt_number:i.data.receipt_number})),r.success(n(t?`scale.receiptUpdatedSuccess`:`scale.receiptSavedSuccess`)),i.data}catch(e){let t=e?.response?.data?.errors;return r.error(t?JSON.stringify(t):e?.response?.data?.error||e.message),null}finally{C(!1)}},A=async()=>{await k()&&e(`/scale`)},j=()=>{(o.vehicle_number||o.driver_name||o.source||o.items.some(e=>e.item_name||e.item_code||Number(e.quantity_kg)>0))&&!window.confirm(n(`scale.confirmClearReceipt`))||(x(null),p(g()))},M=o.items.reduce((e,t)=>e+(Number(t.quantity_kg)||0),0),N=M/1e3;return(0,f.jsxs)(`div`,{className:`home-page scale-receipt-page`,children:[(0,f.jsx)(s,{eyebrow:n(`scale.title`),title:n(`scale.receiptTitle`),description:n(`scale.receiptSubtitle`)}),(0,f.jsxs)(`div`,{className:`scale-receipt-toolbar`,children:[(0,f.jsx)(`button`,{type:`button`,className:`app-button app-button--primary`,disabled:S,onClick:k,children:S?`...`:`💾 ${n(`scale.saveReceipt`)}`}),(0,f.jsx)(`button`,{type:`button`,className:`app-button app-button--primary`,disabled:S,onClick:A,children:n(`scale.saveAndClose`)}),(0,f.jsx)(`button`,{type:`button`,className:`app-button`,onClick:j,children:n(`scale.clearReceipt`)}),(0,f.jsx)(l,{icon:`🖨️`,onClick:()=>window.print()}),o.receipt_number&&(0,f.jsx)(`span`,{className:`scale-receipt-number`,children:o.receipt_number})]}),(0,f.jsxs)(`div`,{className:`card-panel scale-receipt-sheet`,children:[(0,f.jsxs)(`div`,{className:`sr-edit-head`,children:[(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.receiptDate`)}),(0,f.jsx)(`input`,{className:`app-input`,type:`date`,value:o.receipt_date,onChange:e=>w(`receipt_date`,e.target.value)})]}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.vehicleNumber`)}),(0,f.jsx)(`input`,{className:`app-input`,value:o.vehicle_number,onChange:e=>w(`vehicle_number`,e.target.value)})]}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.driverName`)}),(0,f.jsx)(`input`,{className:`app-input`,value:o.driver_name,onChange:e=>w(`driver_name`,e.target.value)})]}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.driverLicense`)}),(0,f.jsx)(`input`,{className:`app-input`,value:o.driver_license,onChange:e=>w(`driver_license`,e.target.value)})]}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.receiptSource`)}),(0,f.jsx)(`input`,{className:`app-input`,value:o.source,onChange:e=>w(`source`,e.target.value)})]})]}),(0,f.jsxs)(`div`,{className:`sr-products-head`,children:[(0,f.jsx)(`h2`,{children:n(`scale.productsTable`)}),(0,f.jsxs)(`button`,{type:`button`,className:`app-button app-button--primary app-button--sm`,onClick:E,children:[`＋ `,n(`scale.addRow`)]})]}),(0,f.jsx)(`div`,{className:`sr-table-scroll`,children:(0,f.jsxs)(`table`,{className:`sr-edit-table`,children:[(0,f.jsx)(`thead`,{children:(0,f.jsxs)(`tr`,{children:[(0,f.jsx)(`th`,{children:n(`scale.itemCode`)}),(0,f.jsx)(`th`,{children:n(`scale.itemName`)}),(0,f.jsx)(`th`,{children:n(`scale.count`)}),(0,f.jsx)(`th`,{children:n(`scale.quantityKg`)}),(0,f.jsx)(`th`,{children:n(`scale.packageType`)}),(0,f.jsx)(`th`,{children:n(`scale.notes`)}),(0,f.jsx)(`th`,{})]})}),(0,f.jsx)(`tbody`,{children:o.items.map(e=>(0,f.jsxs)(`tr`,{children:[(0,f.jsx)(`td`,{children:(0,f.jsx)(`input`,{className:`app-input`,value:e.item_code,onChange:t=>T(e.key,`item_code`,t.target.value)})}),(0,f.jsx)(`td`,{children:(0,f.jsx)(`input`,{className:`app-input`,value:e.item_name,onChange:t=>T(e.key,`item_name`,t.target.value)})}),(0,f.jsx)(`td`,{children:(0,f.jsx)(`input`,{className:`app-input sr-num-input`,type:`number`,min:`0`,value:e.count,onChange:t=>T(e.key,`count`,t.target.value)})}),(0,f.jsx)(`td`,{children:(0,f.jsx)(`input`,{className:`app-input sr-num-input`,type:`number`,min:`0`,step:`0.01`,value:e.quantity_kg,onChange:t=>T(e.key,`quantity_kg`,t.target.value)})}),(0,f.jsx)(`td`,{children:(0,f.jsx)(`input`,{className:`app-input`,value:e.package_type,onChange:t=>T(e.key,`package_type`,t.target.value)})}),(0,f.jsx)(`td`,{children:(0,f.jsx)(`input`,{className:`app-input`,value:e.notes,onChange:t=>T(e.key,`notes`,t.target.value)})}),(0,f.jsx)(`td`,{children:(0,f.jsx)(`button`,{type:`button`,className:`sr-remove-btn`,onClick:()=>D(e.key),disabled:o.items.length===1,title:n(`scale.removeRow`),children:`✕`})})]},e.key))}),(0,f.jsx)(`tfoot`,{children:(0,f.jsxs)(`tr`,{children:[(0,f.jsx)(`td`,{colSpan:`3`,className:`sr-total-label`,children:n(`scale.totalKg`)}),(0,f.jsx)(`td`,{className:`sr-total-value`,children:v(M)}),(0,f.jsx)(`td`,{colSpan:`2`,className:`sr-total-label`,children:n(`scale.totalTon`)}),(0,f.jsx)(`td`,{className:`sr-total-value`,children:v(N,3)})]})})]})}),(0,f.jsx)(`div`,{className:`sr-edit-foot`,children:(0,f.jsxs)(`div`,{className:`form-field sr-notes-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.notes`)}),(0,f.jsx)(`textarea`,{className:`app-input`,rows:`2`,value:o.notes,onChange:e=>w(`notes`,e.target.value)})]})}),(0,f.jsxs)(`div`,{className:`sr-signatures-edit`,children:[(0,f.jsxs)(`div`,{className:`sr-sig-edit-card card-panel`,children:[(0,f.jsx)(`div`,{className:`sr-sig-edit-title`,children:n(`scale.driverSignature`)}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.signatureName`)}),(0,f.jsx)(`input`,{className:`app-input`,value:o.driver_signature_name,onChange:e=>w(`driver_signature_name`,e.target.value)})]}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.signatureDraw`)}),(0,f.jsx)(u,{value:o.driver_signature,onChange:e=>w(`driver_signature`,e||``)})]})]}),(0,f.jsxs)(`div`,{className:`sr-sig-edit-card card-panel`,children:[(0,f.jsx)(`div`,{className:`sr-sig-edit-title`,children:n(`scale.receiverSignature`)}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.signatureName`)}),(0,f.jsx)(`input`,{className:`app-input`,value:o.receiver_signature_name,onChange:e=>w(`receiver_signature_name`,e.target.value)})]}),(0,f.jsxs)(`div`,{className:`form-field`,children:[(0,f.jsx)(`label`,{children:n(`scale.signatureDraw`)}),(0,f.jsx)(u,{value:o.receiver_signature,onChange:e=>w(`receiver_signature`,e||``)})]})]})]})]}),(0,f.jsx)(y,{form:o}),(0,f.jsx)(`style`,{children:`
        .scale-receipt-print-container { display: none; }

        .scale-receipt-page { padding-bottom: 40px; }
        .scale-receipt-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          margin: 0 auto 18px;
          width: min(1100px, 100%);
        }
        .scale-receipt-toolbar .app-button { min-height: 40px; }
        .scale-receipt-number {
          margin-inline-start: auto;
          font-weight: 800;
          color: var(--color-primary);
          background: var(--color-primary-soft);
          border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
          border-radius: var(--radius-sm);
          padding: 4px 12px;
        }
        .scale-receipt-sheet {
          width: min(1100px, 100%);
          margin: 0 auto;
          padding: 22px 24px;
        }
        .sr-edit-head {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 20px;
        }
        .sr-edit-head .form-field { margin-bottom: 0; }
        .sr-products-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }
        .sr-products-head h2 { margin: 0; font-size: 1.1rem; color: var(--color-text); }
        .sr-table-scroll { overflow-x: auto; margin-bottom: 16px; }
        .sr-edit-table { width: 100%; min-width: 760px; border-collapse: collapse; }
        .sr-edit-table th {
          background: var(--bg-muted);
          color: var(--color-text-muted);
          text-align: start;
          padding: 8px 10px;
          font-size: 0.84rem;
          border: 1px solid var(--color-border);
        }
        .sr-edit-table td {
          padding: 6px 8px;
          border: 1px solid var(--color-border);
          vertical-align: middle;
        }
        .sr-edit-table .app-input { min-width: 0; width: 100%; padding: 6px 8px; }
        .sr-num-input { text-align: end; direction: ltr; }
        .sr-remove-btn {
          width: 28px;
          height: 28px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--danger, #dc2626);
          cursor: pointer;
          font-size: 13px;
        }
        .sr-remove-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sr-edit-table tfoot td {
          background: var(--bg-muted);
          font-weight: 800;
          font-size: 0.9rem;
        }
        .sr-total-label { color: var(--color-text-muted); }
        .sr-total-value { text-align: end; direction: ltr; white-space: nowrap; }
        .sr-edit-foot { margin-bottom: 20px; }
        .sr-notes-field { margin-bottom: 0; }
        .sr-notes-field textarea { resize: vertical; min-height: 54px; }
        .sr-signatures-edit {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .sr-sig-edit-card { padding: 16px; }
        .sr-sig-edit-card .form-field { margin-bottom: 12px; }
        .sr-sig-edit-title {
          font-weight: 800;
          color: var(--color-text);
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
        }
        .signature-pad { position: relative; }
        .signature-pad__canvas {
          width: 100%;
          border: 1px dashed var(--color-border);
          border-radius: var(--radius-sm);
          background: #fff;
          touch-action: none;
        }
        .signature-pad__clear {
          position: absolute;
          top: 4px;
          inset-inline-start: 4px;
          width: 24px;
          height: 24px;
          line-height: 1;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: var(--color-surface);
          color: var(--color-text-muted);
          cursor: pointer;
        }

        @media (max-width: 900px) {
          .sr-edit-head { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        @media (max-width: 680px) {
          .scale-receipt-sheet { padding: 16px 14px; }
          .sr-edit-head { grid-template-columns: 1fr; gap: 10px; }
          .sr-signatures-edit { grid-template-columns: 1fr; }
        }

        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * { visibility: hidden !important; }
          .scale-receipt-print-container,
          .scale-receipt-print-container * { visibility: visible !important; }
          .scale-receipt-print-container {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            box-sizing: border-box !important;
          }
          .sr-doc {
            border: 2px solid #064e3b !important;
            border-radius: 6px !important;
            padding: 16px 20px !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }
          .sr-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            border-bottom: 2px solid #064e3b !important;
            padding-bottom: 10px !important;
            margin-bottom: 12px !important;
          }
          .sr-brand-section {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
          }
          .sr-logo {
            height: 48px !important;
            max-height: 48px !important;
            width: auto !important;
            object-fit: contain !important;
            display: block !important;
          }
          .sr-brand-name { margin: 0 !important; font-size: 19px !important; font-weight: 900 !important; color: #064e3b !important; }
          .sr-brand-en { margin: 2px 0 0 0 !important; font-size: 13px !important; font-weight: 800 !important; color: #047857 !important; letter-spacing: 0.5px !important; }
          .sr-doc-title { margin: 4px 0 0 0 !important; font-size: 15px !important; font-weight: 800 !important; color: #334155 !important; }
          .sr-meta { text-align: left !important; direction: ltr !important; }
          .sr-form-badge {
            display: inline-block !important;
            border: 1.5px solid #064e3b !important;
            background: #f0fdf4 !important;
            color: #064e3b !important;
            padding: 3px 10px !important;
            border-radius: 4px !important;
            font-size: 13px !important;
            font-weight: 900 !important;
          }
          .sr-receipt-no { margin-top: 4px !important; font-size: 14px !important; font-weight: 900 !important; color: #0f172a !important; }
          .sr-date { font-size: 11px !important; color: #475569 !important; margin-top: 2px !important; font-weight: 600 !important; }
          .sr-info-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 1fr) !important;
            gap: 6px !important;
            margin-bottom: 12px !important;
          }
          .sr-info-cell { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 5px 8px !important; }
          .sr-info-label { font-size: 10px !important; font-weight: 700 !important; color: #64748b !important; }
          .sr-info-value { font-size: 12.5px !important; font-weight: 800 !important; color: #0f172a !important; margin-top: 2px !important; }
          .sr-table { width: 100% !important; border-collapse: collapse !important; margin-bottom: 10px !important; }
          .sr-table th {
            background: #064e3b !important;
            color: #ffffff !important;
            padding: 6px 8px !important;
            font-size: 11.5px !important;
            font-weight: 800 !important;
            border: 1px solid #064e3b !important;
            text-align: right !important;
          }
          .sr-table td {
            padding: 6px 8px !important;
            border: 1px solid #cbd5e1 !important;
            font-size: 12px !important;
            color: #0f172a !important;
          }
          .sr-table-empty { text-align: center !important; color: #64748b !important; }
          .sr-totals-row td { font-weight: 900 !important; font-size: 13px !important; background: #f0fdf4 !important; }
          .sr-notes { border: 1px dashed #94a3b8 !important; background: #f8fafc !important; padding: 6px 10px !important; border-radius: 4px !important; font-size: 11.5px !important; margin-bottom: 12px !important; color: #334155 !important; }
          .sr-signatures {
            display: grid !important;
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 14px !important;
            margin-top: 14px !important;
            padding-top: 12px !important;
            border-top: 1.5px solid #064e3b !important;
          }
          .sr-sig-card { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 8px 10px !important; background: #ffffff !important; }
          .sr-sig-title { font-size: 12.5px !important; font-weight: 900 !important; color: #0f172a !important; margin-bottom: 8px !important; }
          .sr-sig-name { font-size: 11.5px !important; color: #334155 !important; font-weight: 700 !important; margin-bottom: 6px !important; }
          .sr-sig-image img { max-height: 56px !important; max-width: 180px !important; display: block !important; }
          .sr-sig-image span { font-size: 11px !important; color: #64748b !important; }
          .sr-footer {
            margin-top: 10px !important;
            padding-top: 6px !important;
            border-top: 1px solid #e2e8f0 !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            font-size: 10px !important;
            color: #64748b !important;
          }

          /* A4 single-page geometry and compact print rhythm. */
          @page { size: A4 portrait; margin: 0; }
          .scale-receipt-print-container {
            width: 210mm !important;
            height: 297mm !important;
            padding: 5mm !important;
            overflow: visible !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .sr-doc {
            width: 200mm !important;
            height: 287mm !important;
            padding: 4mm !important;
            overflow: visible !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .sr-header { padding-bottom: 2mm !important; margin-bottom: 3mm !important; }
          .sr-brand-section { gap: 3mm !important; }
          .sr-logo { width: 16mm !important; height: 16mm !important; max-height: 16mm !important; }
          .sr-brand-name { font-size: 14px !important; }
          .sr-brand-en { font-size: 9px !important; }
          .sr-doc-title { margin-top: 1mm !important; font-size: 11px !important; }
          .sr-form-badge, .sr-receipt-no { font-size: 9px !important; }
          .sr-form-badge { padding: 1mm 2mm !important; }
          .sr-date { font-size: 8px !important; }
          .sr-info-grid { gap: 1.5mm !important; margin-bottom: 2mm !important; }
          .sr-info-cell { padding: 1mm 1.5mm !important; }
          .sr-info-label { font-size: 8px !important; }
          .sr-info-value { margin-top: .5mm !important; font-size: 9px !important; overflow-wrap: anywhere !important; }
          .sr-table { table-layout: fixed !important; margin-bottom: 2mm !important; }
          .sr-table th, .sr-table td {
            padding: 1mm 1.5mm !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
          }
          .sr-totals-row td { font-size: 9px !important; }
          .sr-notes { padding: 1mm 1.5mm !important; margin-bottom: 2mm !important; font-size: 8.5px !important; line-height: 1.2 !important; }
          .sr-signatures { gap: 2mm !important; margin-top: 2mm !important; padding-top: 2mm !important; }
          .sr-sig-card { padding: 1.5mm !important; }
          .sr-sig-title { margin-bottom: 1.5mm !important; font-size: 9px !important; }
          .sr-sig-name { margin-bottom: 1mm !important; font-size: 8.5px !important; }
          .sr-sig-image img { max-height: 12mm !important; max-width: 36mm !important; }
          .sr-sig-image span { font-size: 8px !important; }
          .sr-footer { margin-top: 2mm !important; padding-top: 1.5mm !important; font-size: 8px !important; }
          .sr-doc { border: 1px solid #cbd5e1 !important; border-top: 3px solid #163a5f !important; border-radius: 2px !important; }
          .sr-header { border-bottom-color: #163a5f !important; }
          .sr-brand-name { color: #0f2942 !important; }
          .sr-brand-en, .sr-doc-title { color: #163a5f !important; }
          .sr-doc-title-en { margin-top: .3mm !important; color: #64748b !important; font-size: 7px !important; font-weight: 800 !important; letter-spacing: .7px !important; direction: ltr !important; }
          .sr-form-badge { color: #163a5f !important; background: #f1f5f9 !important; border-color: #cbd5e1 !important; border-radius: 2px !important; }
          .sr-info-cell { background: #f8fafc !important; border-color: #e2e8f0 !important; border-radius: 2px !important; border-top: 2px solid #163a5f !important; }
          .sr-info-label { color: #64748b !important; }
          .sr-info-value { color: #0f2942 !important; }
          .sr-table th { color: #fff !important; background: #163a5f !important; border-color: #163a5f !important; }
          .sr-table td { border-color: #cbd5e1 !important; }
          .sr-table tbody tr:nth-child(even) td { background: #f8fafc !important; }
          .sr-totals-row td { color: #0f2942 !important; background: #e8eef5 !important; border-top: 2px solid #163a5f !important; }
          .sr-notes { background: #f8fafc !important; border-color: #cbd5e1 !important; border-inline-start: 3px solid #163a5f !important; border-radius: 2px !important; }
          .sr-signatures { border-top-color: #163a5f !important; }
          .sr-sig-card { border-color: #e2e8f0 !important; border-radius: 2px !important; }
          .sr-sig-title { color: #0f2942 !important; }
          .sr-footer { color: #64748b !important; border-top-color: #cbd5e1 !important; }
        }
      `})]})}export{b as ScaleReceiptPage,b as default};