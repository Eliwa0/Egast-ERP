// UI-only audit against an isolated Chrome profile. All API traffic is intercepted;
// fixtures exercise layout, never production authentication or business workflows.
// Start Vite on 5173 and isolated headless Chrome with --remote-debugging-port=9555.
// Run: node scripts/audit-responsive.mjs [before|after]
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const resizeMatrix=process.env.AUDIT_RESIZE_MATRIX==='1';
const sourceHashes=Object.fromEntries(await Promise.all(['App.jsx','styles/global.css','styles/responsive-mobile.css','styles/pages/sales-readiness.css'].map(async file=>[file,createHash('sha256').update(await fs.readFile(new URL('../src/'+file,import.meta.url))).digest('hex')])));

const origin = process.env.AUDIT_ORIGIN || 'http://127.0.0.1:5173';
const auditTheme = process.env.AUDIT_THEME === 'dark' ? 'dark' : 'light';
const debugOrigin = `http://127.0.0.1:${process.env.AUDIT_CHROME_PORT || '9555'}`;
const version = await fetch(debugOrigin + '/json/version').then(r=>r.json());
const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r=>browserSocket.addEventListener('open',r,{once:true}));
let browserSeq=0;
const browserPending=new Map();
browserSocket.addEventListener('message',({data})=>{const m=JSON.parse(data),p=browserPending.get(m.id);if(p){browserPending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
const browserSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++browserSeq;browserPending.set(id,{resolve,reject});browserSocket.send(JSON.stringify({id,method,params}));});
const {browserContextId}=await browserSend('Target.createBrowserContext',{disposeOnDetach:true});
const {targetId}=await browserSend('Target.createTarget',{url:'about:blank',browserContextId});
const target=(await fetch(debugOrigin+'/json/list').then(r=>r.json())).find(t=>t.id===targetId);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('Audit browser disconnected; saved results are partial')); pending.clear(); });
const requests = new Set();
const blockedWrites = [];
const simulatedWrites = [];
const networkURLs = new Map();
const touch = process.env.AUDIT_TOUCH === '1';
const fixtureMode = process.env.AUDIT_DATA || 'populated';
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const longName = 'مورد المنتجات الزراعية والتعبئة والشحن الدولي — Agricultural Packaging and Shipping';
const record = { id: 1, status: 'POSTED', vendor_name: longName, vendor_card_code: 'V0001',
  item_name: longName, item_code: 'ITEM-001', car_number: 'ABC-12345', vehicle_number: 'ABC-12345',
  posting_date: '2026-09-23', inspection_date: '2026-09-23', batch_number: 'BATCH-2026-001',
  total_payment_due: 123456.78, currency: 'EGP', posted_by: 'Responsive Audit', sap_doc_num: 12345,
  lines: [], batches: [], samples: [], criteria: [], details: [], quantity: 1234, uom_code: 'KG' };
