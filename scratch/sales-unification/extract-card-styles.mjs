import fs from 'node:fs';
import {parse} from '../../frontend/node_modules/@babel/parser/lib/index.js';
const audit=[];
for(const name of ['SalesQuotationsPage','SalesOrdersPage','DeliveriesPage']){
 const file=`frontend/src/pages/${name}.jsx`;const source=fs.readFileSync(file,'utf8');const edits=[];
 const walk=node=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='JSXElement'&&node.openingElement.name.name==='div'){
   const attrs=node.openingElement.attributes;
   const cls=attrs.find(a=>a.name?.name==='className');const style=attrs.find(a=>a.name?.name==='style');
   const properties=style?.value?.expression?.properties||[];
   const prop=key=>properties.find(p=>p.key?.name===key)?.value;
   if(cls?.value?.value?.startsWith('card-panel')&&prop('flexDirection')?.value==='column'&&prop('gap')?.value==='14px'){
    edits.push([node.openingElement.name.start,node.openingElement.name.end,'SalesDocumentCard'],[node.closingElement.name.start,node.closingElement.name.end,'SalesDocumentCard']);
    const extra=cls.value.value.replace('card-panel','').trim();edits.push([cls.start,cls.end,extra?`className="${extra}"`:'']);
    edits.push([style.start,style.end,source.slice(style.start,style.end).includes('order.has_remaining')?'active={order.has_remaining}':'']);
    audit.push({file,line:node.loc.start.line,change:'reuse SalesDocumentCard; preserve active order border via prop'});
   }else if(prop('gridTemplateColumns')?.value==='repeat(3, 1fr)'&&prop('textAlign')?.value==='center'){
    edits.push([style.start,style.end,'className="sales-document-quantities"']);audit.push({file,line:node.loc.start.line,change:'responsive quantity summary; same children/data'});
   }
  }
  for(const[k,v]of Object.entries(node))if(!['loc','comments','tokens'].includes(k)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 };
 walk(parse(source,{sourceType:'module',plugins:['jsx']}));let result=source;
 for(const[a,b,text]of edits.sort((a,b)=>b[0]-a[0]))result=result.slice(0,a)+text+result.slice(b);
 parse(result,{sourceType:'module',plugins:['jsx']});fs.writeFileSync(file,result);
}
fs.writeFileSync(new URL('./card-changes.json',import.meta.url),JSON.stringify(audit,null,2));console.log(audit);
