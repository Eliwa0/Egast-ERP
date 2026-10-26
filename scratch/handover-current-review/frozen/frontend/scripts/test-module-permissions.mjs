import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  canAccessGrpo,
  canAccessProduction,
  canAccessPurchaseQuotation,
  canAccessTransfer,
} from '../src/utils/roles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const roles = read('src/utils/roles.js');
const home = read('src/pages/Home.jsx');
const app = read('src/App.jsx');
const users = read('src/pages/UserManagementPage.jsx');
const productionRules = read('src/pages/ProductionOrderRulesPage.jsx');
const transferRules = read('src/pages/TransferRulesPage.jsx');

for (const moduleKey of ['production', 'transfer', 'quality', 'grpo', 'purchase_quotation', 'scale']) {
  assert(roles.includes(`'${moduleKey}'`), `Missing canonical frontend module ${moduleKey}`);
}
assert(roles.includes('user?.module_permissions'), 'Frontend must consume backend module_permissions');
assert(roles.includes('canAccessModule') && roles.includes('canManageModule'), 'Generic permission helpers are required');
assert(roles.includes('if (isAdmin(user)) return true;'), 'Super Admin must bypass module assignments on the frontend');
assert(roles.includes('return canAccessProduction(user);'), 'Production USER must be allowed to open Production Review');
assert(home.includes('canAccessPurchaseQuotation') && home.includes('canAccessGrpo'), 'Home must independently gate GRPO and Purchase Quotation');
assert(home.includes('visible: canAccessProduction(user)') && home.includes('visible: canAccessTransfer(user)'), 'Home must independently gate Production and Transfer');
assert(app.includes('allow={canAccessPurchaseQuotation}') && app.includes('allow={canAccessGrpo}'), 'Routes must independently gate GRPO and Purchase Quotation');
assert(app.includes('allow={canAccessProduction}') && app.includes('allow={canAccessTransfer}'), 'Routes must independently gate Production and Transfer');
assert(users.includes('/admin/module-permissions/modules/'), 'Permissions UI must discover modules from backend');
assert(users.includes('/module-permissions/'), 'Permissions UI must persist assignments through protected API');
assert(users.includes('No Access') && users.includes('USER') && users.includes('ADMIN'), 'Permissions UI must offer all three levels');
assert(users.includes('multiple') && users.includes('moduleRoleOptions'), 'Role selector must support multiple module roles');
assert(users.includes('`${moduleName} User`') && users.includes('`${moduleName} Admin`'), 'Role options must be generated from backend module definitions');
assert(!users.includes('Module Permissions'), 'Create/Edit UI must not render a separate Module Permissions section');
assert(users.includes("['global:admin']") && users.includes("label: 'Super Admin'"), 'Super Admin must be represented as one global role');
assert(!users.includes('colWarehouse') && !users.includes("users.warehouse"), 'User Management must not expose warehouse fields or columns');
assert(productionRules.includes("...userSearch, params: { module: 'production', level: 'USER' }"), 'Production User Rules must search only Production USER accounts');
assert(transferRules.includes("...userSearch, params: { module: 'transfer', level: 'USER' }"), 'Transfer User Rules must search only Transfer USER accounts');

const explicitUser = (module_permissions, role = 'production_user') => ({ role, module_permissions });
const transferOnly = explicitUser({ transfer: 'USER' });
assert(canAccessTransfer(transferOnly), 'Transfer-only user must see Transfer');
assert(!canAccessProduction(transferOnly), 'Transfer-only user must not see Production, even with a legacy Production role');

const productionOnly = explicitUser({ production: 'USER' }, 'transfer_user');
assert(canAccessProduction(productionOnly), 'Production-only user must see Production');
assert(!canAccessTransfer(productionOnly), 'Production-only user must not see Transfer, even with a legacy Transfer role');

const both = explicitUser({ production: 'ADMIN', transfer: 'ADMIN' });
assert(canAccessProduction(both) && canAccessTransfer(both), 'Multi-module user must see both assigned modules');

const grpoOnly = explicitUser({ grpo: 'USER' });
assert(canAccessGrpo(grpoOnly) && !canAccessProduction(grpoOnly) && !canAccessTransfer(grpoOnly), 'GRPO-only access must remain isolated');

const quotationOnly = explicitUser({ purchase_quotation: 'USER' });
assert(canAccessPurchaseQuotation(quotationOnly) && !canAccessProduction(quotationOnly) && !canAccessTransfer(quotationOnly), 'Purchase Quotation-only access must remain isolated');

const noModules = explicitUser({});
assert(!canAccessProduction(noModules) && !canAccessTransfer(noModules) && !canAccessGrpo(noModules), 'Explicit no-access user must not receive legacy fallback access');

const superAdmin = { role: 'admin', module_permissions: {} };
assert(canAccessProduction(superAdmin) && canAccessTransfer(superAdmin) && canAccessGrpo(superAdmin) && canAccessPurchaseQuotation(superAdmin), 'Super Admin must retain unrestricted access');

console.log('Module permission frontend integration checks passed.');
