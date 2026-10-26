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
      localStorage.setItem('app-theme', 'dark');
      localStorage.setItem('app-lang', 'ar');
    } catch(e) {}
  `
});

// 1. Navigate to Sales Orders review with order=311002628
console.log('Navigating to Sales Orders Review (?order=311002628)...');
await send('Page.navigate', { url: `${origin}/customization-delivery/review?order=311002628` });

// Wait for modal to open
let modalOpened = false;
for (let i = 0; i < 40; i++) {
  const r = await send('Runtime.evaluate', {
    expression: 'Boolean(document.querySelector(".customization-detail-modal"))',
    returnByValue: true
  });
  if (r.result?.value) {
    modalOpened = true;
    break;
  }
  await new Promise(res => setTimeout(res, 200));
}
console.log('Sales Order modal auto-opened:', modalOpened);

// Find nodes in traceability chain
const nodesInfo = await send('Runtime.evaluate', {
  expression: `(() => {
    const modal = document.querySelector('.customization-detail-modal');
    if (!modal) return [];
    return Array.from(modal.querySelectorAll('.trace-node')).map(n => ({
      text: n.innerText.replace(/\\n/g, ' '),
      cursor: window.getComputedStyle(n).cursor
    }));
  })()`,
  returnByValue: true
});
console.log('Traceability nodes found in Sales Order modal:', nodesInfo.result?.value);

// Click Quotation node
console.log('Clicking Quotation node in traceability chain...');
const clicked = await send('Runtime.evaluate', {
  expression: `(() => {
    const modal = document.querySelector('.customization-detail-modal');
    const nodes = modal?.querySelectorAll('.trace-node');
    if (nodes && nodes.length > 0) {
      nodes[0].click();
      return true;
    }
    return false;
  })()`,
  returnByValue: true
});
console.log('Clicked quotation node result:', clicked.result?.value);

// Wait for navigation and modal on quotations review
await new Promise(res => setTimeout(res, 1500));

const afterNav = await send('Runtime.evaluate', {
  expression: `(() => {
    const path = location.pathname + location.search;
    const modal = document.querySelector('.customization-detail-modal');
    const headerTitle = document.querySelector('h1')?.innerText;
    return {
      path,
      modalOpened: Boolean(modal),
      modalText: modal?.innerText?.slice(0, 150),
      headerTitle
    };
  })()`,
  returnByValue: true
});
console.log('State after navigation:', afterNav.result?.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile(path.join(outputDir, 'traceability-navigated-success.png'), Buffer.from(shot.data, 'base64'));
console.log('Saved traceability-navigated-success.png');

await send('Page.close');
ws.close();
