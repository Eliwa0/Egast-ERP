// Real component/service code with declared state and HTTP fixtures; no business writes.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const fixture = globalThis.__predeployUI = { index: 0, lang: 'en', requests: [] };
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)),
  cacheDir: 'node_modules/.vite-predeploy-regression-test', server: { middlewareMode: true }, plugins: [{
    name: 'predeploy-declared-state', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:predeploy-state') return '\0' + id; },
    load(id) { if (id === '\0virtual:predeploy-state') return `export function useState(initial) {
      const f=globalThis.__predeployUI, n=f.index++;
      const values=[[],{id:1,status:'DRAFT',lines:[],cost_center_1:'VERIFIED-CC'},false,false,'',''];
      return [n<values.length?values[n]:initial,()=>{}]; }`; },
    transform(code, id) {
      if (id.endsWith('/contexts/AuthContext.jsx')) return 'export const useAuth=()=>({user:{is_superuser:true}});';
      if (id.endsWith('/contexts/I18nContext.jsx')) return `export const useI18n=()=>({lang:globalThis.__predeployUI.lang,t:key=>key});`;
      if (id.endsWith('/services/api.js')) return `export default {get: async(path,config)=>{
        globalThis.__predeployUI.requests.push({path,config});
        if(path!=='/quality/cost-centers/?dimension=1')throw new Error('Unexpected fixture request');
        return {data:{cost_centers:[{code:'CC1',name:'Location'}]}};
      }};`;
      if (id.endsWith('/components/delivery/DeliveryWorkflowPanel.jsx')) return code.replace(', useState }', ' }') + "\nimport {useState} from 'virtual:predeploy-state';";
    },
  }] });
try {
  const { default: Panel } = await server.ssrLoadModule('/src/components/delivery/DeliveryWorkflowPanel.jsx');
  for (const [lang, text] of [['en', 'User Specified'], ['ar', 'محدد بواسطة المستخدم']]) {
    fixture.lang = lang; fixture.index = 0;
    const html = renderToString(React.createElement(Panel, { order: { document_entry: 77 } }));
    assert.ok(html.includes('VERIFIED-CC') && html.includes(text), lang);
  }
  assert.equal(fixture.requests.length, 0, 'Rendering must not submit a document');
  const { loadLocations } = await server.ssrLoadModule('/src/services/purchaseQuotationService.js');
  assert.deepEqual(await loadLocations(), [{ code: 'CC1', name: 'Location' }]);
  assert.equal(fixture.requests.length, 1);
  const { translations } = await server.ssrLoadModule('/src/i18n/translations.js');
  assert.match(translations.en.grpo.openTimeoutRetrying, /Refreshing/);
  assert.match(translations.ar.grpo.openTimeoutRetrying, /تحديث القائمة/);
  console.log('PASS: EN/AR active delivery draft rendering; loadLocations dimension-1 delegation; EN/AR GRPO timeout text; no writes.');
} finally { await server.close(); delete globalThis.__predeployUI; }
