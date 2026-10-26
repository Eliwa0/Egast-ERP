import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '..', 'responsive-screenshots', 'qa');

const origin = 'http://127.0.0.1:5173';
const sessionId = 'z5grfsk2embxrd5o234qpgcvzarhbcqa';

try {
  await fetch('http://127.0.0.1:9555/json/version');
} catch {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const p = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9555',
    '--remote-allow-origins=*',
    '--user-data-dir=C:\\Users\\hp\\AppData\\Local\\Temp\\chrome-qa-run',
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  p.unref();
  await new Promise(r => setTimeout(r, 2000));
}

const target = await fetch('http://127.0.0.1:9555/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq;
  const h = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id === id) { ws.removeEventListener('message', h); res(m.result); }
  };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

await send('Network.setCookie', { name: 'sessionid', value: sessionId, domain: '127.0.0.1', path: '/' });
await send('Network.setCookie', { name: 'sessionid', value: sessionId, domain: 'localhost', path: '/' });

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try {
      localStorage.setItem('auth_user', JSON.stringify({ id: 1, username: 'mhosny', role: 'admin' }));
      localStorage.setItem('app-theme', 'light');
      localStorage.setItem('app-lang', 'ar');
    } catch(e) {}
  `
});

console.log('Navigating to Delivery Review with delivery=111000040...');
await send('Page.navigate', { url: `${origin}/customization-delivery/review/deliveries?delivery=111000040` });

// Wait for modal
for (let i = 0; i < 40; i++) {
  const r = await send('Runtime.evaluate', {
    expression: 'Boolean(document.querySelector(".customization-detail-modal"))',
    returnByValue: true
  });
  if (r.result?.value) break;
  await new Promise(res => setTimeout(res, 200));
}

// In the modal, intercept window.open so print doesn't get blocked by popup blockers
console.log('Hooking window.open to intercept print document generation...');
await send('Runtime.evaluate', {
  expression: `(() => {
    window.__capturedPrintHtml = null;
    const fakeWindow = {
      document: {
        open: () => {},
        write: (html) => { window.__capturedPrintHtml = html; },
        close: () => {},
        title: ''
      },
      focus: () => {},
      print: () => {},
      close: () => {}
    };
    window.open = () => fakeWindow;
  })()`
});

// Click the print button inside the modal
console.log('Clicking print delivery button inside modal...');
const clicked = await send('Runtime.evaluate', {
  expression: `(() => {
    const modal = document.querySelector('.customization-detail-modal');
    const printBtn = modal?.querySelector('button:has(svg.lucide-printer)');
    if (printBtn) {
      printBtn.click();
      return true;
    }
    return false;
  })()`,
  returnByValue: true
});
console.log('Print button clicked:', clicked.result?.value);

// Wait for print effect to write HTML
let capturedHtml = null;
for (let i = 0; i < 30; i++) {
  const res = await send('Runtime.evaluate', {
    expression: 'window.__capturedPrintHtml',
    returnByValue: true
  });
  if (res.result?.value) {
    capturedHtml = res.result.value;
    break;
  }
  await new Promise(res => setTimeout(res, 100));
}

console.log('Captured print HTML present:', Boolean(capturedHtml));
if (capturedHtml) {
  console.log('Captured HTML length:', capturedHtml.length);
  await fs.writeFile(path.join(outputDir, 'captured_delivery_print.html'), capturedHtml, 'utf8');

  // Load the captured print HTML into a new page to test rendering & capture screenshot!
  console.log('Rendering print document to verify layout, identity, and RTL...');
  await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(capturedHtml) });
  await new Promise(res => setTimeout(res, 600));

  const printInspect = await send('Runtime.evaluate', {
    expression: `(() => {
      const doc = document.documentElement;
      const dir = doc.getAttribute('dir');
      const hasLogo = Boolean(document.querySelector('img[src*="logo"], .report-header-logo'));
      const companyName = document.querySelector('.report-header-text h2')?.innerText;
      const subtitle = document.querySelector('.report-header-text p')?.innerText;
      const title = document.querySelector('.delivery-print-title h1')?.innerText;
      const deliveryNum = document.querySelector('.delivery-print-title span')?.innerText;
      const hasTable = Boolean(document.querySelector('.delivery-print-table'));
      const rows = document.querySelectorAll('.delivery-print-table tbody tr').length;
      const appUiElements = document.querySelectorAll('nav, header.app-header, .toolbar-review-menu, button');
      
      return {
        dir,
        hasLogo,
        companyName,
        subtitle,
        title,
        deliveryNum,
        hasTable,
        rows,
        appUiFound: appUiElements.length > 0
      };
    })()`,
    returnByValue: true
  });
  console.log('Print Document Verification Details:', printInspect.result?.value);

  // Set A4 viewport (210mm x 297mm ≈ 794px x 1123px at 96 DPI)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 1130,
    deviceScaleFactor: 1,
    mobile: false
  });
  const printShot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(outputDir, 'delivery-print-document-rendered.png'), Buffer.from(printShot.data, 'base64'));
  console.log('Saved delivery-print-document-rendered.png');
}

await send('Page.close');
ws.close();
console.log('Print QA test completed successfully.');
