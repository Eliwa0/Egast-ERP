import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const names = ['SalesQuotationCreatePage', 'SalesQuotationsPage', 'CustomizationDetailPage',
  'SalesQuotationsReviewPage', 'SalesOrdersPage', 'SalesOrdersReviewPage',
  'DeliveriesPage', 'DeliveryCreateWizardPage', 'DeliveryDetailPage', 'DeliveryReviewPage'];
const inventory = [];
for (const name of names) {
  const file = `src/pages/${name}.jsx`;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const fragment = (node) => node ? source.slice(node.start, node.end).replace(/\s+/g, ' ').trim() : '';
  function visit(node, conditions = []) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
      conditions = [...conditions, fragment(node.test || node.left).slice(0, 180)];
    }
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'button') {
      const attrs = node.openingElement.attributes;
      const attr = (key) => fragment(attrs.find(a => a.name?.name === key)?.value);
      inventory.push({ file, line: node.loc.start.line, label: node.children.map(fragment).join(' ').trim(),
        handler: attr('onClick'), disabled: attr('disabled'), type: attr('type'),
        conditions, className: attr('className') });
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'tokens', 'comments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(child => visit(child, conditions));
      else if (value && typeof value === 'object') visit(value, conditions);
    }
  }
  visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }));
}
fs.writeFileSync(path.join(root, '../scratch/sales-journey/button-inventory.json'), JSON.stringify(inventory, null, 2));
console.log(`${inventory.length} workflow button instances audited across ${names.length} pages. Runtime coverage is recorded separately.`);
