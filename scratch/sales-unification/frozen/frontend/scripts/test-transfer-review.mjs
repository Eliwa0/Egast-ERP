// Isolated component tests. No browser interception, operational API, or SAP calls.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { MemoryRouter } from 'react-router-dom';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = globalThis.__transferReviewTest = {};
const server = await createServer({ root, cacheDir: 'node_modules/.vite-transfer-review-test', server: { middlewareMode: true }, plugins: [{
  name: 'transfer-review-unit-fixtures', enforce: 'pre',
  resolveId(id) { if (id.startsWith('virtual:review-')) return '\0' + id; },
  load(id) {
    if (id === '\0virtual:review-hooks') return `
      export function useState(initial) {
        const f=globalThis.__transferReviewTest, index=f.index++;
        if (!(index in f.states)) f.states[index]=typeof initial==='function'?initial():initial;
        return [f.states[index], value=>{f.states[index]=typeof value==='function'?value(f.states[index]):value;}];
      }
      export function useEffect(callback) { globalThis.__transferReviewTest.effects.push(callback); }
    `;
    if (id === '\0virtual:review-auth') return `export const useAuth=()=>({user:{is_superuser:true}});`;
    if (id === '\0virtual:review-i18n') return `export const useI18n=()=>({lang:'en',t:(key)=>key});`;
  },
  transform(code, id) {
    if (id.endsWith('/contexts/AuthContext.jsx')) return `export const useAuth=()=>({user:{is_superuser:true}});`;
    if (id.endsWith('/contexts/I18nContext.jsx')) return `export const useI18n=()=>({lang:'en',t:(key)=>key});`;
    if (id.endsWith('/services/api.js')) return `export default {get: (...args)=>globalThis.__transferReviewTest.get(...args)};`;
    if (!id.endsWith('/pages/TransferReviewPage.jsx')) return;
    if (fixture.beforeFix) code = code.replace("import { canManageTransfer } from '../utils/roles';", '');
    return code.replace('useRef, useState', 'useRef')
      .replace('useCallback, useEffect,', 'useCallback,')
      .replace("'../contexts/AuthContext'", "'virtual:review-auth'")
      .replace("'../contexts/I18nContext'", "'virtual:review-i18n'")
      + "\nimport {useState,useEffect} from 'virtual:review-hooks';";
  },
}] });

