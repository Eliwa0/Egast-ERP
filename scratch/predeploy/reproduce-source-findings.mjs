// Review-only reproductions: existing source, declared local state, no HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from '../../frontend/node_modules/vite/dist/node/index.js';
import React from '../../frontend/node_modules/react/index.js';
import {renderToString} from '../../frontend/node_modules/react-dom/server.node.js';
globalThis.__predeployState = {index:0};
const server = await createServer({root:fileURLToPath(new URL('../../frontend/',import.meta.url)),
  cacheDir:fileURLToPath(new URL('./repro-vite-cache/',import.meta.url)),server:{middlewareMode:true},plugins:[{
    name:'review-state-only',enforce:'pre',
    resolveId(id){if(id==='virtual:predeploy-state')return '\0'+id;},
    load(id){if(id==='\0virtual:predeploy-state')return `export const useState=(initial)=>{
      const n=globalThis.__predeployState.index++;
      const values=[[],{id:1,status:'DRAFT',lines:[],cost_center_1:'FIXTURE'},false,false,'',''];
      return [n<values.length?values[n]:initial,()=>{}];};`;},
    transform(code,id){
      if(id.endsWith('/contexts/AuthContext.jsx'))return 'export const useAuth=()=>({user:{is_superuser:true}});';
      if(id.endsWith('/contexts/I18nContext.jsx'))return "export const useI18n=()=>({t:key=>key,lang:'en'});";
      if(id.endsWith('/services/api.js'))return "export default new Proxy({}, {get:()=>()=>{throw new Error('Unexpected HTTP in review fixture')}});";
      if(id.endsWith('/components/delivery/DeliveryWorkflowPanel.jsx'))return code.replace(', useState }', ' }')+"\nimport {useState} from 'virtual:predeploy-state';";
    }
  }]});
const results=[];
try{
  const service=await server.ssrLoadModule('/src/services/purchaseQuotationService.js');
  await assert.rejects(service.loadLocations(),error=>{
    results.push({source:'purchaseQuotationService.js:52',error:String(error)});
    return error instanceof ReferenceError && /loadCostCenters/.test(error.message);
  });
  const {default:Panel}=await server.ssrLoadModule('/src/components/delivery/DeliveryWorkflowPanel.jsx');
  assert.throws(()=>renderToString(React.createElement(Panel,{order:{document_entry:77}})),error=>{
    results.push({source:'DeliveryWorkflowPanel.jsx:531',error:String(error)});
    return error instanceof ReferenceError && /lang/.test(error.message);
  });
  console.log(JSON.stringify({confirmed:results.length,results}));
}finally{
  await fs.writeFile(new URL('./source-reproductions.json',import.meta.url),JSON.stringify(results,null,2));
  await server.close();delete globalThis.__predeployState;
}
