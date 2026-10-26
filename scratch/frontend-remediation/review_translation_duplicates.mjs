import fs from 'node:fs/promises';
import { parse } from '../../frontend/node_modules/@babel/parser/lib/index.js';
const file = new URL('../../frontend/src/i18n/translations.js', import.meta.url);
let source = await fs.readFile(file, 'utf8');
const ast = parse(source, { sourceType: 'module' });
const edits = [], findings = [];
function walk(node, path = []) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ObjectExpression') {
    const groups = new Map();
    for (const property of node.properties) {
      if (property.type !== 'ObjectProperty' || property.computed) continue;
      const key = property.key.name ?? property.key.value;
      const group = groups.get(key) || []; group.push(property); groups.set(key, group);
      walk(property.value, [...path, key]);
    }
    for (const [key, properties] of groups) if (properties.length > 1) {
      const scope = [...path, key].join('.');
      const excluded = path.some(part => String(part).toLowerCase().includes('scale'));
      findings.push({ scope, lines: properties.map(p=>p.loc.start.line), action: excluded ? 'excluded scale namespace; unchanged' : 'remove overwritten declaration; retain last effective value' });
      if (!excluded) for (const property of properties.slice(0, -1)) {
        let end = property.end; while (/\s/.test(source[end] || '') && end < source.length) end++;
        if (source[end] === ',') end++;
        edits.push([property.start, end]);
      }
    }
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) value.forEach(child=>walk(child,path)); else if (value && typeof value==='object') walk(value,path);
  }
}
walk(ast);
await fs.writeFile(new URL('./translation-duplicates.json', import.meta.url), JSON.stringify(findings, null, 2));
if (process.argv.includes('--apply')) {
  for (const [start,end] of edits.sort((a,b)=>b[0]-a[0])) source=source.slice(0,start)+source.slice(end);
  await fs.writeFile(file,source);
}
console.log(JSON.stringify(findings));
