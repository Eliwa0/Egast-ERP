import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const f = globalThis.__shippingWizardTest = { states: [], index: 0, lang: 'ar', saved: null };
const order = { doc_entry: 10, doc_num: 123, customer_name: 'CUSTOMER', lines: [{ line_number: 0, item_code: 'ITEM', item_name: 'PRODUCT', open_quantity: 1000, uom: 'KG' }] };
const operation = { id: 1, revision: 0, status: 'WAITING', vehicle_number: 'TRUCK', container_number: 'CONTAINER', containers: ['CONTAINER'], pallets: [], first_weight: 10000 };
f.get = async (path) => {
  if (path === 'operations/') return { operations: [operation], next_offset: null };
  if (path === 'elements/') return { elements: [{ id: 1, name: 'PALLET', weight: '25' }, { id: 2, name: 'BOX', weight: '0.5' }] };
  if (path === 'orders/') return { orders: [order], next_offset: null };
  if (path === 'orders/10/') return { order };
  if (path === 'operations/1/') return { operation };
  if (path === 'sources/PALLET-A/') return { source: { batch_number: 'PALLET-A', item_code: 'ITEM', quantity: 100, source_warehouse: '20204' } };
  throw new Error(`Unexpected request: ${path}`);
};
f.save = async (id, payload) => { f.saved = { id, payload }; return { operation: { ...operation, status: 'LOADING', revision: 1, order, pallets: payload.pallets } }; };
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, plugins: [{
  name: 'shipping-wizard-check', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:shipping-hooks') return '\0' + id; },
  load(id) { if (id === '\0virtual:shipping-hooks') return `
    export function useState(initial){const f=globalThis.__shippingWizardTest,i=f.index++;if(!(i in f.states))f.states[i]=initial;return [f.states[i],value=>f.states[i]=typeof value==='function'?value(f.states[i]):value];}
    export const useEffect=()=>{},useCallback=fn=>fn,useMemo=fn=>fn(),useRef=()=>({current:null});`; },
  transform(code, id) {
    if (id.endsWith('/contexts/AuthContext.jsx')) return 'export const useAuth=()=>({user:{role:"admin",is_superuser:true}});';
    if (id.endsWith('/contexts/I18nContext.jsx')) return 'export const useI18n=()=>({lang:globalThis.__shippingWizardTest.lang,t:key=>key});';
    if (id.endsWith('/services/shippingService.js')) return 'export const shippingGet=(...args)=>globalThis.__shippingWizardTest.get(...args),shippingPost=async()=>({}),saveShippingManifest=(...args)=>globalThis.__shippingWizardTest.save(...args);';
    if (id.endsWith('/components/ui/PageHeader.jsx')) return 'export default function Header(){return null;}';
    if (id.endsWith('/components/ui/SearchableSelect.jsx')) return `import React from 'react';export default function Select(props){return React.createElement('label',null,props.label,React.createElement('select',{disabled:props.disabled,value:props.value,onChange:()=>{}},props.options.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label))));}`;
    if (id.endsWith('/pages/ShippingLoadingPage.jsx')) return code
      .replace("import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';", "import React from 'react';import {useCallback,useEffect,useMemo,useRef,useState} from 'virtual:shipping-hooks';")
      .replace('  return <div className="page-shell shipping-loading"', '  globalThis.__shippingWizardTest.page={refresh,selectOrder,open,setStep,setScan,addPallet,update,save,step,canNext,completePackaging,deduction};\n  return <div className="page-shell shipping-loading"');
  },
}] });
try {
  const { default: Page } = await server.ssrLoadModule('/src/pages/ShippingLoadingPage.jsx');
  const render = () => { f.index = 0; return renderToString(React.createElement(Page)); };
  for (const lang of ['ar', 'en']) {
    f.lang = lang; f.states = []; render(); await f.page.refresh();
    let html = render();
    assert.ok(html.includes(`dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`));
    assert.ok(html.includes('CUSTOMER'));
    assert.ok(!html.includes('TRUCK'), 'Truck selection must follow order selection');
    await f.page.selectOrder(10); html = render();
    assert.equal(f.page.step, 1); assert.ok(html.includes('TRUCK')); assert.ok(!html.includes('shipping-scan'));
    await f.page.open(1); html = render();
    assert.equal(f.page.step, 2); assert.ok(html.includes('shipping-scan')); assert.ok(!html.includes('shipping-element-row'));
    assert.equal(f.page.canNext, false, 'Cannot leave loading without a pallet');
    f.page.setScan('PALLET-A'); render(); await f.page.addPallet({ preventDefault() {} }); render();
    assert.equal(f.page.canNext, true);
    f.page.setStep(3); html = render();
    assert.equal((html.match(/class="shipping-element-row"/g) || []).length, 2);
    assert.ok(html.includes('PALLET (25.00 KG)')); assert.ok(html.includes('BOX (0.50 KG)'));
    assert.equal(f.page.canNext, false, 'Packaging data is required before review');
    f.page.update(0, 'pallet_element_id', '1'); f.page.update(0, 'box_element_id', '2'); f.page.update(0, 'box_count', '80'); render();
    assert.equal(f.page.canNext, true); assert.equal(f.page.deduction, 65);
    f.page.setStep(4); html = render(); assert.ok(!html.includes('shipping-element-row')); assert.ok(html.replaceAll('<!-- -->', '').includes('65.00 KG'));
    await f.page.save(); render(); assert.equal(f.saved.payload.sales_order_doc_entry, 10); assert.equal(f.saved.payload.container_number, 'CONTAINER'); assert.equal(f.saved.payload.pallets[0].box_count, '80'); assert.equal(f.page.step, 4);
    console.log(`PASS ${lang}: order-first wizard, isolated steps, packaging validation, shared element weights, review and save.`);
  }
} finally { await server.close(); delete globalThis.__shippingWizardTest; }
