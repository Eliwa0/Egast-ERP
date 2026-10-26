import fs from 'node:fs';
import { parse } from '../../frontend/node_modules/@babel/parser/lib/index.js';
const extract = source => {
  const found = {};
  const walk = (node,path=[]) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectExpression') {
      for (const p of node.properties) if (p.type === 'ObjectProperty') {
        const key=p.key.name ?? p.key.value;
        if (key==='scale') found[[...path,key].join('.')]=source.slice(p.value.start,p.value.end);
        walk(p.value,[...path,key]);
      }
      return;
    }
    for(const [key,value] of Object.entries(node)) if(!['loc','comments'].includes(key)) {
      if(Array.isArray(value))value.forEach(child=>walk(child,path));
      else if(value&&typeof value==='object')walk(value,path);
    }
  };
  walk(parse(source,{sourceType:'module'}));return found;
};
const before=extract(fs.readFileSync(new URL('./translations-before.js',import.meta.url),'utf8'));
const after=extract(fs.readFileSync(new URL('../../frontend/src/i18n/translations.js',import.meta.url),'utf8'));
const result=Object.keys(before).map(scope=>({scope,exactSourceUnchanged:before[scope]===after[scope],unchangedIgnoringEol:before[scope].replace(/\r\n/g,'\n')===after[scope].replace(/\r\n/g,'\n')}));
fs.writeFileSync(new URL('./scale-namespace-integrity.json',import.meta.url),JSON.stringify(result,null,2));
console.log(result);
