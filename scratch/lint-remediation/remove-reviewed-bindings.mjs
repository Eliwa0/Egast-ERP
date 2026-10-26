import fs from 'node:fs';
import {parse} from '../../frontend/node_modules/@babel/parser/lib/index.js';
const ledger=JSON.parse(fs.readFileSync(new URL('../frontend-remediation/lint-review-ledger.json',import.meta.url),'utf8'));
const groups=Map.groupBy(ledger.filter(r=>r.rule==='no-unused-vars'),r=>r.file);
const audit=[];
for(const [file,rows] of groups){
 const source=fs.readFileSync(file,'utf8');const ast=parse(source,{sourceType:'module',plugins:['jsx']});const edits=[];
 function walk(node,parents=[]){
  if(!node||typeof node!=='object')return;
  if(node.type==='Identifier'){
   const hit=rows.find(r=>r.line===node.loc.start.line&&r.message.startsWith(`'${node.name}'`));
   if(hit){
    const p=parents.at(-1),g=parents.at(-2);let edit;
    if(p.type==='ArrayPattern')edit=[node.start,node.end,''];
    else if(p.type==='VariableDeclarator'&&p.id===node&&g.type==='VariableDeclaration'){
     if(g.declarations.length!==1)throw Error(file+': multiple declaration requires manual review');
     // Keep initializer evaluation (including hook ordering and any side effects).
     // Function expressions are never called by initialization and have no binding consumers.
     const init=p.init;
     edit=[g.start,g.end,init&&!['ArrowFunctionExpression','FunctionExpression'].includes(init.type)?source.slice(init.start,init.end)+';':''];
    }else if(p.type==='ImportSpecifier'){
     let end=p.end;while(/\s/.test(source[end]))end++;if(source[end]===',')end++;
     edit=[p.start,end,''];
    }else if(p.type==='CatchClause'&&p.param===node)edit=[node.start-1,node.end+1,''];
    else if(p.type==='ObjectProperty'&&g.type==='ObjectPattern'){
     let end=p.end;while(/\s/.test(source[end]))end++;if(source[end]===',')end++;
     let start=p.start;if(source[end]!==','&&source.slice(p.end,end).includes('}')===false&&source.slice(g.start,start).trimEnd().endsWith(','))start=source.lastIndexOf(',',start);
     edit=[start,end,''];
    }
    // Positional API slot currentValue is handled explicitly below.
    if(edit&&!edits.some(e=>e[0]===edit[0])){edits.push(edit);audit.push({file,line:hit.line,binding:node.name,action:'remove unused binding; preserve initializer evaluation and hook calls'});}
   }
  }
  for(const[k,v]of Object.entries(node))if(!['loc','comments','tokens'].includes(k)){if(Array.isArray(v))v.forEach(c=>walk(c,[...parents,node]));else if(v&&typeof v==='object')walk(v,[...parents,node]);}
 }
 walk(ast);let updated=source;for(const[a,b,t]of edits.sort((a,b)=>b[0]-a[0]))updated=updated.slice(0,a)+t+updated.slice(b);
 updated=updated.replace("(fieldKey, currentValue = '', fallbackOptions = [])",'(fieldKey, ...[, fallbackOptions = []])');
 parse(updated,{sourceType:'module',plugins:['jsx']});fs.writeFileSync(file,updated);
}
fs.writeFileSync(new URL('./binding-edits.json',import.meta.url),JSON.stringify(audit,null,2));
