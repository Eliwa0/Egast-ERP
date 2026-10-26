const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const originalPath = path.join(workspace, 'backups_original/translations.js');
const activePath = path.join(workspace, 'frontend/src/i18n/translations.js');

function getNamespaces(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace('export const translations =', 'const translations =');
  content += '\nmodule.exports = { translations };\n';
  
  const tempPath = path.join(__dirname, 'temp_compare.js');
  fs.writeFileSync(tempPath, content, 'utf8');
  const { translations } = require(tempPath);
  fs.unlinkSync(tempPath);
  
  return {
    en: Object.keys(translations.en),
    ar: Object.keys(translations.ar)
  };
}

const orig = getNamespaces(originalPath);
const active = getNamespaces(activePath);

console.log('Original namespaces EN:', orig.en);
console.log('Active namespaces EN:', active.en);

console.log('\nOriginal namespaces AR:', orig.ar);
console.log('Active namespaces AR:', active.ar);
