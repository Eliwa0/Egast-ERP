const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const trPath = path.join(workspace, 'frontend/src/i18n/translations.js');
let content = fs.readFileSync(trPath, 'utf8');

// Replace export const translations with global/module export
content = content.replace('export const translations =', 'const translations =');
content += '\nmodule.exports = { translations };\n';

const tempPath = path.join(__dirname, 'temp_translations.js');
fs.writeFileSync(tempPath, content, 'utf8');

const { translations } = require(tempPath);
fs.unlinkSync(tempPath);

const wizardPath = path.join(workspace, 'frontend/src/pages/QualityWizard.jsx');
const reviewPath = path.join(workspace, 'frontend/src/pages/QualityReviewPage.jsx');
const matrixPath = path.join(workspace, 'frontend/src/components/ExcelSummaryMatrix.jsx');

const wizardContent = fs.readFileSync(wizardPath, 'utf8');
const reviewContent = fs.readFileSync(reviewPath, 'utf8');
const matrixContent = fs.readFileSync(matrixPath, 'utf8');

// Capture t('...') and tx('...')
const regex = /(?:t|tx)\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
const keys = new Set();
let match;

while ((match = regex.exec(wizardContent)) !== null) {
  keys.add(match[1]);
}
while ((match = regex.exec(reviewContent)) !== null) {
  keys.add(match[1]);
}
while ((match = regex.exec(matrixContent)) !== null) {
  keys.add(match[1]);
}

// Also check any static arrays or dynamic usages of t(...) in strings if any
console.log('Audited ' + keys.size + ' translation keys.');

const missingEn = [];
const missingAr = [];

for (const fullPath of keys) {
  const parts = fullPath.split('.');
  
  // Check EN
  let nodeEn = translations.en;
  for (const k of parts) {
    if (nodeEn) nodeEn = nodeEn[k];
  }
  if (!nodeEn) missingEn.push(fullPath);

  // Check AR
  let nodeAr = translations.ar;
  for (const k of parts) {
    if (nodeAr) nodeAr = nodeAr[k];
  }
  if (!nodeAr) missingAr.push(fullPath);
}

console.log('--- MISSING IN ENGLISH ---');
missingEn.sort().forEach(k => console.log(k));

console.log('\n--- MISSING IN ARABIC ---');
missingAr.sort().forEach(k => console.log(k));
