const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const activePath = path.join(workspace, 'frontend/src/i18n/translations.js');

let content = fs.readFileSync(activePath, 'utf8');
content = content.replace('export const translations =', 'const translations =');
content += '\nmodule.exports = { translations };\n';

const tempPath = path.join(__dirname, 'temp_view.js');
fs.writeFileSync(tempPath, content, 'utf8');
const { translations } = require(tempPath);
fs.unlinkSync(tempPath);

console.log('AR transfer keys count:', Object.keys(translations.ar.transfer || {}).length);
console.log('AR transferReview keys count:', Object.keys(translations.ar.transferReview || {}).length);
console.log('AR transferRules keys count:', Object.keys(translations.ar.transferRules || {}).length);

console.log('AR transfer keys:', Object.keys(translations.ar.transfer || {}));