const user = { username: 'Responsive Audit', role: 'admin', is_superuser: true };
function fixture(url) {
  const p = new URL(url).pathname;
  if (p.includes('/shipping/')) return { operations: [], next_offset: null, orders: [], pallets: [], locations: [] };
  if (fixtureMode === 'empty' && !p.endsWith('/me/')) return { success: true, data: [], records: [], orders: [], drafts: [], devices: [], items: [], users: [], count: 0 };
  if (new URL(url).port === '8998') return { status: 'offline' };
  if (p.endsWith('/me/')) return { success: true, data: user };
  const scaleDraft = { ...record, status: 'COMPLETED', draft_number: 'AUDIT-001', is_closed: true,
    product_weight: 12345, net_weight_loaded: 22345, net_weight_empty: 10000,
    effective_vehicle_number: 'ABC-12345', effective_driver_name: longName, allocations: [], draft_elements: [] };
  if (/\/scale\/drafts\/\d+\/$/.test(p)) return { success: true, data: scaleDraft };
  if (p.endsWith('/scale/drafts/')) return { success: true, data: [scaleDraft] };
  if (p.endsWith('/scale/devices/')) return { success: true, data: { devices: [] } };
  if (p.endsWith('/scale/filter-options/')) return { success: true, data: {} };
  if (p.includes('/scale/')) return { success: true, data: [], devices: [], drafts: [], results: [], count: 0 };
  if (/purchase-quotations\/\d+\/$|grpo-drafts\/\d+\/$/.test(p)) return { success: true, data: { draft: { ...record, status: 'DRAFT' } } };
  const order = { ...record, sales_order_doc_entry: 1, sales_order_doc_num: 10001, customer_name: longName, customer_code: 'C0001', ordered_quantity: 1000, delivered_quantity: 100, remaining_open_quantity: 900, has_remaining: true, lines: [], items: [], delivery_status: 'PARTIAL' };
  if (p.includes('/customization-delivery/') && /documents\/\d+\/$/.test(p)) return { success: true, document: { ...order, doc_entry: 1, doc_num: 10001 } };
  const data = { records: [record], shipments: [{ ...record, source_type: 'quality', inspection_id: 1 }],
    inspections: [{ ...record, status: 'PENDING_REVIEW', decision: 'Accepted' }],
    drafts: [{ ...record, status: 'DRAFT' }],
    receipts: [{ ...record, status: 'PENDING_REVIEW', order_number: 12345, warehouse_code: 'WH01',
      batches: [{ id: 1, batch_number: 'BATCH-001', quantity: 123, unit_count: 10, vendor: longName }] }],
    transfers: [{ ...record, status: 'PENDING', lines: [{ item_code: 'ITEM-001', item_name: longName, quantity: 123, batch_number: 'BATCH-001' }] }], users: [], orders: [order],
    items: [], warehouses: [{ code: 'WH01', name: longName, WarehouseCode: 'WH01', WarehouseName: longName }],
    stages: [], categories: [], criteria: [], mappings: [], rules: [], locations: [] };
  return { success: true, document: { ...order, doc_entry: 1, doc_num: 10001 }, data, ...data, farms: [], contractors: [], item_groups: [], currencies: [], cost_centers: [] };
}
ws.addEventListener('message', async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p?.reject(new Error(JSON.stringify(msg.error))); else p?.resolve(msg.result);
  } else if (msg.method === 'Fetch.requestPaused') {
    const { requestId, request } = msg.params;
    const requestURL = new URL(request.url);
    if (requestURL.origin === origin && !requestURL.pathname.startsWith('/api/')) {
      await send('Fetch.continueRequest', { requestId }); return;
    }
    requests.add(requestURL.pathname);
    const fixtureOnlyDiscovery = request.method === 'POST' && requestURL.pathname.endsWith('/shipping/operations/discover/');
    if (!['GET', 'OPTIONS'].includes(request.method)) (fixtureOnlyDiscovery ? simulatedWrites : blockedWrites).push({ method: request.method, path: requestURL.pathname });
    await send('Fetch.fulfillRequest', { requestId, responseCode: !['GET', 'OPTIONS'].includes(request.method) && !fixtureOnlyDiscovery ? 405 : fixtureMode === 'error' && !request.url.endsWith('/me/') ? 503 : 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Credentials', value: 'true' },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type, X-CSRFToken, X-Requested-With, Authorization, X-Request-ID' }, { name: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS, POST, PUT, PATCH, DELETE' }],
      body: Buffer.from(JSON.stringify(fixture(request.url))).toString('base64') });
  } else if (msg.method === 'Network.requestWillBeSent') {
    networkURLs.set(msg.params.requestId, msg.params.request.url);
  } else if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) {
    if (process.env.AUDIT_NETWORK_LOG === '1') console.log(JSON.stringify({networkError:msg.params.errorText,url:networkURLs.get(msg.params.requestId),cors:msg.params.corsErrorStatus}));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map(a=>a.value || a.description || '').join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description || ''));
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: 'http*://*/*' }] });
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('auth_user', ${JSON.stringify(JSON.stringify(user))}); localStorage.setItem('app-theme','${auditTheme}');` });
const app = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const routes = [...new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1].replace(/:(?:draftId|docEntry)/g, '1')))];
const selectedRoutes = process.env.AUDIT_ROUTES?.split(',') || routes;
const sizes = process.env.AUDIT_WIDTHS?.split(',').map(Number) || [280, 320, 360, 390, 412, 480, 600, 768, 820, 1024, 1280, 1440, 1920];
const outputDir = new URL('../responsive-screenshots/audit/', import.meta.url);
await fs.mkdir(outputDir, { recursive: true });
const results = [];
let completed = false;
for (const lang of (process.env.AUDIT_LANGS?.split(',') || ['en', 'ar'])) {
  const init = await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('app-lang','${lang}');` });
  let loadedRoute=null;
  for (const outer of (resizeMatrix ? selectedRoutes : sizes)) {
    for (const inner of (resizeMatrix ? sizes : selectedRoutes)) {
      const width=resizeMatrix?inner:outer, route=resizeMatrix?outer:inner;
      const height = Number(process.env.AUDIT_HEIGHT) || (width <= 480 ? 740 : 900);
      const emulateTouch = process.env.AUDIT_TOUCH === 'auto' ? width <= 768 : touch;
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: emulateTouch });
      await send('Emulation.setTouchEmulationEnabled', { enabled: emulateTouch, maxTouchPoints: 1 });
      if (results.length && results.length % 25 === 0) await send('HeapProfiler.collectGarbage');
      errors.length = 0;
      const newlyNavigated=!resizeMatrix || loadedRoute!==route;
      if (newlyNavigated) {
      await send('Page.navigate', { url: origin + route });
      await evaluate(`new Promise(resolve => { const deadline = Date.now() + 5000; const poll = () => Date.now() > deadline ? resolve() : document.querySelector('#root')?.children.length && document.readyState === 'complete' ? setTimeout(resolve, 320) : setTimeout(poll, 50); poll(); })`);
      await evaluate(`(async () => { const {getActiveRequestCount} = await import('/src/services/api.js'); const end=Date.now()+8000; while((getActiveRequestCount() || document.querySelector('.page-transition > .app-spinner')) && Date.now()<end) await new Promise(r=>setTimeout(r,50)); await document.fonts.ready; })()`);
      loadedRoute=route;
      } else { await evaluate('new Promise(r=>setTimeout(r,100))'); }
      const inspect = () => evaluate(`(() => {
        const vw = document.documentElement.clientWidth;
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        const offenders = [...document.querySelectorAll('body *')].filter(e => {
          if (!visible(e) || e.closest('.app-top-bar-progress, .qrev-print-report, .scale-print-ticket-container, .gp-permit-print-container, .scale-receipt-print-container')) return false;
          const r = e.getBoundingClientRect(); if (r.width <= 0 || (r.left >= -1 && r.right <= vw + 1)) return false;
          for(let p=e.parentElement;p && p!==document.body;p=p.parentElement) if (['auto','scroll'].includes(getComputedStyle(p).overflowX)) return false;
          return true;
        }).slice(0,12).map(e => ({tag:e.tagName,cls:typeof e.className==='string'?e.className:'',text:e.textContent.trim().slice(0,65),left:Math.round(e.getBoundingClientRect().left),width:Math.round(e.getBoundingClientRect().width)}));
        return { actualTheme: document.documentElement.dataset.theme, actualLang: document.documentElement.lang, touch: matchMedia('(pointer: coarse)').matches, height: innerHeight,
          smallTargets: [...document.querySelectorAll('button:not(:disabled)')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.height<43 || r.width<43}).slice(0,30).map(e=>({cls:e.className,text:e.textContent.trim().slice(0,40),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),
          fonts: [...document.querySelectorAll('h1,h2,input:not([type="checkbox"]),.app-action-icon-btn > span')].filter(visible).slice(0,20).map(e=>({tag:e.tagName,cls:e.className,size:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight})),
          url:location.pathname,body:document.body.innerText.length,scroll:document.documentElement.scrollWidth,viewport:vw,offenders,
          remoteFields: [...document.querySelectorAll('.MuiDialog-root input')].filter(e=>['e.g. 192.168.1.150','8000'].includes(e.placeholder)).map(e=>({placeholder:e.placeholder,top:e.getBoundingClientRect().top,left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width,font:getComputedStyle(e).fontSize})),
          dialogs:[...document.querySelectorAll('.rr-dialog,.simple-modal-card,.confirm-dialog,.MuiDialog-paper')].filter(visible).map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:innerHeight})),
          dropdowns:[...document.querySelectorAll('.searchable-select__popper')].filter(visible).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:innerHeight})),
          tables:[...document.querySelectorAll('table')].filter(visible).map(e=>({cls:e.className,width:Math.round(e.getBoundingClientRect().width),columns:e.rows[0]?.cells.length})),
          icons:[...document.querySelectorAll('.app-action-icon-btn--view,.app-action-icon-btn--print')].filter(visible).map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,title:e.title,label:e.getAttribute('aria-label')}))};
      })()`);
      const result = await inspect();
      results.push({ route, lang, width, navigation: newlyNavigated ? 'navigate' : 'resize', ...result, errors: [...errors] });
      if (results.length % 10 === 0) await fs.writeFile(new URL(`${process.argv[2] || 'after'}.json`, outputDir), JSON.stringify({ results, requests: [...requests], blockedWrites, simulatedWrites, fixtureMode, auditTheme, completed, resizeMatrix, sourceHashes }, null, 2));
      if (result.offenders.length || errors.length || result.body < 50) console.log(JSON.stringify({ route, lang, width, offenders: result.offenders.slice(0,3), errors: errors.map(e=>e.slice(0,130)) }));
      if ((process.env.AUDIT_SCREENSHOTS === '1' || ['/quality/receiving','/grpo','/purchase-quotations/review','/receipt-review','/scale/weighing'].includes(route)) && [390,1440].includes(width)) {
        const layout = await send('Page.getLayoutMetrics');
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: layout.cssLayoutViewport.clientWidth, height: Math.min(layout.cssContentSize.height, 10000), scale: 1 } });
        await fs.writeFile(new URL(`${process.argv[2] || 'after'}-${lang}-${width}-${route.replaceAll('/','_')}.png`, outputDir), Buffer.from(shot.data,'base64'));
      }
      if (process.env.AUDIT_INTERACTIONS === '1') {
        const actions = [
          ['mobile-navigation', `.mobile-nav-toggle`],
          ['navigation', `.toolbar-review-menu--review > button`, 'touch'],
          ['navigation-submenu', `.toolbar-review-menu--review .toolbar-review-menu__submenu-trigger`, 'touch'],
          ['navigation-close', `.toolbar-review-menu--review > button`, 'touch'],
          ['mobile-navigation-close', `.mobile-drawer__close`],
          ['select', `.searchable-select:not(.Mui-disabled) .MuiAutocomplete-popupIndicator`],
          ['select-close', `.searchable-select:not(.Mui-disabled) .MuiAutocomplete-popupIndicator`],
        ];
        if (['/quality-review','/grpo/review','/receipt-review'].includes(route)) actions.push(['bulk-selection','thead input[type="checkbox"]']);
        if (route === '/quality-review') actions.push(['view-dialog','.app-action-icon-btn--view']);
        if (route === '/scale/devices') actions.push(['create-device-dialog','.page-header__actions button:nth-of-type(2)'], ['remote-device-type','.MuiDialog-root select','remote'], ['remote-ip-focus','.MuiDialog-root input[placeholder="e.g. 192.168.1.150"]','focus'], ['device-dialog-close','.MuiDialogActions-root button:first-of-type']);
        if (route === '/scale/item-elements') actions.push(['create-dialog','.page-header__actions button']);
        if (route === '/order-rules/quality/criteria') actions.push(['create-dialog','.rules-page-shell .app-button--primary'], ['dialog-select','.simple-modal-card .MuiAutocomplete-popupIndicator']);
        actions.push(['theme-switch', '.mobile-drawer__theme']);
        for (const [state, selector, method = 'click'] of actions) {
          const found = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e || !e.getClientRects().length) return false; ${method === 'remote' ? "Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'remote');e.dispatchEvent(new Event('change',{bubbles:true}))" : method === 'touch' ? "e.click()" : `e.${method}()`}; return true; })()`);
          if (!found) continue;
          await evaluate('new Promise(resolve => setTimeout(resolve, 260))');
          await evaluate("Promise.all([...document.querySelectorAll('.app-toolbar__actions,.mobile-drawer-backdrop')].flatMap(e=>e.getAnimations()).map(a=>a.finished.catch(()=>{})))");
          const check = await inspect();
          results.push({route,lang,width,state,...check,errors:[...errors]});
          if(check.offenders.length) console.log(JSON.stringify({route,lang,width,state,offenders:check.offenders.slice(0,3)}));
          if (state.startsWith('remote-') || state.includes('dialog') || state === 'select' || state.startsWith('navigation') || state === 'mobile-navigation' || state === 'theme-switch') {
            const shot = await send('Page.captureScreenshot', {format:'png'});
            await fs.writeFile(new URL(`${process.argv[2]}-${lang}-${width}-${route.replaceAll('/','_')}-${state}.png`,outputDir),Buffer.from(shot.data,'base64'));
          }
        }
      }
    }
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: init.identifier });
}
completed = true;
await fs.writeFile(new URL(`${process.argv[2] || 'after'}.json`, outputDir), JSON.stringify({ results, requests: [...requests], blockedWrites, simulatedWrites, fixtureMode, auditTheme, completed, resizeMatrix, sourceHashes }, null, 2));
console.log(JSON.stringify({ pages: results.length, overflowCases: results.filter(r=>r.offenders.length || r.scroll>r.viewport+1).length, errorCases: results.filter(r=>r.errors.length).length }));
await send('Page.close'); ws.close();
await browserSend('Target.disposeBrowserContext',{browserContextId}); browserSocket.close();
if (process.env.AUDIT_STRICT === '1' && results.some(r=>r.errors.length || r.scroll>r.viewport+1 || r.offenders.length)) process.exitCode = 1;
