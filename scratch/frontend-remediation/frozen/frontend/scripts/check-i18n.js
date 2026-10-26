import fs from 'fs';
import process from 'node:process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');
const translationsFile = path.resolve(srcDir, 'i18n/translations.js');

// Known namespaces in the application
const KNOWN_NAMESPACES = [
  'common',
  'nav',
  'toolbar',
  'login',
  'home',
  'rulesHub',
  'transfer',
  'transferReview',
  'transferRules',
  'production',
  'createUser',
  'users',
  'wizard',
  'review',
  'rules',
  'scale',
  'inspectionStages',
  'qualityCategories',
  'qualityCriteria',
  'itemCriteria',
  'quality',
  'grpo',
  'shippingReceiving',
  'shippingDelivery',
  'issueWizard',
  'issueReview',
];

function getAllFiles(dir, exts = ['.jsx', '.js', '.tsx', '.ts']) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
        results = results.concat(getAllFiles(fullPath, exts));
      }
    } else if (exts.includes(path.extname(file))) {
      results.push(fullPath);
    }
  }
  return results;
}

const allFiles = getAllFiles(srcDir);

// 1. Extract translation keys from t(...) and tx(...) and inline string literals matching namespaces
const extractedKeys = new Map(); // key -> Set of file paths

// Match t('...'), t("..."), tx('...'), tx("...")
const tCallRegex = /(?:(?:\bt|\btx|\btranslate|\bi18n)\s*\(\s*['"]([a-zA-Z0-9_.-]+)['"])/g;

// Match any string literal starting with known namespace (e.g. 'quality.stepTrucks', 'scale.device')
const nsLiteralRegex = new RegExp(`['"\`]((${KNOWN_NAMESPACES.join('|')})\\.[a-zA-Z0-9_.-]+)['"\`]`, 'g');

allFiles.forEach((filePath) => {
  // Skip translations.js itself when extracting calls
  if (filePath === translationsFile) return;

  const content = fs.readFileSync(filePath, 'utf8');

  // Match t calls
  let match;
  while ((match = tCallRegex.exec(content)) !== null) {
    const key = match[1];
    if (key.includes('.') && !key.endsWith('.')) {
      if (!extractedKeys.has(key)) extractedKeys.set(key, new Set());
      extractedKeys.get(key).add(path.relative(srcDir, filePath));
    }
  }

  // Match namespace literals
  while ((match = nsLiteralRegex.exec(content)) !== null) {
    const key = match[1];
    if (key.includes('.') && !key.endsWith('.')) {
      if (!extractedKeys.has(key)) extractedKeys.set(key, new Set());
      extractedKeys.get(key).add(path.relative(srcDir, filePath));
    }
  }
});

// Import translations
const { translations } = await import(pathToFileURL(translationsFile).href);

function resolveKey(lang, fullPath) {
  const parts = fullPath.split('.');
  let current = translations[lang];
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

const missingAr = [];
const missingEn = [];
const emptyAr = [];
const emptyEn = [];
const rawValueAr = [];
const rawValueEn = [];

const allUniqueKeys = Array.from(extractedKeys.keys()).sort();

for (const key of allUniqueKeys) {
  const arVal = resolveKey('ar', key);
  const enVal = resolveKey('en', key);

  // Check Arabic
  if (arVal === undefined) {
    missingAr.push({ key, files: Array.from(extractedKeys.get(key)) });
  } else if (arVal === '' || arVal === null) {
    emptyAr.push({ key, files: Array.from(extractedKeys.get(key)) });
  } else if (typeof arVal === 'string' && arVal.trim() === key) {
    rawValueAr.push({ key, files: Array.from(extractedKeys.get(key)) });
  }

  // Check English
  if (enVal === undefined) {
    missingEn.push({ key, files: Array.from(extractedKeys.get(key)) });
  } else if (enVal === '' || enVal === null) {
    emptyEn.push({ key, files: Array.from(extractedKeys.get(key)) });
  } else if (typeof enVal === 'string' && enVal.trim() === key) {
    rawValueEn.push({ key, files: Array.from(extractedKeys.get(key)) });
  }
}

console.log('====================================================');
console.log('          GLOBAL i18n VALIDATION REPORT            ');
console.log('====================================================');
console.log(`Scanned source files: ${allFiles.length}`);
console.log(`Total unique translation keys extracted: ${allUniqueKeys.length}`);

let hasErrors = false;

if (missingAr.length > 0) {
  hasErrors = true;
  console.log(`\n❌ Missing ARABIC (ar) Keys (${missingAr.length}):`);
  missingAr.forEach(({ key, files }) => {
    console.log(`  - ${key} (in: ${files.join(', ')})`);
  });
}

if (missingEn.length > 0) {
  hasErrors = true;
  console.log(`\n❌ Missing ENGLISH (en) Keys (${missingEn.length}):`);
  missingEn.forEach(({ key, files }) => {
    console.log(`  - ${key} (in: ${files.join(', ')})`);
  });
}

if (emptyAr.length > 0) {
  hasErrors = true;
  console.log(`\n❌ Empty ARABIC (ar) Keys (${emptyAr.length}):`);
  emptyAr.forEach(({ key, files }) => console.log(`  - ${key} (in: ${files.join(', ')})`));
}

if (emptyEn.length > 0) {
  hasErrors = true;
  console.log(`\n❌ Empty ENGLISH (en) Keys (${emptyEn.length}):`);
  emptyEn.forEach(({ key, files }) => console.log(`  - ${key} (in: ${files.join(', ')})`));
}

if (rawValueAr.length > 0) {
  hasErrors = true;
  console.log(`\n❌ Raw Key Echoed in ARABIC (ar) (${rawValueAr.length}):`);
  rawValueAr.forEach(({ key, files }) => console.log(`  - ${key} (in: ${files.join(', ')})`));
}

if (rawValueEn.length > 0) {
  hasErrors = true;
  console.log(`\n❌ Raw Key Echoed in ENGLISH (en) (${rawValueEn.length}):`);
  rawValueEn.forEach(({ key, files }) => console.log(`  - ${key} (in: ${files.join(', ')})`));
}

if (!hasErrors) {
  console.log('\n✅ 100% of extracted translation keys resolved cleanly in both Arabic and English!');
  console.log('====================================================\n');
  process.exit(0);
} else {
  console.log('\n❌ i18n validation failed with errors. Fix the reported keys.');
  console.log('====================================================\n');
  process.exit(1);
}
