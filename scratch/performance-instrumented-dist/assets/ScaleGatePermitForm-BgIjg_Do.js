import{i as e,n as t,r as n,s as r}from"./I18nContext-B8z1OFo1.js";import{n as i,r as a}from"./index-Xw-z9X3u.js";import{n as o}from"./scaleApi-BHJB3X64.js";import{n as s}from"./ActionIconButton-BE2SE7B7.js";import{t as c}from"./SignaturePad-C3tPtx5J.js";var l=r(e(),1),u=n(),d=(e,t=2)=>Number(e||0).toLocaleString(`en-US`,{minimumFractionDigits:t,maximumFractionDigits:t}),f=e=>Number(e||0)/1e3,p=e=>{if(!e)return`—`;let t=new Date(`${e}T00:00:00`);return Number.isNaN(t.getTime())?e:t.toLocaleDateString(`ar-EG`,{year:`numeric`,month:`long`,day:`numeric`})};function m({type:e,form:t}){let n=e===`entry`,r=n?`EG.ST.F05`:`EG.ST.F06`,i=n?`تصريح دخول`:`تصريح خروج`,o=n?`SCALE ENTRY PERMIT`:`SCALE EXIT PERMIT`,s=n?`اسم المورد`:`اسم المشتري`,c=n?t.supplier_name:t.buyer_name,l=t.items||[],m=l.reduce((e,t)=>e+(Number(t.quantity_kg)||0),0),h=Number(t.gross_weight_kg)||0,g=Number(t.tare_weight_kg)||0,_=Number(t.net_weight_kg),v=!Number.isNaN(_)&&Number(_)>=0,y=n?[{name:t.gate_writer,sig:t.gate_writer_signature,title:`كاتب البوابة`},{name:t.inspection_head,sig:t.inspection_head_signature,title:`رئيس قسم التفتيش الوارد`},{name:t.scale_operator,sig:t.scale_operator_signature,title:`مسؤول الباسكول`},{name:t.general_manager,sig:t.general_manager_signature,title:`مدير عام الشركة`}]:[{name:t.responsible_person,sig:t.responsible_signature,title:`المسؤول`},{name:t.department_manager,sig:t.department_manager_signature,title:`مدير الإدارة`},{name:t.general_manager,sig:t.general_manager_signature,title:`مدير عام الشركة`}];return(0,u.jsxs)(`div`,{className:`gp-permit-print-container`,dir:`rtl`,children:[(0,u.jsxs)(`div`,{className:`gp-doc`,children:[(0,u.jsxs)(`div`,{className:`gp-header`,children:[(0,u.jsxs)(`div`,{className:`gp-brand-section`,children:[(0,u.jsx)(`img`,{src:a,alt:`EGAST Group`,className:`gp-logo`}),(0,u.jsxs)(`div`,{className:`gp-brand-text`,children:[(0,u.jsx)(`div`,{className:`gp-brand-name`,children:`الشركة المصرية للخدمات الزراعية`}),(0,u.jsx)(`div`,{className:`gp-brand-en`,children:`EGAST — Egyptian Agricultural Services Co.`}),(0,u.jsx)(`div`,{className:`gp-doc-title`,children:i}),(0,u.jsx)(`div`,{className:`gp-doc-title-en`,children:o})]})]}),(0,u.jsxs)(`div`,{className:`gp-meta`,children:[(0,u.jsxs)(`div`,{className:`gp-form-badge`,children:[`نموذج رقم: `,r]}),(0,u.jsxs)(`div`,{className:`gp-permit-no`,children:[`رقم التصريح: `,t.permit_number||`________________`]}),(0,u.jsxs)(`div`,{className:`gp-date`,children:[`التاريخ: `,p(t.permit_date)]})]})]}),(0,u.jsxs)(`div`,{className:`gp-info-grid`,children:[(0,u.jsxs)(`div`,{className:`gp-info-cell`,children:[(0,u.jsx)(`div`,{className:`gp-info-label`,children:`التاريخ`}),(0,u.jsx)(`div`,{className:`gp-info-value`,children:p(t.permit_date)})]}),(0,u.jsxs)(`div`,{className:`gp-info-cell`,children:[(0,u.jsx)(`div`,{className:`gp-info-label`,children:s}),(0,u.jsx)(`div`,{className:`gp-info-value`,children:c||`—`})]}),(0,u.jsxs)(`div`,{className:`gp-info-cell`,children:[(0,u.jsx)(`div`,{className:`gp-info-label`,children:`اسم السائق`}),(0,u.jsx)(`div`,{className:`gp-info-value`,children:t.driver_name||`—`})]}),!n&&(0,u.jsxs)(`div`,{className:`gp-info-cell`,children:[(0,u.jsx)(`div`,{className:`gp-info-label`,children:`الجهة`}),(0,u.jsx)(`div`,{className:`gp-info-value`,children:t.destination||`—`})]}),(0,u.jsxs)(`div`,{className:`gp-info-cell`,children:[(0,u.jsx)(`div`,{className:`gp-info-label`,children:`رقم السيارة`}),(0,u.jsx)(`div`,{className:`gp-info-value`,children:t.vehicle_number||`—`})]})]}),(0,u.jsxs)(`table`,{className:`gp-table`,children:[(0,u.jsx)(`thead`,{children:(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`th`,{children:`الرقم الكودي`}),(0,u.jsx)(`th`,{children:`اسم الصنف`}),(0,u.jsx)(`th`,{children:`العدد`}),(0,u.jsx)(`th`,{children:n?`مسجل كيلو`:`الوزن كيلو`}),(0,u.jsx)(`th`,{children:n?`مسجل طن`:`الوزن طن`}),(0,u.jsx)(`th`,{children:`ملاحظات`})]})}),(0,u.jsx)(`tbody`,{children:l.length?l.map((e,t)=>(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`td`,{children:e.item_code||`—`}),(0,u.jsx)(`td`,{children:e.item_name||`—`}),(0,u.jsx)(`td`,{children:e.count||0}),(0,u.jsx)(`td`,{children:d(e.quantity_kg)}),(0,u.jsx)(`td`,{children:d(f(e.quantity_kg),3)}),(0,u.jsx)(`td`,{children:e.notes||`—`})]},e.key||t)):(0,u.jsx)(`tr`,{children:(0,u.jsx)(`td`,{colSpan:`6`,className:`gp-table-empty`,children:`لا توجد أصناف مسجلة`})})}),(0,u.jsx)(`tfoot`,{children:(0,u.jsxs)(`tr`,{className:`gp-totals-row`,children:[(0,u.jsx)(`td`,{colSpan:`3`,children:`الإجمالي`}),(0,u.jsx)(`td`,{children:d(m)}),(0,u.jsx)(`td`,{children:d(f(m),3)}),(0,u.jsx)(`td`,{})]})})]}),n&&(0,u.jsx)(u.Fragment,{children:(0,u.jsxs)(`table`,{className:`gp-table gp-weight-table`,children:[(0,u.jsx)(`thead`,{children:(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`th`,{children:`بيان وزن الحمولة`}),(0,u.jsx)(`th`,{children:`كيلو`}),(0,u.jsx)(`th`,{children:`طن`})]})}),(0,u.jsxs)(`tbody`,{children:[(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`td`,{className:`gp-weight-label`,children:`القائم`}),(0,u.jsx)(`td`,{children:d(h)}),(0,u.jsx)(`td`,{children:d(f(h),3)})]}),(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`td`,{className:`gp-weight-label`,children:`الفارغ`}),(0,u.jsx)(`td`,{children:d(g)}),(0,u.jsx)(`td`,{children:d(f(g),3)})]}),(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`td`,{className:`gp-weight-label`,children:`الصافي`}),(0,u.jsx)(`td`,{children:v?d(_):`—`}),(0,u.jsx)(`td`,{children:v?d(f(_),3):`—`})]})]})]})}),n&&(t.inspection_result||t.gate_writer||t.inspection_head)&&(0,u.jsxs)(`div`,{className:`gp-inspection`,children:[(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`strong`,{children:`نتيجة الفحص والمعاينة: `}),t.inspection_result||`—`]}),(0,u.jsxs)(`div`,{className:`gp-inspection-sub`,children:[`كاتب البوابة: `,t.gate_writer||`—`,` · رئيس قسم التفتيش الوارد: `,t.inspection_head||`—`]})]}),t.weight_in_words&&(0,u.jsxs)(`div`,{className:`gp-only-amount`,children:[(0,u.jsx)(`strong`,{children:`فقط وقدره: `}),t.weight_in_words]}),t.notes&&(0,u.jsxs)(`div`,{className:`gp-notes`,children:[(0,u.jsx)(`strong`,{children:`ملاحظات: `}),t.notes]}),(0,u.jsx)(`div`,{className:`gp-signatures`,children:y.map(e=>(0,u.jsxs)(`div`,{className:`gp-sig-card`,children:[(0,u.jsx)(`div`,{className:`gp-sig-title`,children:e.title}),(0,u.jsxs)(`div`,{className:`gp-sig-name`,children:[`الاسم: `,e.name||`________________`]}),(0,u.jsx)(`div`,{className:`gp-sig-image`,children:e.sig?(0,u.jsx)(`img`,{src:e.sig,alt:``}):(0,u.jsx)(`span`,{children:`التوقيع: ________________`})})]},e.title))}),(0,u.jsxs)(`div`,{className:`gp-footer`,children:[(0,u.jsx)(`div`,{children:`نظام إدارة الميزان والبسكول — EGAST ERP Weighbridge System`}),(0,u.jsx)(`div`,{children:`مستند رسمي معتمد · صفحة 1 من 1`})]})]}),(0,u.jsx)(`style`,{children:`
        .gp-permit-print-container { display: none; }

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
          .gp-permit-print-container,
          .gp-permit-print-container * { visibility: visible !important; }
          .gp-permit-print-container {
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
          .gp-doc {
            border: 2px solid #064e3b !important;
            border-radius: 6px !important;
            padding: 16px 20px !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }
          .gp-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            border-bottom: 2px solid #064e3b !important;
            padding-bottom: 10px !important;
            margin-bottom: 12px !important;
          }
          .gp-brand-section {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
          }
          .gp-logo {
            height: 48px !important;
            max-height: 48px !important;
            width: auto !important;
            object-fit: contain !important;
            display: block !important;
          }
          .gp-brand-name { margin: 0 !important; font-size: 19px !important; font-weight: 900 !important; color: #064e3b !important; }
          .gp-brand-en { margin: 2px 0 0 0 !important; font-size: 13px !important; font-weight: 800 !important; color: #047857 !important; letter-spacing: 0.5px !important; }
          .gp-doc-title { margin: 4px 0 0 0 !important; font-size: 15px !important; font-weight: 800 !important; color: #334155 !important; }
          .gp-meta { text-align: left !important; direction: ltr !important; }
          .gp-form-badge {
            display: inline-block !important;
            border: 1.5px solid #064e3b !important;
            background: #f0fdf4 !important;
            color: #064e3b !important;
            padding: 3px 10px !important;
            border-radius: 4px !important;
            font-size: 13px !important;
            font-weight: 900 !important;
          }
          .gp-permit-no { margin-top: 4px !important; font-size: 14px !important; font-weight: 900 !important; color: #0f172a !important; }
          .gp-date { font-size: 11px !important; color: #475569 !important; margin-top: 2px !important; font-weight: 600 !important; }
          .gp-info-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 1fr) !important;
            gap: 6px !important;
            margin-bottom: 12px !important;
          }
          .gp-info-cell { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 5px 8px !important; }
          .gp-info-label { font-size: 10px !important; font-weight: 700 !important; color: #64748b !important; }
          .gp-info-value { font-size: 12.5px !important; font-weight: 800 !important; color: #0f172a !important; margin-top: 2px !important; }
          .gp-table { width: 100% !important; border-collapse: collapse !important; margin-bottom: 10px !important; }
          .gp-table th {
            background: #064e3b !important;
            color: #ffffff !important;
            padding: 6px 8px !important;
            font-size: 11.5px !important;
            font-weight: 800 !important;
            border: 1px solid #064e3b !important;
            text-align: right !important;
          }
          .gp-table td {
            padding: 6px 8px !important;
            border: 1px solid #cbd5e1 !important;
            font-size: 12px !important;
            color: #0f172a !important;
            text-align: right !important;
          }
          .gp-table-empty { text-align: center !important; color: #64748b !important; }
          .gp-totals-row td { font-weight: 900 !important; font-size: 13px !important; background: #f0fdf4 !important; }
          .gp-weight-table { width: 45% !important; }
          .gp-weight-label { font-weight: 800 !important; }
          .gp-inspection {
            border: 1px dashed #94a3b8 !important;
            background: #f8fafc !important;
            padding: 6px 10px !important;
            border-radius: 4px !important;
            font-size: 11.5px !important;
            margin-bottom: 8px !important;
            color: #334155 !important;
          }
          .gp-inspection-sub { margin-top: 4px !important; font-size: 11px !important; color: #475569 !important; }
          .gp-only-amount, .gp-notes {
            border: 1px dashed #94a3b8 !important;
            background: #f8fafc !important;
            padding: 6px 10px !important;
            border-radius: 4px !important;
            font-size: 11.5px !important;
            margin-bottom: 8px !important;
            color: #334155 !important;
          }
          .gp-signatures {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 12px !important;
            margin-top: 14px !important;
            padding-top: 12px !important;
            border-top: 1.5px solid #064e3b !important;
          }
          .gp-sig-card { border: 1px solid #cbd5e1 !important; border-radius: 4px !important; padding: 8px 10px !important; background: #ffffff !important; }
          .gp-sig-title { font-size: 12.5px !important; font-weight: 900 !important; color: #0f172a !important; margin-bottom: 8px !important; }
          .gp-sig-name { font-size: 11.5px !important; color: #334155 !important; font-weight: 700 !important; margin-bottom: 6px !important; }
          .gp-sig-image img { max-height: 52px !important; max-width: 150px !important; display: block !important; }
          .gp-sig-image span { font-size: 11px !important; color: #64748b !important; }
          .gp-sig-card:nth-child(4) { grid-column: 4; }
          .gp-signatures:has(.gp-sig-card:nth-child(3)) { grid-template-columns: repeat(3, 1fr) !important; }
          .gp-footer {
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
          .gp-permit-print-container {
            width: 210mm !important;
            height: 297mm !important;
            padding: 5mm !important;
            overflow: visible !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .gp-doc {
            width: 200mm !important;
            height: 287mm !important;
            padding: 4mm !important;
            overflow: visible !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .gp-header { padding-bottom: 2mm !important; margin-bottom: 3mm !important; }
          .gp-brand-section { gap: 3mm !important; }
          .gp-logo { width: 16mm !important; height: 16mm !important; max-height: 16mm !important; }
          .gp-brand-name { font-size: 14px !important; }
          .gp-brand-en { font-size: 9px !important; }
          .gp-doc-title { margin-top: 1mm !important; font-size: 11px !important; }
          .gp-form-badge, .gp-permit-no { font-size: 9px !important; }
          .gp-form-badge { padding: 1mm 2mm !important; }
          .gp-date { font-size: 8px !important; }
          .gp-info-grid { gap: 1.5mm !important; margin-bottom: 2mm !important; }
          .gp-info-cell { padding: 1mm 1.5mm !important; }
          .gp-info-label { font-size: 8px !important; }
          .gp-info-value { margin-top: .5mm !important; font-size: 9px !important; overflow-wrap: anywhere !important; }
          .gp-table { table-layout: fixed !important; margin-bottom: 2mm !important; }
          .gp-table th, .gp-table td {
            padding: 1mm 1.5mm !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
          }
          .gp-totals-row td { font-size: 9px !important; }
          .gp-inspection, .gp-only-amount, .gp-notes {
            padding: 1mm 1.5mm !important;
            margin-bottom: 2mm !important;
            font-size: 8.5px !important;
            line-height: 1.2 !important;
          }
          .gp-inspection-sub { margin-top: 1mm !important; font-size: 8px !important; }
          .gp-signatures { gap: 2mm !important; margin-top: 2mm !important; padding-top: 2mm !important; }
          .gp-sig-card { padding: 1.5mm !important; }
          .gp-sig-title { margin-bottom: 1.5mm !important; font-size: 9px !important; }
          .gp-sig-name { margin-bottom: 1mm !important; font-size: 8.5px !important; }
          .gp-sig-image img { max-height: 12mm !important; max-width: 32mm !important; }
          .gp-sig-image span { font-size: 8px !important; }
          .gp-footer { margin-top: 2mm !important; padding-top: 1.5mm !important; font-size: 8px !important; }
          .gp-doc { border: 1px solid #cbd5e1 !important; border-top: 3px solid #163a5f !important; border-radius: 2px !important; }
          .gp-header { border-bottom-color: #163a5f !important; }
          .gp-brand-name { color: #0f2942 !important; }
          .gp-brand-en, .gp-doc-title { color: #163a5f !important; }
          .gp-doc-title-en { margin-top: .3mm !important; color: #64748b !important; font-size: 7px !important; font-weight: 800 !important; letter-spacing: .7px !important; direction: ltr !important; }
          .gp-form-badge { color: #163a5f !important; background: #f1f5f9 !important; border-color: #cbd5e1 !important; border-radius: 2px !important; }
          .gp-info-cell { background: #f8fafc !important; border-color: #e2e8f0 !important; border-radius: 2px !important; border-top: 2px solid #163a5f !important; }
          .gp-info-label { color: #64748b !important; }
          .gp-info-value { color: #0f2942 !important; }
          .gp-table th { color: #fff !important; background: #163a5f !important; border-color: #163a5f !important; }
          .gp-table td { border-color: #cbd5e1 !important; }
          .gp-table tbody tr:nth-child(even) td { background: #f8fafc !important; }
          .gp-totals-row td { color: #0f2942 !important; background: #e8eef5 !important; border-top: 2px solid #163a5f !important; }
          .gp-weight-table tbody tr:last-child td { color: #2e7d32 !important; background: #eef7ef !important; font-weight: 900 !important; }
          .gp-inspection, .gp-only-amount, .gp-notes { background: #f8fafc !important; border-color: #cbd5e1 !important; border-inline-start: 3px solid #163a5f !important; border-radius: 2px !important; }
          .gp-signatures { border-top-color: #163a5f !important; }
          .gp-sig-card { border-color: #e2e8f0 !important; border-radius: 2px !important; }
          .gp-sig-title { color: #0f2942 !important; }
          .gp-footer { color: #64748b !important; border-top-color: #cbd5e1 !important; }
        }
      `})]})}var h=0,g=()=>`row-${Date.now()}-${h++}`,_=()=>{let e=new Date,t=String(e.getMonth()+1).padStart(2,`0`),n=String(e.getDate()).padStart(2,`0`);return`${e.getFullYear()}-${t}-${n}`},v=e=>{let t=String(e??``).trim();if(t===``)return``;let n=Number(t);return Number.isNaN(n)?``:Math.max(0,n).toString()},y=(e,t=2)=>Number(e||0).toLocaleString(`en-US`,{minimumFractionDigits:t,maximumFractionDigits:t}),b=e=>({permit_number:``,permit_type:e,permit_date:_(),supplier_name:``,buyer_name:``,driver_name:``,destination:``,vehicle_number:``,inspection_result:``,gate_writer:``,inspection_head:``,gross_weight_kg:``,tare_weight_kg:``,net_weight_kg:``,scale_operator:``,general_manager:``,responsible_person:``,department_manager:``,weight_in_words:``,notes:``,items:[{key:g(),item_code:``,item_name:``,count:`1`,quantity_kg:`0`,notes:``}],gate_writer_signature:``,inspection_head_signature:``,scale_operator_signature:``,general_manager_signature:``,responsible_signature:``,department_manager_signature:``});function x({type:e}){let{t:n}=t(),r=i(),a=e===`entry`,[d,f]=(0,l.useState)(()=>b(e)),[p,h]=(0,l.useState)(null),[x,S]=(0,l.useState)(!1),C=(e,t)=>{f(n=>({...n,[e]:t}))},w=(e,t,n)=>{let r=t===`count`||t===`quantity_kg`?v(n):n;f(n=>({...n,items:n.items.map(n=>n.key===e?{...n,[t]:r}:n)}))},T=()=>{f(e=>({...e,items:[...e.items,{key:g(),item_code:``,item_name:``,count:`1`,quantity_kg:`0`,notes:``}]}))},E=e=>{f(t=>({...t,items:t.items.length>1?t.items.filter(t=>t.key!==e):t.items}))},D=Number(d.gross_weight_kg)||0,O=Number(d.tare_weight_kg)||0,k=D-O,A=d.gross_weight_kg!==``&&Number(d.gross_weight_kg)>=0&&D>=O,j=e=>{let t=e.items.map(e=>{let t=Number(e.quantity_kg)||0;return{item_code:e.item_code.trim(),item_name:e.item_name.trim(),count:Math.max(0,Number(e.count)||0),quantity_kg:t,quantity_ton:t/1e3,notes:e.notes.trim()}}).filter(e=>e.item_name||e.item_code||e.quantity_kg>0),n={permit_type:e.permit_type,permit_date:e.permit_date||_(),driver_name:e.driver_name.trim(),vehicle_number:e.vehicle_number.trim(),weight_in_words:e.weight_in_words.trim(),notes:e.notes.trim(),items:t,general_manager:e.general_manager.trim(),general_manager_signature:e.general_manager_signature||``};if(a){let t=Number(e.gross_weight_kg),r=Number(e.tare_weight_kg);return{...n,supplier_name:e.supplier_name.trim(),inspection_result:e.inspection_result.trim(),gate_writer:e.gate_writer.trim(),inspection_head:e.inspection_head.trim(),gross_weight_kg:e.gross_weight_kg===``?null:t,tare_weight_kg:e.tare_weight_kg===``?null:r,net_weight_kg:t>=r&&e.gross_weight_kg!==``?Number((t-r).toFixed(2)):null,scale_operator:e.scale_operator.trim(),gate_writer_signature:e.gate_writer_signature||``,inspection_head_signature:e.inspection_head_signature||``,scale_operator_signature:e.scale_operator_signature||``}}return{...n,buyer_name:e.buyer_name.trim(),destination:e.destination.trim(),responsible_person:e.responsible_person.trim(),department_manager:e.department_manager.trim(),responsible_signature:e.responsible_signature||``,department_manager_signature:e.department_manager_signature||``}},M=async()=>{S(!0);try{let e=j(d),t=!!p,i=t?await o.updateEntryExitPermit(p,e):await o.createEntryExitPermit(e);return h(i.data.id),f(e=>({...e,permit_number:i.data.permit_number})),r.success(n(t?`scale.permitUpdatedSuccess`:`scale.permitSavedSuccess`)),i.data}catch(e){let t=e?.response?.data?.errors;return r.error(t?JSON.stringify(t):e?.response?.data?.error||e.message),null}finally{S(!1)}},N=()=>{(d.vehicle_number||d.driver_name||d.supplier_name||d.buyer_name||d.items.some(e=>e.item_name||e.item_code||Number(e.quantity_kg)>0))&&!window.confirm(n(`scale.confirmClearPermit`))||(h(null),f(b(e)))},P=d.items.reduce((e,t)=>e+(Number(t.quantity_kg)||0),0),F=P/1e3,I=a?[{label:n(`scale.permitDate`),children:(0,u.jsx)(`input`,{className:`app-input`,type:`date`,value:d.permit_date,onChange:e=>C(`permit_date`,e.target.value)})},{label:n(`scale.supplierName`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.supplier_name,onChange:e=>C(`supplier_name`,e.target.value)})},{label:n(`scale.permitDriverName`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.driver_name,onChange:e=>C(`driver_name`,e.target.value)})},{label:n(`scale.vehicleNumber`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.vehicle_number,onChange:e=>C(`vehicle_number`,e.target.value)})}]:[{label:n(`scale.permitDate`),children:(0,u.jsx)(`input`,{className:`app-input`,type:`date`,value:d.permit_date,onChange:e=>C(`permit_date`,e.target.value)})},{label:n(`scale.buyerName`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.buyer_name,onChange:e=>C(`buyer_name`,e.target.value)})},{label:n(`scale.destination`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.destination,onChange:e=>C(`destination`,e.target.value)})},{label:n(`scale.permitDriverName`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.driver_name,onChange:e=>C(`driver_name`,e.target.value)})},{label:n(`scale.vehicleNumber`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.vehicle_number,onChange:e=>C(`vehicle_number`,e.target.value)})}],L=[{label:n(`scale.gateWriter`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.gate_writer,onChange:e=>C(`gate_writer`,e.target.value)})},{label:n(`scale.inspectionHead`),children:(0,u.jsx)(`input`,{className:`app-input`,value:d.inspection_head,onChange:e=>C(`inspection_head`,e.target.value)})}],R=[{label:n(`scale.grossWeight`),children:(0,u.jsx)(`input`,{className:`app-input pe-num-input`,type:`number`,min:`0`,step:`0.01`,value:d.gross_weight_kg,onChange:e=>C(`gross_weight_kg`,v(e.target.value))})},{label:n(`scale.tareWeight`),children:(0,u.jsx)(`input`,{className:`app-input pe-num-input`,type:`number`,min:`0`,step:`0.01`,value:d.tare_weight_kg,onChange:e=>C(`tare_weight_kg`,v(e.target.value))})},{label:`${n(`scale.netWeight`)} (${n(`scale.kgLabel`)})`,children:(0,u.jsx)(`input`,{className:`app-input pe-num-input pe-readonly`,readOnly:!0,value:A?y(k):``})},{label:`${n(`scale.netWeight`)} (${n(`scale.tonLabel`)})`,children:(0,u.jsx)(`input`,{className:`app-input pe-num-input pe-readonly`,readOnly:!0,value:A?y(k/1e3,3):``})}],z=a?[{key:`gate_writer`,title:n(`scale.gateWriter`),name:d.gate_writer,signature:d.gate_writer_signature,nameField:`gate_writer`,sigField:`gate_writer_signature`},{key:`inspection_head`,title:n(`scale.inspectionHead`),name:d.inspection_head,signature:d.inspection_head_signature,nameField:`inspection_head`,sigField:`inspection_head_signature`},{key:`scale_operator`,title:n(`scale.scaleOperator`),name:d.scale_operator,signature:d.scale_operator_signature,nameField:`scale_operator`,sigField:`scale_operator_signature`},{key:`general_manager`,title:n(`scale.generalManager`),name:d.general_manager,signature:d.general_manager_signature,nameField:`general_manager`,sigField:`general_manager_signature`}]:[{key:`responsible`,title:n(`scale.responsiblePerson`),name:d.responsible_person,signature:d.responsible_signature,nameField:`responsible_person`,sigField:`responsible_signature`},{key:`department`,title:n(`scale.departmentManager`),name:d.department_manager,signature:d.department_manager_signature,nameField:`department_manager`,sigField:`department_manager_signature`},{key:`general_manager`,title:n(`scale.generalManager`),name:d.general_manager,signature:d.general_manager_signature,nameField:`general_manager`,sigField:`general_manager_signature`}];return(0,u.jsxs)(`div`,{className:`scale-permit-form`,children:[(0,u.jsxs)(`div`,{className:`pe-toolbar`,children:[(0,u.jsx)(`button`,{type:`button`,className:`app-button app-button--primary`,disabled:x,onClick:M,children:x?`...`:`💾 ${n(`scale.savePermit`)}`}),(0,u.jsx)(s,{icon:`🖨️`,disabled:x,onClick:()=>window.print()}),(0,u.jsx)(`button`,{type:`button`,className:`app-button`,onClick:N,children:n(`scale.clearPermit`)}),d.permit_number&&(0,u.jsx)(`span`,{className:`pe-permit-number`,children:d.permit_number})]}),(0,u.jsxs)(`div`,{className:`card-panel pe-sheet`,children:[(0,u.jsx)(`div`,{className:`pe-head`,children:I.map((e,t)=>(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:e.label}),e.children]},t))}),(0,u.jsxs)(`div`,{className:`pe-section-head`,children:[(0,u.jsx)(`h2`,{children:n(`scale.productsTable`)}),(0,u.jsxs)(`button`,{type:`button`,className:`app-button app-button--primary app-button--sm`,onClick:T,children:[`＋ `,n(`scale.addRow`)]})]}),(0,u.jsx)(`div`,{className:`pe-table-scroll`,children:(0,u.jsxs)(`table`,{className:`pe-edit-table`,children:[(0,u.jsx)(`thead`,{children:(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`th`,{children:n(`scale.itemCode`)}),(0,u.jsx)(`th`,{children:n(`scale.itemName`)}),(0,u.jsx)(`th`,{children:n(`scale.count`)}),(0,u.jsx)(`th`,{children:n(a?`scale.recordKg`:`scale.weightKg`)}),(0,u.jsx)(`th`,{children:n(`scale.tonLabel`)}),(0,u.jsx)(`th`,{children:n(`scale.notes`)}),(0,u.jsx)(`th`,{})]})}),(0,u.jsx)(`tbody`,{children:d.items.map(e=>(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`td`,{children:(0,u.jsx)(`input`,{className:`app-input`,value:e.item_code,onChange:t=>w(e.key,`item_code`,t.target.value)})}),(0,u.jsx)(`td`,{children:(0,u.jsx)(`input`,{className:`app-input`,value:e.item_name,onChange:t=>w(e.key,`item_name`,t.target.value)})}),(0,u.jsx)(`td`,{children:(0,u.jsx)(`input`,{className:`app-input pe-num-input`,type:`number`,min:`0`,value:e.count,onChange:t=>w(e.key,`count`,t.target.value)})}),(0,u.jsx)(`td`,{children:(0,u.jsx)(`input`,{className:`app-input pe-num-input`,type:`number`,min:`0`,step:`0.01`,value:e.quantity_kg,onChange:t=>w(e.key,`quantity_kg`,t.target.value)})}),(0,u.jsx)(`td`,{children:(0,u.jsx)(`input`,{className:`app-input pe-num-input pe-readonly`,readOnly:!0,value:y((Number(e.quantity_kg)||0)/1e3,3)})}),(0,u.jsx)(`td`,{children:(0,u.jsx)(`input`,{className:`app-input`,value:e.notes,onChange:t=>w(e.key,`notes`,t.target.value)})}),(0,u.jsx)(`td`,{children:(0,u.jsx)(`button`,{type:`button`,className:`pe-remove-btn`,onClick:()=>E(e.key),disabled:d.items.length===1,title:n(`scale.removeRow`),children:`✕`})})]},e.key))}),(0,u.jsx)(`tfoot`,{children:(0,u.jsxs)(`tr`,{children:[(0,u.jsx)(`td`,{colSpan:`3`,className:`pe-total-label`,children:n(`scale.totalKg`)}),(0,u.jsx)(`td`,{className:`pe-total-value`,children:y(P)}),(0,u.jsx)(`td`,{className:`pe-total-value`,children:y(F,3)}),(0,u.jsx)(`td`,{colSpan:`2`})]})})]})}),a&&(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)(`div`,{className:`pe-detail-grid`,children:[(0,u.jsxs)(`div`,{className:`pe-detail-card card-panel`,children:[(0,u.jsx)(`h3`,{className:`pe-detail-title`,children:n(`scale.inspectionSection`)}),(0,u.jsxs)(`div`,{className:`pe-detail-fields`,children:[L.map((e,t)=>(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:e.label}),e.children]},t)),(0,u.jsxs)(`div`,{className:`form-field pe-full`,children:[(0,u.jsx)(`label`,{children:n(`scale.inspectionResult`)}),(0,u.jsx)(`textarea`,{className:`app-input`,rows:`2`,value:d.inspection_result,onChange:e=>C(`inspection_result`,e.target.value)})]})]})]}),(0,u.jsxs)(`div`,{className:`pe-detail-card card-panel`,children:[(0,u.jsx)(`h3`,{className:`pe-detail-title`,children:n(`scale.weighingSection`)}),(0,u.jsxs)(`div`,{className:`pe-detail-fields`,children:[R.map((e,t)=>(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:e.label}),e.children]},t)),(0,u.jsxs)(`div`,{className:`form-field pe-full`,children:[(0,u.jsx)(`label`,{children:n(`scale.onlyAndAmount`)}),(0,u.jsx)(`input`,{className:`app-input`,value:d.weight_in_words,onChange:e=>C(`weight_in_words`,e.target.value)})]})]})]})]}),(0,u.jsx)(`div`,{className:`pe-detail-card card-panel pe-notes-card`,children:(0,u.jsxs)(`div`,{className:`form-field pe-notes-field`,children:[(0,u.jsx)(`label`,{children:n(`scale.notes`)}),(0,u.jsx)(`textarea`,{className:`app-input`,rows:`2`,value:d.notes,onChange:e=>C(`notes`,e.target.value)})]})})]}),!a&&(0,u.jsx)(`div`,{className:`pe-detail-card card-panel pe-notes-card`,children:(0,u.jsxs)(`div`,{className:`pe-notes-grid`,children:[(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:n(`scale.onlyAndAmount`)}),(0,u.jsx)(`input`,{className:`app-input`,value:d.weight_in_words,onChange:e=>C(`weight_in_words`,e.target.value)})]}),(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:n(`scale.notes`)}),(0,u.jsx)(`textarea`,{className:`app-input`,rows:`1`,value:d.notes,onChange:e=>C(`notes`,e.target.value)})]})]})}),(0,u.jsx)(`div`,{className:`pe-signatures-edit`,children:z.map(e=>(0,u.jsxs)(`div`,{className:`pe-sig-edit-card card-panel`,children:[(0,u.jsx)(`div`,{className:`pe-sig-edit-title`,children:e.title}),(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:n(`scale.signatureName`)}),(0,u.jsx)(`input`,{className:`app-input`,value:e.name,onChange:t=>C(e.nameField,t.target.value)})]}),(0,u.jsxs)(`div`,{className:`form-field`,children:[(0,u.jsx)(`label`,{children:n(`scale.signatureDraw`)}),(0,u.jsx)(c,{value:e.signature,onChange:t=>C(e.sigField,t||``)})]})]},e.key))})]}),(0,u.jsx)(m,{type:e,form:d}),(0,u.jsx)(`style`,{children:`
        .scale-permit-page {
          width: min(1100px, 100%);
          margin: 0 auto;
          padding-bottom: 32px;
        }
        .scale-permit-page .page-header {
          margin: 0 0 14px;
        }
        .scale-permit-form { }
        .pe-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          margin: 0 auto 14px;
          width: min(1100px, 100%);
        }
        .pe-toolbar .app-button { min-height: 40px; }
        .pe-permit-number {
          margin-inline-start: auto;
          font-weight: 800;
          color: var(--color-primary);
          background: var(--color-primary-soft);
          border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
          border-radius: var(--radius-sm);
          padding: 4px 12px;
        }
        .pe-sheet {
          width: min(1100px, 100%);
          margin: 0 auto;
          padding: 18px 24px;
        }
        .pe-head {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }
        .pe-head .form-field { margin-bottom: 0; }
        .pe-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .pe-section-head h2 { margin: 0; font-size: 1.1rem; color: var(--color-text); }
        .pe-table-scroll { overflow-x: auto; margin-bottom: 12px; }
        .pe-edit-table { width: 100%; min-width: 760px; border-collapse: collapse; }
        .pe-edit-table th {
          background: var(--bg-muted);
          color: var(--color-text-muted);
          text-align: start;
          padding: 8px 10px;
          font-size: 0.84rem;
          border: 1px solid var(--color-border);
        }
        .pe-edit-table td {
          padding: 6px 8px;
          border: 1px solid var(--color-border);
          vertical-align: middle;
        }
        .pe-edit-table .app-input { min-width: 0; width: 100%; padding: 6px 8px; }
        .pe-num-input { text-align: end; direction: ltr; }
        .pe-readonly { background: var(--bg-muted); color: var(--color-text-muted); }
        .pe-remove-btn {
          width: 28px;
          height: 28px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--danger, #dc2626);
          cursor: pointer;
          font-size: 13px;
        }
        .pe-remove-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pe-edit-table tfoot td {
          background: var(--bg-muted);
          font-weight: 800;
          font-size: 0.9rem;
        }
        .pe-total-label { color: var(--color-text-muted); }
        .pe-total-value { text-align: end; direction: ltr; white-space: nowrap; }
        .pe-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 14px;
        }
        .pe-detail-card { padding: 14px 16px; margin-bottom: 14px; }
        .pe-detail-grid .pe-detail-card { margin-bottom: 0; }
        .pe-detail-title {
          font-weight: 800;
          color: var(--color-text);
          margin: 0 0 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
          font-size: 1rem;
        }
        .pe-detail-fields {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px 12px;
        }
        .pe-detail-fields .form-field { margin-bottom: 0; }
        .pe-detail-fields .pe-full { grid-column: 1 / -1; }
        .pe-full textarea { resize: vertical; min-height: 54px; }
        .pe-notes-card { margin-bottom: 14px; }
        .pe-notes-field { margin-bottom: 0; }
        .pe-notes-field textarea { resize: vertical; min-height: 54px; }
        .pe-notes-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .pe-notes-grid .form-field { margin-bottom: 0; }
        .pe-signatures-edit {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .pe-sig-edit-card { padding: 14px 16px; }
        .pe-sig-edit-card .form-field { margin-bottom: 10px; }
        .pe-sig-edit-title {
          font-weight: 800;
          color: var(--color-text);
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--color-border);
        }
        .signature-pad { position: relative; }
        .signature-pad__canvas {
          width: 100%;
          border: 1px dashed var(--color-border);
          border-radius: var(--radius-sm);
          background: var(--color-surface);
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
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
          background: var(--color-surface-muted);
          color: var(--color-text-muted);
          cursor: pointer;
        }

        @media (max-width: 980px) {
          .pe-signatures-edit { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .pe-detail-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 680px) {
          .pe-sheet { padding: 16px 14px; }
          .pe-signatures-edit { grid-template-columns: 1fr; }
          .pe-notes-grid { grid-template-columns: 1fr; }
        }
      `})]})}export{x as t};