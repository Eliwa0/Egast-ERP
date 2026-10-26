export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'administrator') return 'admin';
  if (value === 'super_admin') return 'super_admin';
  if (value === 'production_admin' || value === 'prod_admin') return 'production_admin';
  if (value === 'transfer_admin' || value === 'trans_admin') return 'transfer_admin';
  if (value === 'transfer' || value === 'transfer_user') return 'transfer_user';
  return 'production_user';
}

export function isAdmin(user) {
  return ['admin', 'super_admin'].includes(normalizeRole(user?.role));
}

export function isProductionAdmin(user) {
  return normalizeRole(user?.role) === 'production_admin';
}

export function isTransferAdmin(user) {
  return normalizeRole(user?.role) === 'transfer_admin';
}

export function canManageProduction(user) {
  return isAdmin(user) || isProductionAdmin(user);
}

export function canManageTransfer(user) {
  return isAdmin(user) || isTransferAdmin(user);
}

export function canManageUsers(user) {
  return isAdmin(user) || isProductionAdmin(user) || isTransferAdmin(user);
}

export function canAccessProduction(user) {
  const role = normalizeRole(user?.role);
  return canManageProduction(user) || role === 'production_user';
}

export function canAccessTransfer(user) {
  const role = normalizeRole(user?.role);
  return canManageTransfer(user) || role === 'transfer_user';
}

export function canAccessReceiptReview(user) {
  return canManageProduction(user);
}

export function canAccessTransferReview(user) {
  return canManageTransfer(user);
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
      { value: 'production_admin', label: 'Production Admin' },
      { value: 'transfer_admin', label: 'Transfer Admin' },
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
  if (normalized === 'admin' || normalized === 'super_admin') return 'Super Admin';
  if (normalized === 'production_admin') return 'Production Admin';
  if (normalized === 'transfer_admin') return 'Transfer Admin';
  if (normalized === 'transfer_user') return 'Transfer User';
  return 'Production User';
}
