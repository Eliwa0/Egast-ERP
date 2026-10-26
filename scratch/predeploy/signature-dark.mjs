// Requires the isolated Chrome/Vite described in audit-responsive.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const origin = process.env.AUDIT_ORIGIN || 'http://127.0.0.1:5173';

const target = await fetch(`http://127.0.0.1:${process.env.AUDIT_CHROME_PORT || '9555'}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.addEventListener('message', async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p?.reject(new Error(JSON.stringify(msg.error))); else p?.resolve(msg.result);
  } else if (msg.method === 'Fetch.requestPaused') {
    const { request, requestId } = msg.params;
    if (new URL(request.url).origin === origin) await send('Fetch.continueRequest', { requestId });
    else await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
  } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
});
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const settle = () => evaluate('new Promise(r=>setTimeout(r,200))');
const out = new URL('./signature-dark/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const results = [];
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http*://*/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.addScriptToEvaluateOnNewDocument', {source: "localStorage.setItem('app-theme','" + (process.env.AUDIT_THEME === 'dark' ? 'dark' : 'light') + "')"});
  await send('Page.navigate', { url: origin + '/login' });
  await evaluate(`new Promise(r=>{const check=()=>document.querySelector('.login-card')?r():setTimeout(check,50);check()})`);
  await evaluate(`import('/scripts/fixtures/responsive-harness.jsx').then(m=>m.mount())`);
  await settle();
  const ink = () => evaluate(`(() => {
    const c=document.querySelector('#responsive-harness canvas'), ctx=c.getContext('2d');
    const p=ctx.getImageData(0,0,c.width,c.height).data;
    const background=[p[0],p[1],p[2]];
    let count=0; for(let i=0;i<p.length;i+=4) if(Math.abs(p[i]-background[0])+Math.abs(p[i+1]-background[1])+Math.abs(p[i+2]-background[2])>60 && p[i+3]>0) count++;
    return {count,width:c.width,cssWidth:c.getBoundingClientRect().width,height:c.height,changes:window.signatureChanges||0,saved:!!window.signatureValue};
  })()`);
  const rect = await evaluate(`(() => {const r=document.querySelector('#responsive-harness canvas').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 30, y: rect.y + 30 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + 100, y: rect.y + 60 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle();
  const drawn = await ink();
  assert.ok(drawn.count > 50 && drawn.saved, JSON.stringify(drawn));
  assert.equal(drawn.width, Math.round(drawn.cssWidth * 2));
  results.push({ test: 'touch draw and controlled save at DPR 2', ...drawn });
  await evaluate(`document.querySelector('#responsive-harness').style.width='180px'`);
  await settle();
  const resized = await ink();
  assert.equal(resized.width, 360);
  assert.ok(resized.count > 20);
  assert.equal(resized.changes, drawn.changes, 'Resize must not save or erase the document signature');
  results.push({ test: 'resize preserves ink without onChange', ...resized });
  await send('Emulation.setDeviceMetricsOverride', { width: 740, height: 390, deviceScaleFactor: 3, mobile: true });
  await settle();
  const rotated = await ink();
  assert.equal(rotated.width, 540);
  assert.ok(rotated.count > 20);
  results.push({ test: 'landscape and DPR 3 preserve ink', ...rotated });
  const controls = await evaluate(`(() => {
    const b=document.querySelector('#responsive-harness .app-action-icon-btn'), c=document.querySelector('#responsive-harness .app-button--compact');
    return {iconWidth:b.offsetWidth,iconHeight:b.offsetHeight,glyph:getComputedStyle(b.firstElementChild).fontSize,compactHeight:c.offsetHeight,input:getComputedStyle(document.querySelector('#responsive-harness input')).fontSize};
  })()`);
  assert.ok(controls.iconWidth >= 48 && controls.iconHeight >= 48);
  assert.ok(controls.compactHeight >= 44);
  assert.equal(controls.glyph, '22px');
  assert.equal(controls.input, '16px');
  results.push({ test: 'computed coarse-pointer controls and input font', ...controls });
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const print = await evaluate(`({font:getComputedStyle(document.querySelector('#print-probe')).fontSize,weight:getComputedStyle(document.querySelector('#print-probe')).fontWeight,button:document.querySelector('#responsive-harness .app-action-icon-btn').offsetWidth})`);
  assert.equal(print.font, '15px'); assert.equal(print.weight, '400'); assert.equal(print.button, 32);
  results.push({ test: 'legacy print typography and icon dimensions', ...print });
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  await evaluate(`document.querySelector('#responsive-harness .signature-pad__clear').click()`);
  await settle();
  const cleared = await ink();
  assert.equal(cleared.count, 0); assert.equal(cleared.saved, false);
  results.push({ test: 'clear signature', ...cleared });
  await evaluate(`document.querySelector('#restore-signature').click()`);
  await settle();
  const restored = await ink();
  assert.ok(restored.count > 20, 'Controlled image value must load after clear');
  results.push({ test: 'restore existing signature image', ...restored });
  await evaluate(`import('/scripts/fixtures/responsive-harness.jsx').then(m=>m.mountTicket())`);
  await settle();
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const ticket = await evaluate(`(() => {const e=document.querySelector('.scale-print-ticket-container');return {width:e.getBoundingClientRect().width,display:getComputedStyle(e).display,text:e.innerText.includes('TEST-123') && e.innerText.includes('12,345')}})()`);
  assert.ok(ticket.width > 700 && ticket.width < 850, JSON.stringify(ticket));
  assert.ok(ticket.text && ticket.display !== 'none');
  results.push({ test: 'real scale ticket print preview with synthetic data', ...ticket });
  const printShot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(new URL('scale-ticket-print-preview.png', out), Buffer.from(printShot.data, 'base64'));
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(new URL('responsive-harness.png', out), Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ passed: results.length, results }));
} finally {
  await fs.writeFile(new URL('responsive-browser-regressions.json', out), JSON.stringify({ results, errors }, null, 2));
  await send('Page.close'); ws.close();
}
