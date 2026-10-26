// Component rendering and error-state tests; isolated fixtures, no operational writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const f = globalThis.__physicalTest = {};
const server = await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true},plugins:[{
  name:'physical-component-test',enforce:'pre',
  resolveId(id) { if(id==='virtual:physical-state') return '\0'+id; },
  load(id) { if(id==='\0virtual:physical-state') return `
    export function useState(initial) {const f=globalThis.__physicalTest,i=f.index++;
      if (!(i in f.states)) f.states[i]=typeof initial==='function'?initial():initial;
      return [f.states[i],value=>{f.states[i]=typeof value==='function'?value(f.states[i]):value;}];}
    export function useEffect(callback) {globalThis.__physicalTest.effects.push(callback);}
  `; },
  transform(code,id) {
    if(id.endsWith('/contexts/I18nContext.jsx')) return `export const useI18n=()=>({lang:globalThis.__physicalTest.lang,t:key=>{
      const f=globalThis.__physicalTest;return key.split('.').reduce((value,part)=>value?.[part],f.translations[f.lang])||key;}});`;
    if(id.endsWith('/contexts/AuthContext.jsx')) return `export const useAuth=()=>({user:{role:'transfer_user',module_permissions:{transfer:'USER'}}});`;
    if(id.endsWith('/services/api.js')) return `export default {get:async()=>({data:{data:{transfers:[],items:[]}}})};`;
    if(id.endsWith('/pages/TransferReviewPage.jsx')) return code.replace('useRef, useState', 'useRef').replace('useCallback, useEffect,', 'useCallback,')+"\nimport {useState,useEffect} from 'virtual:physical-state';";
    if(id.endsWith('/services/transferService.js')) return `export const fetchPhysicalEvents=async()=>{
      const f=globalThis.__physicalTest;if(f.failure)throw {response:{data:{error:f.failure}}};return f.response;};
      export const fetchDestinationSapBins=async()=>({locations:[]});
      export const fetchPhysicalBatch=async()=>{throw Error('Not called in rendering tests');};
      export const confirmPhysicalTransfer=async()=>{throw Error('Physical writes forbidden in rendering tests');};`;
    if(id.endsWith('/components/PhysicalTransfer.jsx')) return code.replace("import React, { useEffect, useState } from 'react';", "import React from 'react';")+"\nimport {useState,useEffect} from 'virtual:physical-state';";
  },
}]});
try {
  f.translations=(await server.ssrLoadModule('/src/i18n/translations.js')).translations;
  const {PhysicalTransferReview:Review}=await server.ssrLoadModule('/src/modules/transfer/components/PhysicalTransfer.jsx');
  const {default:ShippingPage}=await server.ssrLoadModule('/src/pages/TransferReviewPage.jsx');
  function render(Component,states) {if(states)f.states=states;f.index=0;f.effects=[];return renderToString(React.createElement(Component));}
  for(const lang of ['en','ar']) {
    f.lang=lang;
    let html;
    const events=[{id:1,reference:'ARRIVAL-REF',stage:4,state:'IN_SHIPPING_HALL',batch_number:'PALLET',destination_location:'SHIPPING_HALL'},
      {id:2,reference:'LOAD-REF',stage:5,state:'LOADED_TO_CONTAINER',batch_number:'PALLET',source_location:'SOURCE-LOAD',destination_location:'HIDDEN-DESTINATION',container_number:'CONT-A',actor:null,created_at:null}];
    html=render(Review,[{events,next_offset:null},'',false,0,0]);
    assert.ok(html.includes(f.translations[lang].physicalTransfer.LOADED_TO_CONTAINER));
    assert.ok(!html.includes('ARRIVAL-REF'));assert.ok(html.includes('CONT-A'));
    assert.ok(html.includes('SOURCE-LOAD'));assert.ok(!html.includes('HIDDEN-DESTINATION'));
    assert.ok(html.includes(f.translations[lang].physicalTransfer.shippingLoading.replaceAll('&','&amp;')));
    assert.ok(!html.includes(f.translations[lang].physicalTransfer.history));
    assert.ok(!html.includes(f.translations[lang].physicalTransfer.shippingHall));
    assert.ok(!html.includes(f.translations[lang].transferReview.toWh));
    f.response={events,next_offset:null};
    render(ShippingPage,[]);
    f.states[8]='POSTED';
    f.effects.forEach(effect=>effect());
    await new Promise(resolve=>setImmediate(resolve));
    html=render(ShippingPage);
    assert.ok(html.includes(f.translations[lang].transferReview.stage5));
    assert.ok(html.includes('LOAD-REF'));assert.ok(!html.includes('ARRIVAL-REF'));
    assert.ok(!html.includes('HIDDEN-DESTINATION'));
    assert.ok(!html.includes(f.translations[lang].transferReview.postSelected));
    html=render(Review,[{events:[events[0]],next_offset:50},'',false,0,0]);
    assert.ok(html.includes(f.translations[lang].physicalTransfer.empty));
    assert.ok(!html.includes('ARRIVAL-REF'));
    html=render(Review,[{events:[],next_offset:null},'',false,0,0]);
    assert.ok(html.includes(f.translations[lang].physicalTransfer.empty));
    f.failure='API FAILURE';render(Review,[]);f.effects.forEach(effect=>effect());await new Promise(resolve=>setImmediate(resolve));
    html=render(Review);assert.ok(html.includes('API FAILURE'));assert.ok(!html.includes(f.translations[lang].physicalTransfer.empty));
    f.failure=null;
  }
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app, /path="\/transfer-review\/shipping"[^\n]*Navigate to="\/transfer-review"/);
  console.log('PASS: EN/AR physical Review states, nullable fields, empty state and API error.');
}finally{await server.close();delete globalThis.__physicalTest;}
