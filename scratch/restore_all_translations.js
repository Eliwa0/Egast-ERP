const fs = require('fs');
const path = require('path');

const workspace = 'c:/Users/hp/Desktop/receipt_from_production';
const originalPath = path.join(workspace, 'backups_original/translations.js');
const activePath = path.join(workspace, 'frontend/src/i18n/translations.js');

// Helper to load translation files by creating a temp commonjs file
function loadTranslations(filePath, tempName) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/\r\n/g, '\n');
  content = content.replace('export const translations =', 'const translations =');
  content += '\nmodule.exports = { translations };\n';
  
  const tempPath = path.join(__dirname, tempName);
  fs.writeFileSync(tempPath, content, 'utf8');
  const { translations } = require(tempPath);
  fs.unlinkSync(tempPath);
  
  // Clear require cache for this temp file to prevent duplicate require bugs
  delete require.cache[require.resolve(tempPath)];
  
  return translations;
}

const original = loadTranslations(originalPath, 'temp_orig_load.js');
const active = loadTranslations(activePath, 'temp_active_load.js');

// 1. Restore blocks: rulesHub, transfer, transferReview, transferRules
const restoreNamespaces = ['rulesHub', 'transfer', 'transferReview', 'transferRules'];

restoreNamespaces.forEach(ns => {
  active.en[ns] = original.en[ns];
  active.ar[ns] = original.ar[ns];
});

// 2. Update home namespace keys
const enHomeUpdate = {
  transfer: 'Transfer',
  transferDesc: 'Manage warehouse transfers using batch scanning.',
  description: 'Choose the module available for your role. The current workflow and permission checks stay unchanged.'
};

const arHomeUpdate = {
  transfer: 'التحويل',
  transferDesc: 'إدارة تحويلات المخازن باستخدام مسح الباتشات.',
  description: 'اختر الوحدة المتاحة حسب دورك. يظل مسار العمل الحالي وفحوصات الصلاحيات كما هي.'
};

Object.assign(active.en.home, enHomeUpdate);
Object.assign(active.ar.home, arHomeUpdate);

// 3. Add missing common, toolbar, and quality keys
// English additions
Object.assign(active.en.common, {
  confirm: 'Confirm',
  dismissNotification: 'Dismiss notification',
  info: 'Info',
  selectOption: 'Select an option',
  success: 'Success',
  warning: 'Warning',
  working: 'Working...'
});

Object.assign(active.en.toolbar, {
  switchToArabic: 'Switch to Arabic',
  switchToEnglish: 'Switch to English'
});

Object.assign(active.en.quality, {
  statusAll: 'All',
  statusRejected: 'Rejected'
});

// Arabic additions
Object.assign(active.ar.common, {
  confirm: 'تأكيد',
  dismissNotification: 'تجاهل التنبيه',
  info: 'معلومة',
  selectOption: 'اختر أحد الخيارات',
  success: 'نجاح',
  warning: 'تحذير',
  working: 'جاري العمل...'
});

Object.assign(active.ar.toolbar, {
  switchToArabic: 'تحويل إلى العربية',
  switchToEnglish: 'تحويل إلى الإنجليزية'
});

Object.assign(active.ar.quality, {
  statusAll: 'الكل',
  statusRejected: 'مرفوض'
});

// 4. Remove obsolete keys
const obsoleteCommon = ['duplicate', 'edit', 'refresh', 'review', 'rules', 'users', 'signOut'];
const obsoleteQuality = [
  'approved', 'colDefects', 'colItem', 'comments', 'deleteSuccess',
  'draftAutoSaved', 'exportJson', 'fail', 'notes', 'pass', 'postToSap',
  'posting', 'rejected', 'savedDraft', 'start'
];

obsoleteCommon.forEach(k => {
  delete active.en.common[k];
  delete active.ar.common[k];
});

obsoleteQuality.forEach(k => {
  delete active.en.quality[k];
  delete active.ar.quality[k];
});

// 5. Serialize the translations object
function serialize(val, indent = 2) {
  const spaces = ' '.repeat(indent);
  if (typeof val === 'string') {
    return "'" + val.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  }
  if (typeof val === 'function') {
    return val.toString();
  }
  if (Array.isArray(val)) {
    return `[\n${val.map(v => ' '.repeat(indent + 2) + serialize(v, indent + 2)).join(',\n')}\n${spaces}]`;
  }
  if (typeof val === 'object' && val !== null) {
    const keys = Object.keys(val);
    const lines = keys.map(k => {
      const keyStr = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : `'${k}'`;
      return `${' '.repeat(indent + 2)}${keyStr}: ${serialize(val[k], indent + 2)}`;
    });
    return `{\n${lines.join(',\n')}\n${spaces}}`;
  }
  return String(val);
}

const serializedContent = `export const translations = ${serialize(active, 0)};\n`;

fs.writeFileSync(activePath, serializedContent, 'utf8');
console.log('translations.js restored and formatted successfully!');
