import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Linter} from '../../frontend/node_modules/eslint/lib/api.js';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'../..'),out=import.meta.dirname;
const targets=['frontend/src/contexts/AuthContext.jsx','frontend/src/contexts/I18nContext.jsx','frontend/src/components/ui/ToastProvider.jsx'];
const priorExclusions=JSON.parse(fs.readFileSync(path.join(root,'scratch/frontend-remediation/node-exclusions.json'),'utf8')).map(r=>r.file);
const protectedPath=p=>priorExclusions.includes(p)||/scale|weigh|ticket|responsive/i.test(p)||p==='frontend/src/i18n/translations.js';
const paths=[];
function list(dir){for(const ent of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
 const key=dir+'/'+ent.name;
 if(protectedPath(key))continue;
 if(ent.isDirectory()){if(!['node_modules','dist','.git','__pycache__'].includes(ent.name))list(key);}
 else if(ent.isFile()&&/\.(?:jsx?|mjs|cjs|py)$/.test(ent.name))paths.push(key);
}}
list('frontend');
const allowed=new Set(paths),hashes={},imports=[],failures=[],textMentions=[],uncertain=[],exports=[],lexicalMentions=[];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function resolve(file,spec){
 if(!spec.startsWith('.'))return null;
 const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
 return [base,...['.js','.jsx','.mjs','/index.js','/index.jsx'].map(ext=>base+ext)].find(p=>allowed.has(p))||null;
}
const linter=new Linter();
for(const file of paths){
 const buffer=fs.readFileSync(path.join(root,file));hashes[file]=sha(buffer);const source=buffer.toString('utf8');
 source.split(/\r?\n/).forEach((line,i)=>{for(const match of line.matchAll(/\b(?:AuthContext|I18nContext|ToastProvider|AuthProvider|I18nProvider|useAuth|useI18n|useToast)\b/g))lexicalMentions.push({file,line:i+1,column:match.index+1,token:match[0],kind:'supplemental-text-match-may-be-comment-or-test-string'});});
 if(file.endsWith('.py')){
  source.split(/\r?\n/).forEach((line,i)=>{if(/AuthContext|I18nContext|ToastProvider|useAuth|useI18n|useToast/.test(line))textMentions.push({file,line:i+1,text:line.trim(),kind:'python-test-source-text-not-module-import'});});continue;
 }
 const pending=[],jsx=[];
 const messages=linter.verify(source,[{files:['**/*.{js,jsx,mjs,cjs}'],languageOptions:{ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{evidence:{rules:{collect:{create(context){
  const code=context.sourceCode;
  const add=(node,spec,kind,bindings=[])=>{pending.push({file,line:node.loc.start.line,column:node.loc.start.column+1,specifier:spec,resolved:resolve(file,spec),kind,bindings,node});};
  return {
   ImportDeclaration(node){add(node,node.source.value,'static-import',node.specifiers.map(s=>({imported:s.type==='ImportSpecifier'?s.imported.name||s.imported.value:s.type==='ImportDefaultSpecifier'?'default':'*',local:s.local.name,uses:[]})));},
   ExportNamedDeclaration(node){
    if(node.source)add(node,node.source.value,'named-reexport',node.specifiers.map(s=>({imported:s.local.name,exported:s.exported.name})));
    if(targets.includes(file))exports.push({file,line:node.loc.start.line,names:node.declaration?.id?[node.declaration.id.name]:node.declaration?.declarations?.map(d=>d.id.name)||node.specifiers.map(s=>s.exported.name)});
   },
   ExportAllDeclaration(node){add(node,node.source.value,'star-reexport');},
   ImportExpression(node){if(node.source.type==='Literal')add(node,node.source.value,'dynamic-import');else uncertain.push({file,line:node.loc.start.line,kind:'computed-import',expression:source.slice(node.source.range[0],node.source.range[1])});},
   CallExpression(node){
    const callee=node.callee.type==='Identifier'?node.callee.name:node.callee.type==='MemberExpression'?node.callee.property.name:null;
    if(['require','ssrLoadModule','readFile','readFileSync'].includes(callee)){
     const arg=node.arguments[0];if(arg?.type==='Literal'&&typeof arg.value==='string'&&/AuthContext|I18nContext|ToastProvider/.test(arg.value))add(node,arg.value,'tool-'+callee);
    }
   },
   JSXOpeningElement(node){let name=node.name;while(name.type==='JSXMemberExpression')name=name.object;if(name.type==='JSXIdentifier')jsx.push({name:name.name,line:name.loc.start.line,column:name.loc.start.column+1,kind:'jsx-render'});},
   'Program:exit'(){for(const row of pending){
    if(row.kind==='static-import')for(const variable of code.getDeclaredVariables(row.node)){
     const binding=row.bindings.find(b=>b.local===variable.name);
     if(binding){binding.uses=variable.references.map(r=>({line:r.identifier.loc.start.line,column:r.identifier.loc.start.column+1,kind:'binding-reference'}));binding.uses.push(...jsx.filter(j=>j.name===binding.local).map(({name,...rest})=>rest));}
    }
    delete row.node;imports.push(row);
   }}
  };
 }}}}},rules:{'evidence/collect':'error'}}],{filename:file});
 if(messages.some(m=>m.fatal))failures.push({file,messages});
}
const carriers=new Set(targets);
let changed=true;while(changed){changed=false;for(const row of imports)if(row.kind.includes('reexport')&&carriers.has(row.resolved)&&!carriers.has(row.file)){carriers.add(row.file);changed=true;}}
const related=imports.filter(r=>carriers.has(r.resolved)||/AuthContext|I18nContext|ToastProvider/.test(r.specifier));
const boundary=imports.filter(r=>protectedPath(path.posix.normalize(path.posix.join(path.posix.dirname(r.file),r.specifier)))&&r.specifier.startsWith('.')).map(r=>({importer:r.file,line:r.line,specifier:r.specifier,reason:'Reference observed in allowed source only; destination not opened or traversed.'}));
const result={scope:'Allowed frontend source and test files only; protected paths pruned before traversal or read.',files_scanned:paths.length,parse_failures:failures,targets,exports,carriers:[...carriers],related,lexical_mentions:lexicalMentions,python_text_mentions:textMentions,computed_imports:uncertain,protected_boundary_references:boundary,complete_for_protected_consumers:false};
fs.writeFileSync(path.join(out,'import-map.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(out,'source-hashes.json'),JSON.stringify(hashes,null,2));
let markdown='# خريطة المستهلكين المسموحين\n\nالخريطة ساكنة، ولا تشمل محتوى المصادر المحمية. مراجع Python نصوص اختبار وليست استيراد runtime.\n\n| الملف:السطر | النوع / المسار | الأسماء ومواقع الاستخدام |\n|---|---|---|\n';
for(const row of related)markdown+=`| ${row.file}:${row.line} | ${row.kind}: ${row.specifier} | ${row.bindings.map(b=>`${b.imported} → ${b.local||b.exported}: ${(b.uses||[]).map(u=>`${u.line}:${u.column} (${u.kind})`).join(', ')||'غير مثبت في هذه الخريطة'}`).join('; ')} |\n`;
fs.writeFileSync(path.join(out,'IMPORT_MAP_AR.md'),markdown);
console.log(JSON.stringify({files:paths.length,parse_failures:failures.length,context_edges:related.length,bindings:related.reduce((n,r)=>n+r.bindings.length,0),computed_imports:uncertain.length,protected_reference_edges:boundary.length}));
if(failures.length)process.exitCode=1;
