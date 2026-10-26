const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const wizardPath = path.join(workspace, 'frontend/src/pages/QualityWizard.jsx');
const reviewPath = path.join(workspace, 'frontend/src/pages/QualityReviewPage.jsx');
const matrixPath = path.join(workspace, 'frontend/src/components/ExcelSummaryMatrix.jsx');

const files = [wizardPath, reviewPath, matrixPath];
const results = {};

files.forEach(filePath => {
  const content = fs.readFileSync(filePath, 'utf8');
  // Match tx('key', 'fallback') or tx("key", "fallback")
  const regex = /tx\(\s*['"]([a-zA-Z0-9_.-]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    results[match[1]] = match[2];
  }
  
  // Also match t('key') to see if there is any other call
  const tRegex = /t\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
  while ((match = tRegex.exec(content)) !== null) {
    if (!results[match[1]]) {
      results[match[1]] = null; // No fallback
    }
  }
});

console.log(JSON.stringify(results, null, 2));
