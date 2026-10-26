const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const srcDir = path.join(workspace, 'frontend/src');
const translationsPath = path.join(workspace, 'frontend/src/i18n/translations.js');

// Load translations
let trContent = fs.readFileSync(translationsPath, 'utf8');
trContent = trContent.replace('export const translations =', 'const translations =');
trContent += '\nmodule.exports = { translations };\n';
const tempPath = path.join(__dirname, 'temp_translations_audit.js');
fs.writeFileSync(tempPath, trContent, 'utf8');
const { translations } = require(tempPath);
fs.unlinkSync(tempPath);

// Recursively find files
function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getFiles(filePath, fileList);
    } else if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.html')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const allFiles = getFiles(srcDir);
const usedKeys = new Set();

// Regular expression to match any string starting with known namespaces
const keyRegex = /(['"])(common|nav|toolbar|login|home|production|createUser|users|wizard|review|rules|quality|transfer|transferReview|transferRules)\.([a-zA-Z0-9_.-]+)\1/g;

allFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = keyRegex.exec(content)) !== null) {
    const fullKey = match[2] + '.' + match[3];
    // Ignore keys ending with dot (e.g. from dynamic concatenation quality.defects.)
    if (!fullKey.endsWith('.')) {
      usedKeys.add(fullKey);
    }
  }
});

// Also manually add some prefix-based dynamic keys used in the code
const defectKeys = [
  'acarus', 'scale_insect', 'spray_marks', 'citrus_rust', 'thrips',
  'vegetable_defects', 'gummosis', 'oil_spots', 'sunburn', 'sooty_mold',
  'mealybug', 'tearing', 'high_cut', 'bruises', 'cuts', 'under_size',
  'venting', 'fruit_fly', 'creasing', 'fall_drop', 'mutations',
  'navel_blight', 'softness', 'molds', 'grade_1', 'grade_2'
];
defectKeys.forEach(dk => {
  usedKeys.add('quality.defects.' + dk);
});

const decisionKeys = [
  'Accepted', 'Conditionally Accepted',
  'Rejected (Tolerable Boundary Exceeded)', 'Rejected (Quarantine Defects)'
];
decisionKeys.forEach(dk => {
  usedKeys.add('quality.decisions.' + dk);
});

console.log(`Found ${usedKeys.size} unique keys referenced in source files.`);

// Audit missing keys
const missingEn = [];
const missingAr = [];

usedKeys.forEach(fullPath => {
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
});

console.log('\n--- MISSING IN ENGLISH ---');
missingEn.sort().forEach(k => console.log(k));

console.log('\n--- MISSING IN ARABIC ---');
missingAr.sort().forEach(k => console.log(k));

// Audit obsolete keys in common and quality sections
function getFlatKeys(obj, prefix = '') {
  let keys = [];
  for (const k in obj) {
    const fullKey = prefix ? prefix + '.' + k : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k]) && typeof obj[k] !== 'function') {
      keys = keys.concat(getFlatKeys(obj[k], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const definedKeysEn = getFlatKeys(translations.en);

const obsoleteEn = definedKeysEn.filter(dk => {
  // Only look at quality, common, transfer, transferReview, transferRules
  if (!dk.startsWith('quality.') && !dk.startsWith('common.') && !dk.startsWith('transfer.') && !dk.startsWith('transferReview.') && !dk.startsWith('transferRules.')) {
    return false;
  }
  
  // Ignore dynamic prefix keys
  if (dk.startsWith('quality.defects.') || dk.startsWith('quality.decisions.')) return false;
  
  // Ignore functions since they are dynamic
  const parts = dk.split('.');
  let node = translations.en;
  for (const p of parts) {
    if (node) node = node[p];
  }
  if (typeof node === 'function') return false;

  return !usedKeys.has(dk);
});

console.log('\n--- POTENTIALLY OBSOLETE KEYS IN ENGLISH (common/quality/transfer/transferReview/transferRules) ---');
obsoleteEn.sort().forEach(k => console.log(k));
