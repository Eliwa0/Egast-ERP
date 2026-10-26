const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const trPath = path.join(workspace, 'frontend/src/i18n/translations.js');
let content = fs.readFileSync(trPath, 'utf8');

content = content.replace('export const translations =', 'const translations =');
content += '\nmodule.exports = { translations };\n';

const tempPath = path.join(__dirname, 'temp_test.js');
fs.writeFileSync(tempPath, content, 'utf8');

const { translations } = require(tempPath);
fs.unlinkSync(tempPath);

function testTranslate(lang, path) {
  const keys = path.split('.');
  let node = translations[lang];
  for (const k of keys) {
    if (node == null) return path;
    node = node[k];
  }
  if (typeof node === 'string') return node;
  return path;
}

const keysToTest = [
  'nav.qualityWizard',
  'quality.defects.fall_drop',
  'quality.defects.mutations',
  'quality.defects.navel_blight',
  'quality.quarantineViolationDesc'
];

console.log('--- TEST ENGLISH ---');
keysToTest.forEach(k => {
  console.log(`${k} => ${testTranslate('en', k)}`);
});

console.log('\n--- TEST ARABIC ---');
keysToTest.forEach(k => {
  console.log(`${k} => ${testTranslate('ar', k)}`);
});
