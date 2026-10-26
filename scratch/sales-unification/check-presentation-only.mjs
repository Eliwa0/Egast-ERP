import fs from 'node:fs';
import {parse} from '../../frontend/node_modules/@babel/parser/lib/index.js';
import assert from 'node:assert/strict';
const canonical=node=>{
 if(Array.isArray(node))return node.map(canonical).filter(v=>v!==null);
 if(!node||typeof node!=='object')return node;
 if(node.type==='ImportDeclaration'&&node.source.value.includes('/SalesDocumentCard'))return null;
 if(node.type==='JSXAttribute'&&['style','className','active'].includes(node.name?.name))return null;
 if(node.type==='JSXIdentifier'&&node.name==='SalesDocumentCard')return {...canonical({...node,name:'div'})};
 if(node.type==='JSXText'&&!node.value.trim())return null;
 return Object.fromEntries(Object.entries(node).filter(([k])=>!['loc','start','end','extra','comments','leadingComments','trailingComments','innerComments','tokens'].includes(k)).map(([k,v])=>[k,canonical(v)]));
};
const out=[];
for(const name of ['SalesQuotationsPage','SalesOrdersPage','DeliveriesPage']){
 const before=fs.readFileSync(new URL(`./baseline-pages/${name}.jsx`,import.meta.url),'utf8');
 const after=fs.readFileSync(new URL(`../../frontend/src/pages/${name}.jsx`,import.meta.url),'utf8');
 assert.deepEqual(canonical(parse(before,{sourceType:'module',plugins:['jsx']})),canonical(parse(after,{sourceType:'module',plugins:['jsx']})),name);
 out.push({page:name,unchangedExceptPresentationAttributesAndCardWrapper:true});
}
fs.writeFileSync(new URL('./presentation-equivalence.json',import.meta.url),JSON.stringify(out,null,2));console.log(out);