try {
  fixture.beforeFix = true;
  const { default: BrokenPage } = await server.ssrLoadModule('/src/pages/TransferReviewPage.jsx');
  assert.throws(() => renderToString(React.createElement(BrokenPage)), /canManageTransfer is not defined/);
  fixture.beforeFix = false;
  server.moduleGraph.invalidateAll();
  const { default: Page } = await server.ssrLoadModule('/src/pages/TransferReviewPage.jsx');
  const routes = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(routes, /path="\/transfer-review"[^\n]*<TransferReviewPage/);
  for (const alias of ['internal', 'shipping']) {
    assert.ok(routes.includes(`path="/transfer-review/${alias}"`));
    assert.match(routes.split(`path="/transfer-review/${alias}"`)[1].split('\n')[0], /Navigate to="\/transfer-review"/);
  }
  const render = () => { fixture.index = 0; fixture.effects = []; return renderToString(React.createElement(Page)); };
  let checks = 0;
  async function scenario(response, { error = null, reserved = [] } = {}) {
    fixture.states = []; fixture.calls = [];
    fixture.get = async (url, options) => {
      fixture.calls.push([url, options]);
      if (url.includes('/transfer/physical/events/')) return { data: { data: { events: [] } } };
      if (url.includes('/bin-locations/')) return { data: { data: {
        warehouse_code: decodeURIComponent(url.split('/')[2]), requires_bin: true,
        locations: [{ code: 'VALID-DESTINATION-BIN', name: 'Valid destination', absEntry: 42 }],
      } } };
      if (url.includes('reserved-outbound')) return { data: { data: { positions: reserved } } };
      if (error) throw { response: { data: { error } } };
      return { data: response };
    };
    assert.match(render(), /transferReview.title/); // Reproduces the original first-render ReferenceError.
    const effects = [...fixture.effects];
    effects.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    const html = render();
    assert.deepEqual(fixture.calls.map(([url]) => url).sort(), [
      '/admin/pending-transfers/', '/admin/reports/reserved-outbound-positions/', '/transfer/physical/events/',
    ].sort());
    assert.equal(fixture.calls.find(([url]) => url === '/admin/pending-transfers/')[1].params.refresh_sources, 'false');
    checks++;
    return html;
  }
  const pending = { id: 1, status: 'PENDING', transfer_stage: 'STAGE_1_TO_INTERMEDIATE',
    from_warehouse: '20203', to_warehouse: '90214', quantity: 6000,
    lines: [{ batch_number: 'PALLET-ONE', item_code: 'ITEM-ONE' }] };
  for (const response of [null, {}, { data: { transfers: null } }, { data: { transfers: [] } }]) {
    assert.match(await scenario(response), /transferReview.empty/);
  }
  assert.match(await scenario({ data: { transfers: [pending] } }), /PALLET-ONE/);
  const stage4={...pending,id:40,transfer_stage:'STAGE_4_TO_DESTINATION',from_warehouse:'SOURCE-4',to_warehouse:'DEST-4',
    lines:[{batch_number:'INTERNAL-PALLET'}],sap_doc_num:444};
  const separated=await scenario({data:{transfers:[stage4,pending]}});
  for (const value of ['INTERNAL-PALLET', 'SOURCE-4', 'DEST-4', 'PALLET-ONE']) assert.ok(separated.includes(value));
  assert.ok(separated.includes('tr-table')); // Current review combines stages in one table.
  const stage2 = { ...pending, id: 2, status: 'POSTED', transfer_stage: 'STAGE_2_TO_FRIDGE',
    from_warehouse: '90214', to_warehouse: '20201', to_bin: 'ACTUAL-SECOND-BIN',
    pallet_position_code: 'ACTUAL-USER-POSITION', sap_doc_entry: 123, sap_doc_num: 456,
    raw_payload_json: { policy: { allowed_destination_bins: {} } } };
  let html = await scenario({ data: { transfers: [stage2] } });
  for (const value of ['transferReview.stage2', 'ACTUAL-USER-POSITION', 'ACTUAL-SECOND-BIN', '456']) assert.ok(html.includes(value), value);
  assert.ok((await scenario({ data: { transfers: [{ ...stage2, sap_doc_num: null }] } })).includes('123'), 'DocEntry is the reference fallback when SAP DocNum is absent');
  html = await scenario({ data: { transfers: [{ ...stage2, id: 3, transfer_stage: 'STAGE_3_FROM_FRIDGE',
    from_warehouse: '20201', to_warehouse: 'DESTINATION', source_pallet_position_code: 'ACTUAL-SOURCE-POSITION',
    pallet_position_code: null, to_bin: null }] } });
  assert.match(html, /transferReview.stage3/); assert.match(html, /ACTUAL-SOURCE-POSITION/);
  html = await scenario({ data: { transfers: [{ id: 4, status: 'POSTED', lines: null, created_at: null,
    created_by: null, sap_doc_num: null, position_reconciliation: { status: null, last_attempt_at: null } }] } });
  assert.match(html, /transferReview.title/);
  html = await scenario(null, { error: 'REAL API FAILURE' });
  assert.match(html, /REAL API FAILURE/); assert.match(html, /common.retry/);
  assert.ok(!html.includes('transferReview.empty'));
  html = await scenario({ data: { transfers: {} } });
  assert.match(html, /transferReview.loadFailed/); assert.ok(!html.includes('transferReview.empty'));
  html = await scenario({ data: { transfers: [null] } });
  assert.match(html, /transferReview.loadFailed/);
  html = await scenario({ data: { transfers: [] } }, { reserved: {} });
  assert.match(html, /transferReview.reservedOutboundLoadFailed/);
  html = await scenario({ data: { transfers: [{ ...stage2, id: 5, status: 'FAILED',
    transfer_stage: 'STAGE_3_FROM_FRIDGE', to_bin: '', error_message: 'Original SAP rejection' }] } });
  fixture.effects[0](); // Resolve warehouse requirements after records load.
  await new Promise(resolve => setImmediate(resolve));
  html = render();
  assert.ok(fixture.calls.some(([url]) => url.includes('/bin-locations/20201/')), 'Validate destination bin requirements for the actual destination warehouse');
  assert.match(html, /Original SAP rejection/);
  assert.match(html, /class="app-button app-button--success tr-post-btn" disabled/);
  await scenario({ data: { transfers: [{ ...stage2, id: 6, status: 'FAILED', transfer_stage: 'STAGE_3_FROM_FRIDGE', to_bin: 'VALID-DESTINATION-BIN' }] } });
  fixture.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(render(), /class="app-button app-button--success tr-post-btn" disabled/, 'A validated explicit bin enables posting');
  console.log(`PASS: ${checks} Transfer Review component scenarios; no operational/SAP calls.`);
} finally {
  await server.close(); delete globalThis.__transferReviewTest;
}
