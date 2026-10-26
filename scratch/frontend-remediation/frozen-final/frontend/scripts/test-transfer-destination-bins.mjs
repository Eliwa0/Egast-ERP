// Isolated workflow hook tests; no live APIs, browser interception, or SAP writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const f = globalThis.__destinationTest = { states: [], dependencies: [], index: 0, effects: [] };
const s3 = 'STAGE_3_FROM_FRIDGE';
const s4 = 'STAGE_4_TO_DESTINATION';
const transferPage = fs.readFileSync(new URL('../src/modules/transfer/pages/TransferPage.jsx', import.meta.url), 'utf8');
const stageSelection = transferPage.slice(transferPage.indexOf('{currentStep === STEP_STAGE && ('), transferPage.indexOf('{currentStep === STEP_SOURCE'));
assert.equal((stageSelection.match(/aria-pressed=/g) || []).length, 5);
assert.equal(stageSelection.includes('disabled='), false);
f.warehouses = ['COLD', 'BIN-WH', 'PLAIN-WH', 'EMPTY-WH'].map(code => ({ code, name: code }));
f.intermediates=[{code:'90111',name:'Other transit'},{code:'90214',name:'Intermediate Warehouse'}];
f.calls = [];
f.access={allow_all:true};
const server = await createServer({ root, server: { middlewareMode: true }, plugins: [{
  name: 'destination-hook-unit-test', enforce: 'pre',
  resolveId(id) { if (id === 'virtual:destination-hooks') return '\0' + id; },
  load(id) { if (id === '\0virtual:destination-hooks') return `
    export function useState(initial) { const f=globalThis.__destinationTest,i=f.index++;
      if (!(i in f.states)) f.states[i]=typeof initial==='function'?initial():initial;
      return [f.states[i],value=>{f.states[i]=typeof value==='function'?value(f.states[i]):value;}]; }
    export const useRef=initial=>useState({current:initial})[0];
    export function useEffect(callback,deps) { const f=globalThis.__destinationTest,i=f.index++,old=f.dependencies[i];
      if (!old || deps.some((value,j)=>!Object.is(value,old[j]))) { f.states[i]?.(); f.dependencies[i]=deps; f.effects.push(()=>{f.states[i]=callback();}); } }
  `; },
  transform(code, id) {
    if (id.endsWith('/components/ui/SearchableSelect.jsx')) return code.replace('  const { t, lang } = useI18n();',
      '  const { t, lang } = useI18n();\n  if(id) { const f=globalThis.__destinationTest; f.selectors ||= {}; f.selectors[id]={searchInDropdown,searchSource,value}; }');
    if (id.endsWith('/contexts/AuthContext.jsx')) return `export const useAuth=()=>({user:globalThis.__destinationTest.user||{is_superuser:true,role:'admin'}});`;
    if (id.endsWith('/contexts/I18nContext.jsx')) return `export const useI18n=()=>({t:key=>key});`;
    if (id.endsWith('/services/transferService.js')) return `
      const f=globalThis.__destinationTest;
      export const fetchDestinationWarehouses=async()=>f.warehouses;
      export const fetchIntermediateWarehouses=async()=>f.intermediates;
      export const fetchTransferConfig=async()=>{throw Error('Configuration must not be requested');};
      export const fetchTransferWarehouseAccess=async()=>f.access;
      export const fetchDestinationBins=async()=>['SOURCE'];
      export const fetchBatchDetails=async()=>({itemCode:'ITEM',batchNumber:'PALLET',availableQuantity:100});
      export const submitInventoryTransfer=async payload=>{f.payload=payload; return {pending:true};};
      export const fetchPhysicalBatch=async()=>{throw Error('Not used in Stage 4');};
      export const confirmPhysicalTransfer=async()=>{throw Error('Physical writes forbidden');};
      export async function fetchDestinationSapBins(warehouse) {
        f.calls.push(warehouse);
        return {warehouse_code:warehouse,requires_bin:warehouse!=='PLAIN-WH',locations:warehouse==='BIN-WH'?[{code:'BIN-ONE'},{code:'BIN-TWO'}]:[]};
      }
    `;
    if (id.endsWith('/hooks/useTransferWorkflow.js')) return code
      .replace('useCallback, useEffect, useMemo, useState', 'useCallback, useMemo')
      + "\nimport {useState,useEffect,useRef} from 'virtual:destination-hooks';";
    if (id.endsWith('/hooks/useDestinationSapBins.js')) return code.replace("from 'react'", "from 'virtual:destination-hooks'");
    if (id.endsWith('/pages/TransferPage.jsx')) return code
      .replace("import { useNavigate } from 'react-router-dom';", "const useNavigate=()=>path=>{globalThis.__destinationTest.navigation=path;};")
      .replace('useCallback, useEffect, useRef, useState', 'useCallback')
      .replace("import { useTransferWorkflow } from '../hooks/useTransferWorkflow';", 'const useTransferWorkflow=()=>globalThis.__destinationTest.current;')
      .replace(/  return \(\r?\n    <div className="page-shell transfer-page">/, '  globalThis.__destinationTest.page={next,selectStageAndContinue,currentStep,stepValid};\n  return (\n    <div className="page-shell transfer-page">')
      + "\nimport {useState,useEffect,useRef} from 'virtual:destination-hooks';";
  },
}] });
try {
  const { useTransferWorkflow } = await server.ssrLoadModule('/src/modules/transfer/hooks/useTransferWorkflow.js');
  let current;
  function Harness() { current = useTransferWorkflow(); return React.createElement('span'); }
  async function settle() {
    for (let i=0;i<5;i++) { f.index=0; f.effects=[]; renderToString(React.createElement(Harness)); f.effects.forEach(run=>run()); await new Promise(resolve=>setImmediate(resolve)); }
  }
  await settle(); current.setStage(s3); current.setFromWarehouse('COLD'); current.setToWarehouse('BIN-WH');
  await settle(); current.setFromBin('SOURCE'); await settle(); current.setSourcePalletPosition({id:1,code:'SOURCE-POS'});
  await current.scanBatch('PALLET'); await settle();
  assert.equal(current.toBinRequired,true); assert.deepEqual(current.toBins,['BIN-ONE','BIN-TWO']);
  assert.equal(current.toBin,''); assert.equal(current.canSubmit,false);
  current.setToBin('BIN-TWO'); await settle(); assert.equal(current.canSubmit,true);
  assert.equal(current.palletPositionId,null); // SAP destination bin is not a physical position.
  current.setToWarehouse('PLAIN-WH'); await settle();
  assert.equal(current.toBin,''); assert.equal(current.toBinRequired,false); assert.equal(current.canSubmit,true);
  current.setToWarehouse('EMPTY-WH'); await settle();
  assert.equal(current.canSubmit,false); assert.equal(current.destinationBinError,'transfer.destinationSapBinsUnavailable');
  assert.deepEqual(f.calls,['BIN-WH','PLAIN-WH','EMPTY-WH']);
  f.warehouses.push({code:'90214',name:'Intermediate Warehouse'},{code:'90111',name:'Other transit'});
  current.setStage(s4); await settle();
  assert.equal(current.fromWarehouse,'');
  assert.equal(current.toWarehouse,'');
  assert.ok(current.availableFromWarehouses.some(row=>row.code==='90214'));
  assert.ok(current.availableFromWarehouses.some(row=>row.code==='COLD'));
  current.setFromWarehouse('90214'); await settle(); assert.equal(current.fromWarehouse,'90214');
  current.setToWarehouse('BIN-WH'); await settle();
  assert.equal(current.toBin,''); assert.equal(current.toBinRequired,true);
  current.setToBin('BIN-TWO'); await current.scanBatch('PALLET'); await settle();
  assert.equal(current.canSubmit,true); await current.submit(); await settle();
  assert.equal(f.payload.from_warehouse,'90214'); assert.equal(f.payload.to_warehouse,'BIN-WH');
  assert.equal(f.payload.to_bin,'BIN-TWO');
  f.warehouses.push({code:'90215',name:'Another Intermediate'});
  current.setStage(s4); await settle();
  assert.equal(current.fromWarehouse,''); assert.equal(current.toWarehouse,'');
  current.setFromWarehouse('90111'); await settle();
  current.setToWarehouse('90111'); await settle();await current.scanBatch('PALLET');await settle();
  assert.equal(current.canSubmit,false);
  current.setToWarehouse('PLAIN-WH'); await settle(); await current.scanBatch('PALLET'); await settle();
  f.current={...current,setStage:stage=>{f.current={...f.current,stage};}};
  const {default:TransferPage}=await server.ssrLoadModule('/src/modules/transfer/pages/TransferPage.jsx');
  const hookStates=f.states, hookDependencies=f.dependencies;
  f.states=[];f.dependencies=[];
  function renderPage() {f.index=0;f.effects=[];return renderToString(React.createElement(MemoryRouter, null, React.createElement(TransferPage)));}
  renderPage();f.page.selectStageAndContinue(s4);await renderPage();
  const selectedSource=f.current.fromWarehouse;
  f.current={...f.current,fromWarehouse:''};renderPage();
  assert.equal(f.page.stepValid[1],false);f.page.next();renderPage();assert.equal(f.page.currentStep,1);
  f.current={...f.current,fromWarehouse:selectedSource};renderPage();
  assert.equal(f.selectors['t-from-wh'].searchInDropdown,true);
  assert.equal(f.selectors['t-from-wh'].searchSource,undefined);
  assert.equal(f.page.currentStep,1);assert.equal(f.page.stepValid[1],true);
  f.page.next();renderPage();assert.equal(f.page.currentStep,2);
  f.page.next();renderPage();assert.equal(f.page.currentStep,3);
  assert.equal(f.selectors['t-to-wh'].searchInDropdown,true);
  assert.equal(f.selectors['t-to-wh'].searchSource,undefined);
  f.page.next();const review=renderPage();assert.equal(f.page.currentStep,4);
  assert.equal(f.page.stepValid[4],true);assert.ok(review.includes('90111'));assert.ok(review.includes('PLAIN-WH'));assert.ok(review.includes('PALLET'));
  f.page.selectStageAndContinue('STAGE_5_TO_CONTAINER');
  f.current={...f.current,stage:'STAGE_5_TO_CONTAINER',fromWarehouse:''};renderPage();
  assert.equal(f.navigation,'/shipping-loading');
  assert.equal(f.page.currentStep,4); // Navigation replaces the old in-page Stage 5 wizard.
  f.states=hookStates;f.dependencies=hookDependencies;
  console.log('PASS: TransferPage Source → Batches → Destination → Review transitions, Review values, and Stage 5 selection (isolated state test).');
  current.setToWarehouse('PLAIN-WH'); await settle(); await current.scanBatch('PALLET'); await settle();
  assert.equal(current.canSubmit,true); await current.submit(); await settle();
  assert.equal(f.payload.from_warehouse,'90111'); assert.equal(f.payload.to_warehouse,'PLAIN-WH');
  current.setStage(s4); await settle();
  assert.equal(current.fromWarehouse,''); assert.equal(current.toWarehouse,'');
  f.intermediates=[{code:'90214',name:'Only intermediate'}];
  f.warehouses=[f.intermediates[0],{code:'PLAIN-WH',name:'Only destination'}];
  f.access={allow_all:false,has_rules:true,rules:[
    {warehouse_code:'90214',direction:'FROM',stage:s4,is_active:true},
    {warehouse_code:'PLAIN-WH',direction:'TO',stage:s4,is_active:true},
    {warehouse_code:'PLAIN-WH',direction:'FROM',stage:s3,is_active:true},
  ]};
  f.states=[];f.dependencies=[];await settle();
  current.setStage('STAGE_5_TO_CONTAINER');await settle();
  assert.deepEqual(current.availableFromWarehouses.map(row=>row.code),f.warehouses.map(row=>row.code));
  assert.deepEqual(current.availableToWarehouses,[]);
  f.user={role:'transfer_user',module_permissions:{transfer:'USER'}};
  f.states=[];f.dependencies=[];await settle();current.setStage(s4);await settle();
  assert.equal(current.availableFromWarehouses.length,1);assert.equal(current.fromWarehouse,'');
  current.setFromWarehouse('90214');await settle();
  assert.equal(current.availableToWarehouses.length,1);assert.equal(current.toWarehouse,'');
  assert.deepEqual(current.availableFromWarehouses.map(row=>row.code),['90214']);
  assert.deepEqual(current.availableToWarehouses.map(row=>row.code),['PLAIN-WH']);
  f.current={...current,transferAccess:f.access};f.states=[];f.dependencies=[];
  assert.ok(renderPage().includes('transfer.stage4Title'));
  f.current={...f.current,transferAccess:{allow_all:false,rules:[]}};
  assert.equal(renderPage().includes('transfer.stage4Title'),false);
  f.access={allow_all:false,has_rules:true,rules:[
    {warehouse_code:'90214',direction:'FROM',stage:'STAGE_5_TO_CONTAINER',is_active:true},
    {warehouse_code:'PLAIN-WH',direction:'FROM',stage:'STAGE_4_TO_DESTINATION',is_active:true},
  ]};
  f.states=[];f.dependencies=[];await settle();current.setStage('STAGE_5_TO_CONTAINER');await settle();
  assert.deepEqual(current.availableFromWarehouses.map(row=>row.code),['90214']);
  assert.deepEqual(current.availableToWarehouses,[]);assert.equal(current.fromWarehouse,'');
  console.log('PASS: Stage 4 card grant, explicit stage isolation, FROM/TO warehouse restrictions and no single-option preselection.');
  console.log('PASS: Stage 4 sources 90214 and 90111 selected manually, no preselection, same-warehouse rejection, explicit destination/bin and submission payloads.');
  console.log('PASS: Stage 3 dynamic bin requirement, explicit selection, full-pallet workflow, warehouse reset, non-bin destination, and blocking empty state.');
} finally { await server.close(); delete globalThis.__destinationTest; }
