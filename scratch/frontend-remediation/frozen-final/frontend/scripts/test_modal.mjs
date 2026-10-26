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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/customization-delivery/quotations/review' });

// Wait for rows
let rowCount = 0;
for (let i = 0; i < 30; i++) {
  const res = await send('Runtime.evaluate', {
    expression: 'document.querySelectorAll("tbody tr").length',
    returnByValue: true
  });
  rowCount = res.result?.value || 0;
  console.log(`Poll ${i}: rows = ${rowCount}`);
  if (rowCount > 0) break;
  await new Promise(r => setTimeout(r, 200));
}

// Click first row
await send('Runtime.evaluate', {
  expression: 'document.querySelector("tbody tr").click()',
  returnByValue: true
});
await new Promise(r => setTimeout(r, 600));

const modal = await send('Runtime.evaluate', {
  expression: 'Boolean(document.querySelector(".customization-detail-modal"))',
  returnByValue: true
});

const modalText = await send('Runtime.evaluate', {
  expression: 'document.querySelector(".customization-detail-modal")?.innerText?.slice(0, 300)',
  returnByValue: true
});

console.log('Modal found:', modal.result?.value);
console.log('Modal text sample:\n', modalText.result?.value);

await send('Page.close');
ws.close();
