const fs = require('fs');
const path = require('path');

const trPath = 'c:/Users/hp/Desktop/receipt_from_production/frontend/src/i18n/translations.js';
const lines = fs.readFileSync(trPath, 'utf8').split('\n');

lines.forEach((line, idx) => {
  if (line.includes('transfer')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
