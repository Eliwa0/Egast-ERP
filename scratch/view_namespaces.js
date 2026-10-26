const fs = require('fs');
const path = require('path');

const trPath = 'c:/Users/hp/Desktop/receipt_from_production/frontend/src/i18n/translations.js';
let content = fs.readFileSync(trPath, 'utf8');

content = content.replace('export const translations =', 'const translations =');
content += '\nmodule.exports = { translations };\n';

// Use a unique name for the required module to bypass cache
const tempName = `temp_${Date.now()}_view.js`;
const tempPath = path.join(__dirname, tempName);
fs.writeFileSync(tempPath, content, 'utf8');

const { translations } = require(tempPath);
fs.unlinkSync(tempPath);

console.log('Active EN keys:', Object.keys(translations.en));
console.log('Active AR keys:', Object.keys(translations.ar));
