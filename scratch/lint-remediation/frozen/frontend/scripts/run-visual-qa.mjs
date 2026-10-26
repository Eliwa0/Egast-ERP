import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '..', 'responsive-screenshots', 'qa');
await fs.mkdir(outputDir, { recursive: true });

const origin = 'http://127.0.0.1:5173';
const sessionId = 'z5grfsk2embxrd5o234qpgcvzarhbcqa';

// 1. Ensure Chrome is running
console.log('Checking Chrome on port 9555...');
let chromeProc = null;
try {
  await fetch('http://127.0.0.1:9555/json/version');
  console.log('Chrome is already listening on port 9555.');
} catch {
  console.log('Starting headless Chrome on port 9555...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9555',
    '--remote-allow-origins=*',
    '--user-data-dir=C:\\Users\\hp\\AppData\\Local\\Temp\\chrome-qa-run',
    'about:blank'
  ], { detached: true, stdio: 'ignore' });
  chromeProc.unref();
  await new Promise(r => setTimeout(r, 2500));
}

console.log('Connecting to Chrome on port 9555...');
const target = await fetch('http://127.0.0.1:9555/json/new?about:blank', { method: 'PUT' }).then(r => r.json());

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.reject(new Error(JSON.stringify(msg.error)));
    else p?.resolve(msg.result);
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

// Set Session Cookies for both localhost and 127.0.0.1
await send('Network.setCookie', { name: 'sessionid', value: sessionId, domain: '127.0.0.1', path: '/' });
await send('Network.setCookie', { name: 'sessionid', value: sessionId, domain: 'localhost', path: '/' });

// Helper to evaluate JS in the browser
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  }
  return r.result?.value;
};

// Helper to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to set viewport
async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

// Helper to capture screenshot
async function screenshot(filename) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, Buffer.from(shot.data, 'base64'));
  console.log(`  [Screenshot saved] ${filename}`);
}

