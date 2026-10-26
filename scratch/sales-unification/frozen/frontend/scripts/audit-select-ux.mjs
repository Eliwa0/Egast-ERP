import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const standard = {
  'components/customization/CustomizationWorkflowPanel.jsx': [342],
  'modules/scale/components/WeighingStageForm.jsx': [2217],
  'modules/scale/pages/ScaleDevicesPage.jsx': [851, 907, 956],
  'modules/scale/pages/ScaleDraftsPage.jsx': [199, 235],
  'modules/scale/pages/ScaleItemElementsPage.jsx': [228],
  'pages/ActivityLogPage.jsx': [491, 506, 521],
  'pages/CreateUserPage.jsx': [103], 'pages/GRPOReviewPage.jsx': [421],
  'pages/IssueReviewPage.jsx': [1049], 'pages/ItemCriteriaMappingPage.jsx': [47, 143],
  'pages/QualityCriteriaManagementPage.jsx': [73, 186], 'pages/QualityReviewPage.jsx': [667],
  'pages/ReceiptReviewPage.jsx': [402, 408, 1891, 2221], 'pages/ReceiptWizard.jsx': [1823, 1932, 2023],
  'pages/SalesDocumentListPage.jsx': [115], 'pages/SalesOrdersReviewPage.jsx': [280],
  'pages/SalesQuotationCreatePage.jsx': [1026, 1088, 1098],
  'pages/SalesQuotationsPage.jsx': [749], 'pages/SalesQuotationsReviewPage.jsx': [288],
  'pages/TransferPolicyPage.jsx': [233, 247], 'pages/TransferReviewPage.jsx': [516],
  'pages/TransferRulesPage.jsx': [238], 'pages/UserManagementPage.jsx': [519, 531, 567, 579, 650],
};
const records = [];
const compact = (s) => s.replace(/\s+/g, ' ').trim();
function visit(node, source, file) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'JSXElement' && ['SearchableSelect', 'StandardDropdown', 'Autocomplete', 'RemoteAutocomplete', 'Select', 'select'].includes(node.openingElement.name.name)) {
    const tag = node.openingElement.name.name;
    const attrs = Object.fromEntries(node.openingElement.attributes.filter((a) => a.type === 'JSXAttribute').map((a) => [a.name.name, a.value ? compact(source.slice(a.value.start, a.value.end)) : 'true']));
    const children = compact(source.slice(node.openingElement.end, node.closingElement?.start ?? node.openingElement.end));
    const binding = attrs.value || attrs.defaultValue || attrs.id || attrs.label || 'shared field';
    const options = attrs.searchSource || attrs.options || children;
    const hidden = attrs['aria-hidden'] === '"true"' || /display:\s*'none'/.test(attrs.style || '');
    const exempt = /selectedCostCenter[12]|defaultLocation|defaultCostCenter|form\.location|form\.general/.test(binding);
    const remote = Boolean(attrs.searchSource);
    const browse = /warehouseSearch|transferWarehouseSearch|binSearch|remoteBinSearch|userSearch/.test(options) || file === 'pages/TransferPolicyPage.jsx' && attrs.searchSource === '{source}';
    const type = hidden ? 'Hidden compatibility control' : exempt ? 'Exception: Location/General unchanged'
      : tag === 'StandardDropdown' || standard[file]?.includes(node.loc.start.line) ? 'A: Standard Dropdown'
        : remote && !browse ? 'C: Server-side Autocomplete' : 'B: Searchable Dropdown';
    let data = remote ? options : attrs.options || children;
    let expected = type.startsWith('A') ? '2–20 finite operational/configuration choices' : type.startsWith('C') ? 'Potentially thousands; bounded 25-result search' : 'Variable; initial page 25, then search/scroll';
    if (browse) data = /userSearch/.test(options) ? 'Local users: /api/admin/users/; module/level filter retained'
      : /binSearch|remoteBinSearch|\{source\}/.test(options) ? 'SAP bins: /api/bin-locations/{warehouse}/; parent warehouse retained'
        : `SAP warehouses: /api/${/transferWarehouseSearch/.test(options) ? 'transfer/' : ''}warehouses/`;
    else if (remote) data = /customerSearch/.test(options) ? 'SAP customers: /api/customization-delivery/customers/'
      : /salesItemSearch/.test(options) ? 'SAP items/prices: /api/customization-delivery/items/'
        : /scaleItemSearch/.test(options) ? 'SAP items: /api/scale/master-data/items/; selected group'
          : /itemSearch|remoteItemSearch/.test(options) ? 'SAP items: /api/quality/items/; selected group'
            : /batches/.test(options) ? 'SAP eligible batches: /api/customization-delivery/batches/; item/warehouse filters'
              : /scaleFarmSearch/.test(options) ? 'SAP suppliers: /api/scale/master-data/farms/'
                : /farmSearch/.test(options) ? 'SAP suppliers: /api/quality/farms/'
                  : 'SAP vendor helper: /api/quality/farms/ or /api/quality/contractors/; workflow-selected source';
    else if (exempt) { data = 'SAP cost centers: existing /api/quality/cost-centers/ dimensions 1/2 and loader'; expected = 'Existing dimension-specific list; unchanged'; }
    else if (/itemGroups|sapItemGroups|ItemGroup|GroupCode/.test(options + binding)) data = 'SAP item groups: /api/quality/item-groups/ or /api/scale/master-data/item-groups/; existing workflow loader';
    else if (/taxCodes|tax_code/.test(options + binding)) data = 'SAP tax codes: /api/tax-codes/; existing sales/receiving loader';
    else if (/selectedStageId|inspection_stage|stages\.map|stagesLoading/.test(options + binding)) data = 'Local configured inspection stages: /api/quality/inspection-stages/';
    else if (/categories\.map|selectedCategoryId|criterion-category/.test(options + binding)) data = 'Local configured categories: /api/quality/categories/';
    else if (/metadataOptions|quotationMetadata/.test(options)) data = 'SAP field/system metadata: /api/customization-delivery/quotation-metadata/';
    else if (/customerAddressOptions/.test(options)) data = 'Addresses in selected SAP customer lookup result (no separate full-catalog request)';
    else if (/brandOptions/.test(options)) data = 'SAP quotation UDF valid values: /api/customization-delivery/quotation-metadata/';
    else if (/Uom|uom|uomOpts/.test(options + binding)) data = 'Existing SAP/item-specific UOM options and UOM rules; unchanged loader';
    else if (/devices/.test(options)) data = 'Local scale devices: /api/scale/devices/; existing device list';
    else if (/detectedPortsList/.test(options)) data = 'Local scale agent discovered serial ports plus manual-port option';
    else if (/itemElements/.test(options)) data = 'Local scale item elements: /api/scale/item-elements/; existing loader';
    else if (/filterOptions/.test(options)) data = 'Distinct values from already-loaded Delivery review records; no extra catalog fetch';
    else data = `Finite existing options/state: ${data}`;
    records.push({ file: `frontend/src/${file}`, page: path.basename(file, '.jsx'), line: node.loc.start.line, field: binding, current: tag, multiple: attrs.multiple === 'true', source: data, expected, decision: type, rationale: hidden ? 'Not visible; compatibility only' : exempt ? 'Explicit user exception; no proven issue' : type.startsWith('A') ? 'Finite operational/configuration vocabulary; typing unnecessary' : type.startsWith('C') ? 'Large catalog: name/code search with debounce/cache and bounded results' : 'Users need to discover options before searching', start: node.openingElement.name.start, end: node.openingElement.name.end, closeStart: node.closingElement?.name.start, closeEnd: node.closingElement?.name.end });
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'tokens', 'comments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((v) => visit(v, source, file));
    else if (value && typeof value === 'object') visit(value, source, file);
  }
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(jsx|tsx)$/.test(absolute) && !absolute.includes(`${path.sep}components${path.sep}ui${path.sep}`)) {
      const source = fs.readFileSync(absolute, 'utf8');
      visit(parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }), source, path.relative(path.join(root, 'frontend/src'), absolute).replaceAll('\\', '/'));
    }
  }
}
walk(path.join(root, 'frontend/src'));
const target = path.join(root, 'docs/SELECT_UX_INVENTORY.json');
if (process.argv.includes('--verify')) {
  const baseline = JSON.parse(fs.readFileSync(target, 'utf8'));
  const candidates = new Map();
  for (const record of records) {
    const key = JSON.stringify([record.file, record.field]);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(record);
  }
  const failures = [];
  let preservedCardPicker = 0;
  for (const before of baseline) {
    const after = candidates.get(JSON.stringify([before.file, before.field]))?.shift();
    const expected = before.decision.startsWith('A') && before.current === 'SearchableSelect' ? 'StandardDropdown' : before.current;
    // ReceiptWizard changed concurrently after the baseline audit. Preserve its
    // existing browseable cards, and verify their original bin-code contract.
    if (!after && before.file === 'frontend/src/pages/ReceiptWizard.jsx' && before.field === "{batch.binLocationCode || ''}") {
      const source = fs.readFileSync(path.join(root, before.file), 'utf8');
      if (source.includes('className="bin-card-grid"') && source.includes('handleBinChange(batch.id, bin.code, index)') && source.includes('filteredBins.map((bin)')) {
        preservedCardPicker += 1;
        continue;
      }
    }
    if (!after || after.current !== expected || after.multiple !== before.multiple) failures.push({ file: before.file, field: before.field, expected, actual: after?.current });
  }
  if (records.length + preservedCardPicker !== baseline.length || failures.length) throw new Error(JSON.stringify({ before: baseline.length, after: records.length, failures }));
  console.log(`Verified ${records.length} select templates and ${preservedCardPicker} preserved bin-card picker: classified components, value bindings, multiple flags and Location/General exceptions preserved.`);
} else if (process.argv.includes('--apply')) {
  const baseline = JSON.parse(fs.readFileSync(target, 'utf8'));
  const files = new Map();
  for (const r of baseline.filter((r) => r.decision.startsWith('A') && r.current === 'SearchableSelect')) {
    if (!files.has(r.file)) files.set(r.file, []);
    files.get(r.file).push(r);
  }
  for (const [file, fields] of files) {
    const absolute = path.join(root, file);
    let source = fs.readFileSync(absolute, 'utf8');
    const edits = fields.flatMap((r) => [{ start: r.start, end: r.end }, ...(r.closeStart !== undefined ? [{ start: r.closeStart, end: r.closeEnd }] : [])]).sort((a, b) => b.start - a.start);
    if (edits.some((edit) => source.slice(edit.start, edit.end) !== 'SearchableSelect')) throw new Error(`Baseline positions changed; refusing to rewrite ${file}. Use --verify after implementation.`);
    for (const edit of edits) source = source.slice(0, edit.start) + 'StandardDropdown' + source.slice(edit.end);
    const shared = path.relative(path.dirname(absolute), path.join(root, 'frontend/src/components/ui/StandardDropdown')).replaceAll('\\', '/');
    source = `import StandardDropdown from '${shared.startsWith('.') ? shared : './' + shared}';\n` + source;
    if (!source.includes('<SearchableSelect')) source = source.replace(/^import SearchableSelect from [^\n]+\n/m, '');
    fs.writeFileSync(absolute, source);
  }
  console.log(`Converted ${[...files.values()].flat().length} fields across ${files.size} files.`);
} else {
  fs.writeFileSync(target, JSON.stringify(records, null, 2) + '\n');
  const cell = (v) => String(v).replaceAll('|', '\\|').replaceAll('\n', ' ');
  fs.writeFileSync(path.join(root, 'docs/SELECT_UX_INVENTORY.md'), '# Select UX inventory before refactor\n\nCounts represent source field templates, not repeated rows. Four hidden compatibility selectors are listed separately. Six Location/General templates are explicitly unchanged. Expected counts are planning ranges, not measurements of customer SAP master data. Shared UI implementations are excluded from field counts.\n\n| Page / file:line | Field/state | Data source | Expected choices | Current | Appropriate type | Reason |\n|---|---|---|---|---|---|---|\n' + records.map((r) => [r.file + ':' + r.line, r.field, r.source, r.expected, r.current + (r.multiple ? ' (multi)' : ''), r.decision, r.rationale].map(cell).join(' | ')).map((r) => '| ' + r + ' |').join('\n') + '\n');
  console.log(JSON.stringify({ total: records.length, files: new Set(records.map((r) => r.file)).size, counts: records.reduce((a, r) => ({ ...a, [r.decision]: (a[r.decision] || 0) + 1 }), {}) }));
}
