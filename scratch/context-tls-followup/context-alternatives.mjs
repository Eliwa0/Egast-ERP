import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from '../../frontend/node_modules/eslint/lib/api.js';
const root=path.resolve(import.meta.dirname,'../..');
const eslint=new ESLint({cwd:path.join(root,'frontend')});
const rows=[];
for(const [provider,hook,file] of [
 ['AuthProvider','useAuth','src/contexts/AuthContext.jsx'],
 ['I18nProvider','useI18n','src/contexts/I18nContext.jsx'],
 ['ToastProvider','useToast','src/components/ui/ToastProvider.jsx'],
]){
 for(const [variant,source,expectError] of [
  ['original-contract',`export function ${provider}({children}) {return children;} export function ${hook}(){return null;}`,true],
  ['reexport-hook',`export function ${provider}({children}) {return children;} export {${hook}} from './hooks.js';`,true],
  ['reexport-both',`export {${provider}} from './Provider.jsx'; export {${hook}} from './hooks.js';`,true],
  ['provider-only',`export function ${provider}({children}) {return children;}`,false],
  ['hook-only',`export function ${hook}(){return null;}`,false],
 ]){
  const [result]=await eslint.lintText(source,{filePath:path.join(root,'frontend',file)});
  const errors=result.messages.filter(m=>m.ruleId==='react-refresh/only-export-components');
  assert.equal(errors.length>0,expectError,`${provider}: ${variant}`);
  rows.push({provider,hook,variant,refresh_errors:errors.length,contract_preserved:['original-contract','reexport-hook','reexport-both'].includes(variant)});
 }
}
const actual=await eslint.lintFiles(['src/contexts/AuthContext.jsx','src/contexts/I18nContext.jsx','src/components/ui/ToastProvider.jsx']);
fs.writeFileSync(path.join(import.meta.dirname,'context-findings.json'),JSON.stringify(actual,null,2));
fs.writeFileSync(path.join(import.meta.dirname,'context-alternatives.json'),JSON.stringify({diagnostic_assertions:rows.length,rows,actual_errors:actual.reduce((s,r)=>s+r.errorCount,0),actual_warnings:actual.reduce((s,r)=>s+r.warningCount,0)},null,2));
console.log('15 diagnostic assertions passed; actual context lint errors:',actual.reduce((s,r)=>s+r.errorCount,0));