// Setup user auth in localStorage on document creation
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try {
      localStorage.setItem('auth_user', JSON.stringify({
        id: 1,
        username: 'mhosny',
        role: 'admin',
        is_active: true
      }));
    } catch (e) {}
  `,
});

// Navigate to origin first so origin document is loaded
await send('Page.navigate', { url: origin + '/customization-delivery/quotations/review' });
await sleep(1500);

console.log('✅ Chrome DevTools CDP session initialized.');


const QA_REPORT = {
  timestamp: new Date().toISOString(),
  pagesTested: [],
  dataIntegrity: {},
  traceabilityTested: false,
  printTested: false,
  overflowIssues: [],
  visualContrastIssues: [],
};

// -------------------------------------------------------------
// Helper: Inspect page metrics & issues
// -------------------------------------------------------------
async function inspectPage(pageLabel, theme, lang) {
  return await evaluate(`(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const hasHorizontalOverflow = scrollWidth > docWidth + 1;
    
    // Check for bad text like undefined, NaN, null rendered on screen
    const allText = document.body.innerText;
    const badTextPatterns = [/undefined/gi, /NaN/g, /null/g];
    const suspiciousTexts = [];
    for (const pat of badTextPatterns) {
      const match = allText.match(pat);
      if (match) {
        suspiciousTexts.push(match[0]);
      }
    }

    // Check table headers and cells
    const tables = Array.from(document.querySelectorAll('table')).map(t => ({
      rows: t.rows.length,
      cols: t.rows[0]?.cells.length || 0,
      width: Math.round(t.getBoundingClientRect().width),
    }));

    // Find any overflowing elements
    const offenders = [];
    document.querySelectorAll('body *').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > docWidth + 2 && !el.closest('pre, code, .print-container, [aria-hidden="true"]')) {
        let isScrollable = false;
        let p = el.parentElement;
        while (p && p !== document.body) {
          const ox = window.getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') {
            isScrollable = true;
            break;
          }
          p = p.parentElement;
        }
        if (!isScrollable) {
          offenders.push({
            tagName: el.tagName,
            className: el.className?.toString().slice(0, 50),
            width: Math.round(rect.width),
            docWidth
          });
        }
      }
    });

    // Check theme colors
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const bodyColor = window.getComputedStyle(document.body).color;

    return {
      docWidth,
      scrollWidth,
      hasHorizontalOverflow,
      suspiciousTexts,
      tables,
      offenders: offenders.slice(0, 5),
      bodyBg,
      bodyColor
    };
  })()`);
}

// -------------------------------------------------------------
// Test execution
// -------------------------------------------------------------
const PAGES = [
  {
    name: 'Sales Quotations Review',
    route: '/customization-delivery/quotations/review',
    key: 'quotations',
  },
  {
    name: 'Sales Orders Review',
    route: '/customization-delivery/review',
    key: 'orders',
  },
  {
    name: 'Delivery Review',
    route: '/customization-delivery/review/deliveries',
    key: 'deliveries',
  },
];

for (const p of PAGES) {
  console.log(`\n======================================================`);
  console.log(`TESTING PAGE: ${p.name} (${p.route})`);
  console.log(`======================================================`);

  for (const theme of ['light', 'dark']) {
    for (const lang of ['ar', 'en']) {
      const VIEWPORTS = [
        { width: 1440, height: 900, label: 'desktop-1440' },
        { width: 820, height: 1180, label: 'tablet-820' },
        { width: 768, height: 1024, label: 'tablet-768' },
        { width: 390, height: 844, label: 'mobile-390' },
      ];

      for (const vp of VIEWPORTS) {
        const { width, height, label } = vp;
        await setViewport(width, height);

        // Set theme and lang in localStorage
        await evaluate(`
          localStorage.setItem('app-theme', '${theme}');
          localStorage.setItem('app-lang', '${lang}');
          document.documentElement.setAttribute('dir', '${lang === 'ar' ? 'rtl' : 'ltr'}');
          document.documentElement.setAttribute('lang', '${lang}');
          if ('${theme}' === 'dark') {
            document.documentElement.classList.add('dark');
            document.body.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
            document.body.classList.remove('dark');
          }
        `);

        // Navigate
        await send('Page.navigate', { url: origin + p.route });

        // Wait for page load and table or cards rendering
        await evaluate(`new Promise((resolve) => {
          let count = 0;
          const interval = setInterval(() => {
            count++;
            const hasRows = document.querySelectorAll('tbody tr').length > 0;
            const hasCards = document.querySelectorAll('.cd-doc-card').length > 0;
            const hasEmpty = document.querySelector('.empty-state') !== null;
            if (hasRows || hasCards || hasEmpty || count > 40) {
              clearInterval(interval);
              setTimeout(resolve, 300);
            }
          }, 100);
        })`);

        const metrics = await inspectPage(p.name, theme, lang);
        console.log(`  [${theme.toUpperCase()}][${lang.toUpperCase()}][${width}px] Viewport: ${metrics.docWidth}px, Scroll: ${metrics.scrollWidth}px, Overflow: ${metrics.hasHorizontalOverflow}`);
        
        if (metrics.hasHorizontalOverflow) {
          console.warn(`    ⚠️ Overflow detected! Offenders:`, metrics.offenders);
          QA_REPORT.overflowIssues.push({ page: p.name, theme, lang, width, offenders: metrics.offenders });
        }

        if (metrics.suspiciousTexts.length > 0) {
          console.warn(`    ⚠️ Suspicious text strings on screen:`, metrics.suspiciousTexts);
        }

        // Check if cards are present on <= 768
        if (width <= 768) {
          const cardCount = await evaluate(`document.querySelectorAll('.cd-doc-card').length`);
          console.log(`    📱 [Mobile/Tablet Card View] Rendered ${cardCount} .cd-doc-card elements`);
        }

        // Check for tax code O1 on quotation page
        if (p.key === 'quotations') {
          const hasTaxO1 = await evaluate(`document.body.innerText.includes('O1')`);
          console.log(`    🏷️ [Tax Check] 'O1' found on page: ${hasTaxO1}`);
        }

        // Capture screenshots
        if (width === 1440) {
          await screenshot(`${p.key}-${theme}-${lang}-list.png`);
        } else if (width === 820 && theme === 'dark' && lang === 'ar') {
          await screenshot(`${p.key}-tablet-820-${theme}-${lang}-list.png`);
        } else if (width === 768 && theme === 'dark' && lang === 'ar') {
          await screenshot(`${p.key}-tablet-768-${theme}-${lang}-list.png`);
        } else if (width === 390 && (theme === 'dark' || theme === 'light') && lang === 'ar') {
          await screenshot(`${p.key}-mobile-390-${theme}-${lang}-list.png`);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Test B: OPEN DETAILS / INSPECTION VIEW FOR REAL RECORD
  // -------------------------------------------------------------
  console.log(`\n  Testing Details / Inspection View on ${p.name}...`);
  // Use Desktop, Arabic, Dark & Light
  await setViewport(1440, 900);
  for (const theme of ['light', 'dark']) {
    await evaluate(`
      localStorage.setItem('app-theme', '${theme}');
      localStorage.setItem('app-lang', 'ar');
      document.documentElement.setAttribute('dir', 'rtl');
      if ('${theme}' === 'dark') {
        document.documentElement.classList.add('dark');
        document.body.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.body.classList.remove('dark');
      }
    `);

    await send('Page.navigate', { url: origin + p.route });
    // Wait for rows to load
    await evaluate(`new Promise((resolve) => {
      let count = 0;
      const interval = setInterval(() => {
        count++;
        const hasRows = document.querySelectorAll('tbody tr').length > 0;
        if (hasRows || count > 50) {
          clearInterval(interval);
          setTimeout(resolve, 300);
        }
      }, 100);
    })`);

    // Click the first row or its view button to open inspection modal
    const opened = await evaluate(`(() => {
      const btn = document.querySelector('tbody tr td button') || document.querySelector('tbody tr');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })()`);

    if (opened) {
      // Wait for modal
      await evaluate(`new Promise((resolve) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          const hasModal = document.querySelector('.customization-detail-modal') !== null;
          if (hasModal || count > 30) {
            clearInterval(interval);
            setTimeout(resolve, 250);
          }
        }, 100);
      })`);


      const modalInfo = await evaluate(`(() => {
        const modal = document.querySelector('.customization-detail-modal, .simple-modal-card, [role="dialog"], .rr-dialog');
        if (!modal) return { found: false };
        const rect = modal.getBoundingClientRect();
        
        // Extract displayed data fields for integrity check
        const text = modal.innerText;
        const hasTraceability = modal.querySelector('.doc-trace-full') !== null;
        const traceNodes = Array.from(modal.querySelectorAll('.trace-node')).map(n => n.innerText.replace(/\\n/g, ' '));
        const itemsRows = modal.querySelectorAll('tbody tr').length;
        
        return {
          found: true,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hasTraceability,
          traceNodes,
          itemsRows,
          textSample: text.slice(0, 300)
        };
      })()`);

      console.log(`  [${theme.toUpperCase()}] Modal status:`, modalInfo);
      await screenshot(`${p.key}-${theme}-modal.png`);

      // Verify and record data integrity
      QA_REPORT.dataIntegrity[p.key] = modalInfo;

      // Close modal
      await evaluate(`(() => {
        const closeBtn = document.querySelector('.customization-detail-modal button:has(svg.lucide-x), .simple-modal-card button:has(svg.lucide-x), button[aria-label="Close"], button[aria-label="إغلاق"]');
        if (closeBtn) closeBtn.click();
      })()`);
      await sleep(300);
    } else {
      console.warn(`  ⚠️ Could not find View button to open modal on ${p.name}`);
    }
  }

  QA_REPORT.pagesTested.push(p.name);
}

// -------------------------------------------------------------
// Test C: TRACEABILITY NAVIGATION TEST
// -------------------------------------------------------------
console.log(`\n======================================================`);
console.log(`TESTING CROSS-DOCUMENT TRACEABILITY CHAIN CLICK`);
console.log(`======================================================`);

// Start at Sales Orders Review, find order 311002628 (Draft 16), open modal
await send('Page.navigate', { url: `${origin}/customization-delivery/review?order=311002628` });
await evaluate(`new Promise((resolve) => {
  let count = 0;
  const interval = setInterval(() => {
    count++;
    const hasModal = document.querySelector('.customization-detail-modal') !== null;
    if (hasModal || count > 50) {
      clearInterval(interval);
      setTimeout(resolve, 300);
    }
  }, 100);
})`);

const traceCheck = await evaluate(`(() => {
  const modal = document.querySelector('.customization-detail-modal');
  if (!modal) return { modalFound: false };
  const nodes = Array.from(modal.querySelectorAll('.trace-node')).map(n => n.innerText.replace(/\\n/g, ' '));
  
  return {
    modalFound: true,
    nodes
  };
})()`);

console.log('Traceability chain elements in Sales Order 311002628 modal:', traceCheck);
await screenshot(`traceability-order-modal.png`);

// Click the Quotation chip in the traceability chain to navigate to Quotation Review!
const clickedQuotation = await evaluate(`(() => {
  const quotationChip = document.querySelector('.customization-detail-modal .trace-node');
  if (quotationChip) {
    quotationChip.click();
    return true;
  }
  return false;
})()`);

if (clickedQuotation) {
  await sleep(1200);
  const currentPath = await evaluate(`location.pathname + location.search`);
  console.log(`  Navigated after clicking quotation chip in traceability chain: ${currentPath}`);
  QA_REPORT.traceabilityTested = currentPath.includes('/customization-delivery/quotations/review');
  await screenshot(`traceability-navigated-to-quotation.png`);
}

// -------------------------------------------------------------
// Test D: DELIVERY PRINT SYSTEM TEST
// -------------------------------------------------------------
console.log(`\n======================================================`);
console.log(`TESTING DELIVERY REPORT PRINT SYSTEM`);
console.log(`======================================================`);
await send('Page.navigate', { url: `${origin}/customization-delivery/review/deliveries?delivery=111000040` });
await evaluate(`new Promise((resolve) => {
  let count = 0;
  const interval = setInterval(() => {
    count++;
    const hasModal = document.querySelector('.customization-detail-modal') !== null;
    if (hasModal || count > 50) {
      clearInterval(interval);
      setTimeout(resolve, 300);
    }
  }, 100);
})`);


const printButtonFound = await evaluate(`(() => {
  const modalPrintBtn = document.querySelector('.customization-detail-modal button:has(svg.lucide-printer)');
  const headerPrintBtn = document.querySelector('button:has(svg.lucide-printer)');
  return Boolean(modalPrintBtn || headerPrintBtn);
})()`);

console.log('Delivery print button found:', printButtonFound);
QA_REPORT.printTested = printButtonFound;
await screenshot(`delivery-print-action.png`);

// Save report
await fs.writeFile(path.join(outputDir, 'visual-qa-results.json'), JSON.stringify(QA_REPORT, null, 2));
console.log(`\n======================================================`);
console.log(`VISUAL QA AUTOMATION RUN COMPLETED!`);
console.log(`======================================================`);

await send('Page.close');
ws.close();
process.exit(0);
