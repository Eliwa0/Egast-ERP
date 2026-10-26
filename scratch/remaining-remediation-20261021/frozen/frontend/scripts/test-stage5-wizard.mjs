// Execute the existing wizard's actions and render each step; no live mutations.
import assert from 'node:assert/strict';
import React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {readFileSync} from 'node:fs';
import {renderToString} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const f=globalThis.__stage5Test={states:[],deps:[],selectors:{},calls:[]};
const oldWindow=globalThis.window;
globalThis.window={requestAnimationFrame:()=>{},matchMedia:()=>({matches:false})};
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true},plugins:[{
  name:'stage5-wizard-test',enforce:'pre',
  resolveId(id){if(id==='virtual:stage5-hooks')return '\0'+id;},
  load(id){if(id==='\0virtual:stage5-hooks')return `
    export function useState(initial){const f=globalThis.__stage5Test,i=f.index++;
      if(!(i in f.states))f.states[i]=typeof initial==='function'?initial():initial;
      return [f.states[i],value=>{f.states[i]=typeof value==='function'?value(f.states[i]):value;}];}
    export const useRef=initial=>useState({current:initial})[0];
    export function useMemo(callback,deps){const f=globalThis.__stage5Test,i=f.index++,old=f.deps[i];
      if(!old||deps.some((value,j)=>!Object.is(value,old[j]))){f.deps[i]=deps;f.states[i]=callback();}return f.states[i];}
    export function useEffect(callback,deps){const f=globalThis.__stage5Test,i=f.index++,old=f.deps[i];
      if(!old||deps.some((value,j)=>!Object.is(value,old[j]))){if(typeof f.states[i]==='function')f.states[i]();
        f.deps[i]=deps;f.effects.push(()=>{f.states[i]=callback();});}}
  `;},
  transform(code,id){
    if(id.endsWith('/contexts/AuthContext.jsx'))return `export const useAuth=()=>({user:globalThis.__stage5Test.ruleUser||{role:'transfer_user',module_permissions:{transfer:'USER'}}});`;
    if(id.endsWith('/services/api.js'))return `const f=globalThis.__stage5Test;export default {
      get:async path=>path==='/admin/users/'?{data:{data:{users:[{id:1,username:'loader'}]}}}:{data:{data:{rules:f.ruleStore.map(row=>({...row}))}}},
      post:async(path,payload)=>{f.rulePosts.push({path,payload});
        const existing=f.ruleStore.find(row=>row.user_id===payload.user_id&&row.warehouse_code===payload.warehouse_code&&row.stage===payload.stage&&row.direction===payload.direction);
        if(existing)Object.assign(existing,payload);else f.ruleStore.push({...payload,id:Math.max(0,...f.ruleStore.map(row=>row.id))+1});return {data:{}};},
      delete:async path=>{const id=Number(path.split('/').filter(Boolean).at(-1));f.ruleStore=f.ruleStore.filter(row=>row.id!==id);},};`;
    if(id.endsWith('/contexts/I18nContext.jsx'))return `const t=(key,...args)=>{
      const f=globalThis.__stage5Test,value=key.split('.').reduce((v,k)=>v?.[k],f.translations[f.lang]);
      return typeof value==='function'?value(...args):value||key;};export const useI18n=()=>({t});`;
    if(id.endsWith('/components/ui/SearchableSelect.jsx'))return `import React from 'react';export default function Select(props){
      globalThis.__stage5Test.selectors[props.id||props.label]=props;
      if(props['aria-label'])globalThis.__stage5Test.selectors[props['aria-label']]=props;
      return React.createElement('label',null,props.label,React.createElement('select',{id:props.id,value:props.value,multiple:props.multiple,onChange:props.onChange,disabled:props.disabled},props.children));}`;
    if(id.endsWith('/services/transferService.js'))return `
      export const fetchPhysicalBatch=async()=>globalThis.__stage5Test.batch;
      export const confirmPhysicalTransfer=async(stage,batch,container,source)=>{
        const f=globalThis.__stage5Test;f.calls.push({stage,batch,container,source});
        if(f.failure)throw {response:{data:{error:f.failure}}};
        return {event:{reference:'LOCAL-LOAD'},pallet:{state:'LOADED_TO_CONTAINER'}};};`;
    if(id.endsWith('/pages/TransferPage.jsx'))return code
      .replace("import { useNavigate } from 'react-router-dom';", "const useNavigate=()=>path=>{globalThis.__stage5Test.navigation=path;};")
      .replace('useCallback, useEffect, useRef, useState','useCallback')
      .replace("import { useTransferWorkflow } from '../hooks/useTransferWorkflow';",'const useTransferWorkflow=()=>globalThis.__stage5Test.workflow;')
      .replace(/  return \(\r?\n    <div className="page-shell transfer-page">/,
        '  globalThis.__stage5Test.page={next,back,selectStageAndContinue,currentStep,stepValid,handleScanBatch,handleConfirmPhysical,setContainerNumber,physicalBatchLines,physicalSubmitError};\n  return (\n    <div className="page-shell transfer-page">')
      +"\nimport {useState,useEffect,useRef} from 'virtual:stage5-hooks';";
    if(id.endsWith('/pages/TransferRulesPage.jsx'))return code
      .replace('useCallback, useEffect, useMemo, useState','useCallback')
      .replace("import { useNavigate } from 'react-router-dom';",'const useNavigate=()=>()=>{};')
      .replace('  if (!canAccessTransferRules(user)) {','  globalThis.__stage5Test.rulesPage={setSelectedStage,setSelectedFrom,setSelectedTo,saveRules,selectedFrom,selectedTo};\n  if (!canAccessTransferRules(user)) {')
      +"\nimport {useState,useEffect,useMemo} from 'virtual:stage5-hooks';";
  },
}]});
try{
  f.translations=(await server.ssrLoadModule('/src/i18n/translations.js')).translations;
  const {default:Page}=await server.ssrLoadModule('/src/modules/transfer/pages/TransferPage.jsx');
  function render(){f.index=0;f.effects=[];return renderToString(React.createElement(Page,{operation:f.operation}));}
  async function settle(){let html;for(let i=0;i<3;i++){html=render();f.effects.forEach(run=>run());await new Promise(resolve=>setImmediate(resolve));}return html;}
  for(const lang of ['en','ar'])for(const actor of ['user','admin']){
    f.lang=lang;f.states=[];f.deps=[];f.calls=[];
    f.workflow={stage:null,transferAccess:{allow_all:false,has_rules:true,rules:[
      {stage:'STAGE_5_TO_CONTAINER',direction:'FROM',warehouse_code:'20201',is_active:true},
      {stage:'STAGE_5_TO_CONTAINER',direction:'FROM',warehouse_code:'20202',is_active:true}]},
      transferAccessLoading:false,availableFromWarehouses:[{code:'20201',name:'Source A'},{code:'20202',name:'Source B'}],availableToWarehouses:[],fromBins:[],toBins:[],
      fromWarehouse:'',fromBin:'',toWarehouse:'',toBin:'',batchLines:[],scanInput:'',scanStatus:'IDLE',transferStatus:'IDLE',
      setStage:stage=>{f.workflow={...f.workflow,stage};},
      setFromWarehouse:fromWarehouse=>{f.workflow={...f.workflow,fromWarehouse};},
      setScanInput:scanInput=>{f.workflow={...f.workflow,scanInput};}};
    f.batch={pallet:null,current_location:'20201',current_state:'STAGE_2_COMPLETED',source_operation:'PTR-1'};
    const stage5Access=f.workflow.transferAccess;
    f.ruleUser={role:'admin',is_superuser:true};
    for(const access of [{allow_all:true,rules:[]},{allow_all:false,has_rules:true,rules:[
      {stage:'STAGE_4_TO_DESTINATION',direction:'FROM',warehouse_code:'20201',is_active:true}]}]){
      f.workflow={...f.workflow,transferAccess:access};
      const stages=await settle();
      assert.equal((stages.match(/class="transfer-stage-badge"/g)||[]).length,5);
      assert.ok(stages.includes(f.translations[lang].transfer.stage5Title));
    }
    f.workflow={...f.workflow,transferAccess:null,transferAccessLoading:true};
    assert.ok((await settle()).includes(f.translations[lang].transfer.stage5Title));
    f.operation='internal';
    f.workflow={...f.workflow,transferAccess:{allow_all:true,rules:[]},transferAccessLoading:false};
    const internal=await settle();
    assert.equal((internal.match(/class="transfer-stage-badge"/g)||[]).length,4);
    assert.ok(!internal.includes(f.translations[lang].transfer.stage5Title));
    f.operation='shipping';await settle();
    assert.equal(f.workflow.stage,'STAGE_5_TO_CONTAINER');assert.equal(f.page.currentStep,1);
    assert.ok(!(await settle()).includes(f.translations[lang].transfer.stage4Title));
    f.operation=undefined;f.states=[];f.deps=[];
    f.workflow={...f.workflow,stage:null};
    f.workflow={...f.workflow,transferAccess:stage5Access,transferAccessLoading:false};
    f.ruleUser=undefined;
    f.workflow={...f.workflow,transferAccess:{allow_all:false,rules:[]}};
    assert.ok(!(await settle()).includes(f.translations[lang].transfer.stage5Title));
    f.workflow={...f.workflow,transferAccess:stage5Access};
    if(actor==='admin'){
      f.ruleUser={role:'admin',is_superuser:true};
      f.workflow={...f.workflow,transferAccess:{allow_all:true,rules:[]}};
    }
    await settle();f.navigation=null;
    f.page.selectStageAndContinue('STAGE_5_TO_CONTAINER');await settle();
    assert.equal(f.navigation,'/shipping-loading');
    assert.equal(f.page.currentStep,0);
    assert.equal(f.calls.length,0); // Selecting the card never loads a pallet or posts SAP.
    console.log(`PASS ${lang}/${actor}: stage cards and Stage 5 navigate to the shipping manifest board.`);
  }
  const {default:RulesPage}=await server.ssrLoadModule('/src/pages/TransferRulesPage.jsx');
  for(const lang of ['en','ar']){
    f.lang=lang;f.states=[];f.deps=[];f.ruleUser={is_superuser:true,role:'admin'};f.rulePosts=[];
    const stage4Rows=[{id:1,user_id:1,stage:'STAGE_4_TO_DESTINATION',direction:'FROM',warehouse_code:'20201',is_active:true},
      {id:2,user_id:1,stage:'STAGE_4_TO_DESTINATION',direction:'TO',warehouse_code:'20202',is_active:true}];
    const legacySources=['10202','10203'].map((code,index)=>({id:index+10,user_id:1,stage:'STAGE_5_TO_CONTAINER',direction:'FROM',warehouse_code:code,is_active:true}));
    f.ruleStore=[...stage4Rows,...legacySources];
    async function settleRules(){let html;for(let i=0;i<5;i++){f.index=0;f.effects=[];html=renderToString(React.createElement(RulesPage));
      f.effects.forEach(run=>run());await new Promise(resolve=>setImmediate(resolve));}return html;}
    await settleRules();f.rulesPage.setSelectedStage('STAGE_5_TO_CONTAINER');let html=await settleRules();
    assert.ok(html.includes(f.translations[lang].transferReview.stage5));
    assert.ok(html.includes(f.translations[lang].transferRules.allowedFrom));
    assert.ok(!html.includes(f.translations[lang].transferRules.allowedTo));
    assert.equal(Boolean(f.selectors[f.translations[lang].transferRules.allowedFrom].multiple),false);
    assert.equal(f.selectors[f.translations[lang].transferRules.allowedFrom].searchInDropdown,true);
    const sourceSelector=f.selectors[f.translations[lang].transferRules.allowedFrom];
    assert.equal(sourceSelector.label,undefined); // Accessible external label, no floating-label overlap.
    assert.equal(sourceSelector.className,'transfer-rules-warehouse-select');
    assert.ok(html.includes(`for="${sourceSelector.id}"`));
    assert.deepEqual(f.rulesPage.selectedFrom,['10202']);
    assert.equal(sourceSelector.value,'10202');
    assert.deepEqual(f.ruleStore.filter(row=>row.stage==='STAGE_5_TO_CONTAINER'),legacySources);
    assert.equal(f.rulePosts.length,0); // Loading old multi-row data never mutates it.
    sourceSelector.onChange('10202');await settleRules();
    f.selectors[f.translations[lang].transferRules.allowedFrom].onChange('10203');await settleRules();
    assert.deepEqual(f.rulesPage.selectedFrom,['10203']);
    assert.equal(f.selectors[f.translations[lang].transferRules.allowedFrom].value,'10203');
    f.rulesPage.setSelectedTo(['STALE-TO']);await settleRules();
    await f.rulesPage.saveRules();await settleRules();
    assert.equal(f.rulePosts.length,1);assert.ok(f.rulePosts.every(row=>row.path==='/transfer/rules/warehouse-access/'
      &&row.payload.stage==='STAGE_5_TO_CONTAINER'&&row.payload.direction==='FROM'));
    assert.equal(f.rulePosts[0].payload.warehouse_code,'10203');
    assert.deepEqual(f.rulesPage.selectedFrom,['10203']);assert.deepEqual(f.rulesPage.selectedTo,[]);
    assert.equal(f.ruleStore.filter(row=>row.stage==='STAGE_5_TO_CONTAINER').length,1);
    assert.deepEqual(f.ruleStore.filter(row=>row.stage==='STAGE_4_TO_DESTINATION'),stage4Rows);
    f.rulesPage.setSelectedStage('STAGE_4_TO_DESTINATION');html=await settleRules();
    assert.ok(html.includes(f.translations[lang].transferRules.allowedTo));
    assert.deepEqual(f.rulesPage.selectedFrom,['20201']);assert.deepEqual(f.rulesPage.selectedTo,['20202']);
    for(const stage of ['STAGE_1_TO_INTERMEDIATE','STAGE_2_TO_FRIDGE','STAGE_3_FROM_FRIDGE','STAGE_4_TO_DESTINATION']){
      f.rulesPage.setSelectedStage(stage);await settleRules();
      assert.equal(f.selectors[f.translations[lang].transferRules.allowedFrom].searchInDropdown,true);
      assert.equal(f.selectors[f.translations[lang].transferRules.allowedTo].searchInDropdown,true);
      const from=f.selectors[f.translations[lang].transferRules.allowedFrom],to=f.selectors[f.translations[lang].transferRules.allowedTo];
      assert.equal(Boolean(from.multiple),false);assert.equal(Boolean(to.multiple),false);
      from.onChange('90214');await settleRules();
      f.selectors[f.translations[lang].transferRules.allowedFrom].onChange('90215');await settleRules();
      f.selectors[f.translations[lang].transferRules.allowedTo].onChange('20201');await settleRules();
      assert.deepEqual(f.rulesPage.selectedFrom,['90215']);assert.deepEqual(f.rulesPage.selectedTo,['20201']);
      await f.rulesPage.saveRules();await settleRules();
      assert.deepEqual(f.rulesPage.selectedFrom,['90215']);assert.deepEqual(f.rulesPage.selectedTo,['20201']);
    }
    f.rulesPage.setSelectedStage('STAGE_5_TO_CONTAINER');await settleRules();
    assert.deepEqual(f.rulesPage.selectedFrom,['10203']);assert.deepEqual(f.rulesPage.selectedTo,[]);
    console.log(`PASS ${lang}: all Rules warehouse fields single-select/searchable, replacement/save/reload in stages 1–5, legacy data untouched on load, Stage 5 FROM only.`);
  }
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.ok(app.includes('path="/transfer" element={<RequireAuth allow={canAccessTransfer}><TransferPage operation="internal" />'));
  assert.ok(app.includes('path="/shipping-loading" element={<RequireAuth allow={canAccessTransfer}><ShippingLoadingPage />'));
  assert.ok(app.includes('path="/transfer/shipping" element={<RequireAuth allow={canAccessTransfer}><Navigate to="/shipping-loading" replace />'));
  assert.ok(app.includes('path="/transfer-review" element={<RequireAuth allow={canAccessTransferReview}><TransferReviewPage />'));
  console.log('PASS: existing transfer selector and review guard preserved; shipping route opens the manifest board.');
}finally{await server.close();globalThis.window=oldWindow;delete globalThis.__stage5Test;}
