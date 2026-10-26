export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'administrator' || value === 'super_admin') return 'admin';
  if (value === 'production_admin' || value === 'prod_admin') return 'production_admin';
  if (value === 'transfer_admin' || value === 'trans_admin') return 'transfer_admin';
  if (value === 'transfer' || value === 'transfer_user') return 'transfer_user';
  if (value === 'quality_admin' || value === 'qa_admin') return 'quality_admin';
  if (value === 'quality' || value === 'quality_user') return 'quality_user';
  if (value === 'scale_admin') return 'scale_admin';
  if (value === 'scale' || value === 'scale_operator' || value === 'scale_user') return 'scale_operator';
  if (value === 'production' || value === 'production_user' || value === 'user') return 'production_user';
  return 'production_user';
}

export function isAdmin(user) {
  if (user?.is_superuser === true) return true;
  return normalizeRole(user?.role) === 'admin';
}

export function isProductionAdmin(user) {
  return normalizeRole(user?.role) === 'production_admin';
}

export function isTransferAdmin(user) {
  return normalizeRole(user?.role) === 'transfer_admin';
}

export function isQualityAdmin(user) {
  return normalizeRole(user?.role) === 'quality_admin';
}

export function isScaleAdmin(user) {
  return normalizeRole(user?.role) === 'scale_admin';
}

export function isScaleOperator(user) {
  return normalizeRole(user?.role) === 'scale_operator';
}

export const MODULES = Object.freeze({
  PRODUCTION: 'production',
  TRANSFER: 'transfer',
  QUALITY: 'quality',
  GRPO: 'grpo',
  PURCHASE_QUOTATION: 'purchase_quotation',
  SCALE: 'scale',
  CUSTOMIZATION: 'customization',
  DELIVERY: 'delivery',
});

function legacyModulePermissions(user) {
  const role = normalizeRole(user?.role);
  const admin = 'ADMIN';
  const regular = 'USER';
  if (role === 'admin') return Object.fromEntries(Object.values(MODULES).map((key) => [key, admin]));
  if (role === 'production_admin') return { [MODULES.PRODUCTION]: admin };
  if (role === 'production_user') return { [MODULES.PRODUCTION]: regular };
  if (role === 'transfer_admin') return { [MODULES.TRANSFER]: admin };
  if (role === 'transfer_user') return { [MODULES.TRANSFER]: regular };
  if (role === 'quality_admin') return { [MODULES.QUALITY]: admin, [MODULES.GRPO]: admin, [MODULES.PURCHASE_QUOTATION]: admin };
  if (role === 'quality_user') return { [MODULES.QUALITY]: regular, [MODULES.GRPO]: admin, [MODULES.PURCHASE_QUOTATION]: admin };
  if (role === 'scale_admin') return { [MODULES.SCALE]: admin };
  if (role === 'scale_operator') return { [MODULES.SCALE]: regular };
  return {};
}

export function getModulePermissions(user) {
  const permissions = user?.module_permissions;
  return Object.prototype.hasOwnProperty.call(user || {}, 'module_permissions') && permissions && typeof permissions === 'object'
    ? permissions
    : legacyModulePermissions(user);
}

export function canAccessModule(user, module) {
  if (isAdmin(user)) return true;
  const level = getModulePermissions(user)[module];
  return level === 'USER' || level === 'ADMIN';
}

export function canManageModule(user, module) {
  if (isAdmin(user)) return true;
  return getModulePermissions(user)[module] === 'ADMIN';
}

export function canManageProduction(user) {
  return canManageModule(user, MODULES.PRODUCTION);
}

export function canManageTransfer(user) {
  return canManageModule(user, MODULES.TRANSFER);
}

export function canManageQuality(user) {
  return canManageModule(user, MODULES.QUALITY);
}

export function canManageScale(user) {
  return canManageModule(user, MODULES.SCALE);
}

export function canManageUsers(user) {
  return isAdmin(user) || isProductionAdmin(user) || isTransferAdmin(user);
}

export function canAccessProduction(user) {
  return canAccessModule(user, MODULES.PRODUCTION);
}

export function canAccessTransfer(user) {
  return canAccessModule(user, MODULES.TRANSFER);
}

export function canAccessQuality(user) {
  return canAccessModule(user, MODULES.QUALITY);
}

export function canAccessGrpo(user) {
  return canAccessModule(user, MODULES.GRPO);
}

export function canManageGrpo(user) {
  return canManageModule(user, MODULES.GRPO);
}

export function canAccessPurchaseQuotation(user) {
  return canAccessModule(user, MODULES.PURCHASE_QUOTATION);
}

export function canManagePurchaseQuotation(user) {
  return canManageModule(user, MODULES.PURCHASE_QUOTATION);
}

export function canAccessScale(user) {
  return canAccessModule(user, MODULES.SCALE);
}

export function canAccessCustomization(user) {
  return canAccessModule(user, MODULES.CUSTOMIZATION);
}

export function canManageCustomization(user) {
  return canManageModule(user, MODULES.CUSTOMIZATION);
}

export function canAccessDelivery(user) {
  return canAccessModule(user, MODULES.DELIVERY);
}

export function canManageDelivery(user) {
  return canManageModule(user, MODULES.DELIVERY);
}

export function canAccessCustomizationOrDelivery(user) {
  return canAccessCustomization(user) || canAccessDelivery(user);
}

export function canAccessReceiptReview(user) {
  return canAccessProduction(user);
}

export function canAccessIssueReview(user) {
  return canManageProduction(user);
}

export function canAccessTransferReview(user) {
  return canManageTransfer(user);
}

export function canAccessQualityReview(user) {
  return canManageQuality(user);
}

export function canAccessProductionRules(user) {
  return canManageProduction(user);
}

export function canAccessTransferRules(user) {
  return canManageTransfer(user);
}

export function isProductionUserRole(role) {
  return normalizeRole(role) === 'production_user';
}

export function getRoleOptionsForUser(user) {
  if (isAdmin(user)) {
    return [
      { value: 'production_user', label: 'Production User' },
      { value: 'transfer_user', label: 'Transfer User' },
      { value: 'quality_user', label: 'Quality User' },
      { value: 'scale_operator', label: 'Scale Operator' },
      { value: 'production_admin', label: 'Production Admin' },
      { value: 'transfer_admin', label: 'Transfer Admin' },
      { value: 'quality_admin', label: 'Quality Admin' },
      { value: 'scale_admin', label: 'Scale Admin' },
      { value: 'admin', label: 'Super Admin' },
    ];
  }
  if (isProductionAdmin(user)) {
    return [{ value: 'production_user', label: 'Production User' }];
  }
  if (isTransferAdmin(user)) {
    return [{ value: 'transfer_user', label: 'Transfer User' }];
  }
  return [];
}

export function defaultCreatableRole(user) {
  return getRoleOptionsForUser(user)[0]?.value || 'production_user';
}

export function roleLabel(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'admin') return 'Super Admin';
  if (normalized === 'production_admin') return 'Production Admin';
  if (normalized === 'transfer_admin') return 'Transfer Admin';
  if (normalized === 'quality_admin') return 'Quality Admin';
  if (normalized === 'scale_admin') return 'Scale Admin';
  if (normalized === 'transfer_user') return 'Transfer User';
  if (normalized === 'quality_user') return 'Quality User';
  if (normalized === 'scale_operator') return 'Scale Operator';
  return 'Production User';
}
