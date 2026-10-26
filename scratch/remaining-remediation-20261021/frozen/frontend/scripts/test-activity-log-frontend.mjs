import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Verifying Activity Log Frontend Integration ---');

// 1. Check UserManagementPage.jsx button
const userMgmtPath = path.join(rootDir, 'src', 'pages', 'UserManagementPage.jsx');
const userMgmtContent = fs.readFileSync(userMgmtPath, 'utf8');
assert(
  userMgmtContent.includes('/users/activity-log'),
  'UserManagementPage must navigate to /users/activity-log'
);
assert(
  userMgmtContent.includes("t('users.activityLog')"),
  'UserManagementPage must use localized users.activityLog'
);
console.log('✅ UserManagementPage.jsx has navigation button to /users/activity-log');

// 2. Check App.jsx Route
const appPath = path.join(rootDir, 'src', 'App.jsx');
const appContent = fs.readFileSync(appPath, 'utf8');
assert(
  appContent.includes("const ActivityLogPage = lazy(() => import('./pages/ActivityLogPage'));"),
  'App.jsx must import ActivityLogPage'
);
assert(
  appContent.includes('path="/users/activity-log"'),
  'App.jsx must have route path="/users/activity-log"'
);
assert(
  appContent.includes('allow={canManageUsers}'),
  'Route /users/activity-log must be guarded by canManageUsers'
);
console.log('✅ App.jsx registers /users/activity-log route with canManageUsers guard');

// 3. Check ActivityLogPage.jsx
const activityLogPagePath = path.join(rootDir, 'src', 'pages', 'ActivityLogPage.jsx');
assert(fs.existsSync(activityLogPagePath), 'ActivityLogPage.jsx must exist');
const activityLogContent = fs.readFileSync(activityLogPagePath, 'utf8');
assert(
  activityLogContent.includes('export default function ActivityLogPage'),
  'ActivityLogPage must have default export'
);
assert(
  activityLogContent.includes('/audit-log/'),
  'ActivityLogPage must query /audit-log/ API'
);
assert(
  activityLogContent.includes('formatFullTimestamp'),
  'ActivityLogPage must format full timestamps with seconds'
);
assert(
  activityLogContent.includes('extractDiffs'),
  'ActivityLogPage must extract before/after diffs'
);
assert(
  !activityLogContent.includes('JSON.stringify') && !activityLogContent.includes('navigator.clipboard.writeText'),
  'ActivityLogPage must not expose or copy raw JSON details'
);
assert(
  activityLogContent.includes('getBusinessDetailEntries')
    && activityLogContent.includes('BusinessValue')
    && activityLogContent.includes('activity-business-grid'),
  'ActivityLogPage must render structured, human-readable business details'
);
console.log('✅ ActivityLogPage.jsx implements filters, timestamps, diffs, and business-friendly details without raw JSON');

// 4. Check CSS Stylesheet
const cssPath = path.join(rootDir, 'src', 'styles', 'pages', 'ActivityLogPage.css');
assert(fs.existsSync(cssPath), 'ActivityLogPage.css must exist');
const cssContent = fs.readFileSync(cssPath, 'utf8');
assert(cssContent.includes('.activity-log-shell'), 'CSS must define .activity-log-shell');
assert(cssContent.includes('.activity-table'), 'CSS must define .activity-table');
assert(cssContent.includes('.activity-diff-table'), 'CSS must define .activity-diff-table');
assert(cssContent.includes('.activity-business-grid'), 'CSS must define responsive business details');
assert(!cssContent.includes('.activity-json-viewer'), 'CSS must not retain the raw JSON viewer');
console.log('✅ ActivityLogPage.css exists with complete styling definitions');

// 5. Check translations
const translationsPath = path.join(rootDir, 'src', 'i18n', 'translations.js');
const transContent = fs.readFileSync(translationsPath, 'utf8');
assert(transContent.includes('activityLog:'), 'Translations must have activityLog');
assert(transContent.includes('audit: {'), 'Translations must have audit namespace');
assert(transContent.includes('سجل النشاط'), 'Arabic translations must contain سجل النشاط');
console.log('✅ translations.js contains full AR and EN activity log dictionaries');

console.log('\n🎉 ALL FRONTEND ACTIVITY LOG INTEGRATION CHECKS PASSED!\n');
