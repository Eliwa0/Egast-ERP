import StandardDropdown from '../components/ui/StandardDropdown';
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Activity, CircleCheck, CircleOff, Power, ShieldCheck, Trash2, UserPlus, UsersRound,
} from 'lucide-react';
import API from '../services/api';
import AppSpinner from '../components/ui/AppSpinner';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import {
  canManageUsers,
  defaultCreatableRole,
  getRoleOptionsForUser,
  normalizeRole,
  roleLabel,
  isAdmin,
} from '../utils/roles';

// ── Badges ────────────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const normalized = normalizeRole(role);
  const isAdminRole = ['admin', 'super_admin', 'production_admin', 'transfer_admin'].includes(normalized);
  const label = roleLabel(role);
  return (
    <span className={`role-badge ${isAdminRole ? 'role-badge--admin' : 'role-badge--user'}`}>
      {label}
    </span>
  );
}

function UserRoles({ user }) {
  if (isAdmin(user)) return <RoleBadge role="admin" />;
  const permissions = Object.entries(user.module_permissions || {})
    .filter(([, level]) => level === 'USER' || level === 'ADMIN');
  if (!permissions.length) return <RoleBadge role={user.role} />;
  const labels = {
    production: 'Production', transfer: 'Transfer', quality: 'Quality', grpo: 'GRPO',
    purchase_quotation: 'Purchase Quotation', scale: 'Scale',
    customization: 'Customization', delivery: 'Delivery',
  };
  return (
    <div className="um-role-chips">
      {permissions.map(([module, level]) => (
        <span key={module} className={`um-role-chip um-role-chip--${level.toLowerCase()}`}>
          {labels[module] || module} {level === 'ADMIN' ? 'Admin' : 'User'}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ isActive }) {
  const { t } = useI18n();
  return (
    <span className={`account-badge ${isActive ? 'account-badge--active' : 'account-badge--inactive'}`}>
      {isActive ? t('users.statusActive') : t('users.statusDisabled')}
    </span>
  );
}

const permissionSelections = (permissions = {}) => Object.entries(permissions)
  .filter(([, level]) => level === 'USER' || level === 'ADMIN')
  .map(([module, level]) => `${module}:${level}`);

const selectionsToPermissions = (selections = [], modules = []) => Object.fromEntries(
  modules.map((module) => {
    const selected = selections.find((entry) => entry.startsWith(`${module.key}:`));
    return [module.key, selected ? selected.split(':')[1] : 'NONE'];
  }),
);

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, maxWidth = '480px' }) {
  return createPortal(
    <div
      className="simple-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="simple-modal-card" style={{ maxWidth }}>
        <div className="simple-modal__header">
          <h2 className="simple-modal__title">{title}</h2>
          <button type="button" className="simple-modal__close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function UserManagementPage() {
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { t } = useI18n();
  const roleOptions = getRoleOptionsForUser(me);
  const defaultRole = defaultCreatableRole(me);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: defaultRole, module_roles: [] });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editPw, setEditPw] = useState('');
  const [editPwConfirm, setEditPwConfirm] = useState('');
  const [editPwTouched, setEditPwTouched] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Inline toggle
  const [togglingId, setTogglingId] = useState(null);
  const [permissionModules, setPermissionModules] = useState([]);
  const [permissionTarget, setPermissionTarget] = useState(null);
  const [permissionForm, setPermissionForm] = useState({});
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionError, setPermissionError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setPageError('');
    try {
      const res = await API.get('/admin/users/');
      if (res.data.success) setUsers(res.data.data.users || []);
      else setPageError(res.data.error || t('common.noData'));
    } catch (err) {
      setPageError(err.response?.data?.error || t('common.noData'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!isAdmin(me)) return;
    API.get('/admin/module-permissions/modules/')
      .then((res) => setPermissionModules(res.data?.data?.modules || []))
      .catch(() => setPermissionModules([]));
  }, [me]);

  // Admin guard — after all hooks
  if (!canManageUsers(me)) {
    return (
      <div className="page-shell page-shell--center">
        <div className="feedback-message feedback-message--error">{t('common.accessDenied')}</div>
      </div>
    );
  }

  const isSelf = (u) => u.username === me.username;

  // ── Create user ─────────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setCreateLoading(true);
    try {
      const createPayload = { ...createForm };
      if (isAdmin(me)) {
        const createsSuperAdmin = createPayload.module_roles.includes('global:admin');
        createPayload.role = createsSuperAdmin ? 'admin' : createPayload.role;
        createPayload.module_permissions = createsSuperAdmin
          ? {}
          : selectionsToPermissions(createPayload.module_roles, permissionModules);
      }
      delete createPayload.module_roles;
      const res = await API.post('/create-user/', createPayload);
      if (res.data.success) {
        setCreateSuccess(t('users.created', createForm.username));
        setCreateForm({ username: '', password: '', role: defaultRole, module_roles: [] });
        loadUsers();
      } else {
        setCreateError(res.data.error || t('common.noData'));
      }
    } catch (err) {
      const d = err.response?.data;
      setCreateError(typeof d === 'object' && d?.error ? d.error : err.message || t('common.noData'));
    } finally {
      setCreateLoading(false);
    }
  };

  // ── Open edit modal ─────────────────────────────────────────────────────────
  const openEdit = (u) => {
    setEditTarget(u);
    setEditForm({
      username: u.username,
      role: u.role,
      is_active: u.is_active,
      module_roles: isAdmin(u) ? ['global:admin'] : permissionSelections(u.module_permissions),
    });
    setEditPw('');
    setEditPwConfirm('');
    setEditPwTouched(false);
    setEditError('');
    setEditSuccess('');
  };

  // ── Save edit ───────────────────────────────────────────────────────────────
  const handleEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSuccess('');

    if (editPw || editPwConfirm) {
      if (editPw && !editPwConfirm) {
        setEditError(t('users.confirmMustMatch'));
        return;
      }
      if (!editPw && editPwConfirm) {
        setEditError(t('users.enterPassword'));
        return;
      }
      if (editPw !== editPwConfirm) {
        setEditError(t('users.passwordMismatch'));
        return;
      }
      if (editPw.length < 4) {
        setEditError(t('users.passwordTooShort'));
        return;
      }
    }

    setEditLoading(true);
    try {
      const editPayload = { ...editForm };
      if (isAdmin(me) && !isSelf(editTarget)) {
        const makesSuperAdmin = editPayload.module_roles.includes('global:admin');
        editPayload.role = makesSuperAdmin ? 'admin' : editPayload.role;
        editPayload.module_permissions = makesSuperAdmin
          ? {}
          : selectionsToPermissions(editPayload.module_roles, permissionModules);
      }
      delete editPayload.module_roles;
      const patchRes = await API.patch(`/admin/users/${editTarget.id}/`, editPayload);
      if (!patchRes.data.success) {
        setEditError(patchRes.data.error || t('common.noData'));
        setEditLoading(false);
        return;
      }

      if (editPw) {
        const pwRes = await API.post(`/admin/users/${editTarget.id}/reset-password/`, { password: editPw });
        if (!pwRes.data.success) {
          setEditError(pwRes.data.error || t('common.noData'));
          setEditLoading(false);
          loadUsers();
          return;
        }
      }

      setEditSuccess(t('users.userUpdated'));
      setEditPw('');
      setEditPwConfirm('');
      setEditPwTouched(false);
      loadUsers();
    } catch (err) {
      const d = err.response?.data;
      setEditError(typeof d === 'object' && d?.error ? d.error : err.message || t('common.noData'));
    } finally {
      setEditLoading(false);
    }
  };

  // ── Toggle active ───────────────────────────────────────────────────────────
  const handleToggleActive = async (u) => {
    setTogglingId(u.id);
    try {
      const res = await API.post(`/admin/users/${u.id}/set-active/`, { is_active: !u.is_active });
      if (res.data.success) {
        setUsers((prev) => prev.map((x) => (x.id === u.id ? res.data.data : x)));
      }
    } catch (err) {
      console.error('Toggle active failed:', err.response?.data || err.message);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await API.delete(`/admin/users/${deleteTarget.id}/delete/`);
      if (res.data.success) {
        setDeleteTarget(null);
        loadUsers();
      } else {
        setDeleteError(res.data.error || t('common.noData'));
      }
    } catch (err) {
      const d = err.response?.data;
      setDeleteError(typeof d === 'object' && d?.error ? d.error : err.message || t('common.noData'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const openPermissions = (target) => {
    setPermissionTarget(target);
    setPermissionForm(target.module_permissions || {});
    setPermissionError('');
  };

  const savePermissions = async (event) => {
    event.preventDefault();
    setPermissionSaving(true);
    setPermissionError('');
    try {
      await API.put(`/admin/users/${permissionTarget.id}/module-permissions/`, {
        permissions: permissionForm,
      });
      setPermissionTarget(null);
      await loadUsers();
    } catch (err) {
      setPermissionError(err.response?.data?.error || err.message);
    } finally {
      setPermissionSaving(false);
    }
  };

  const totalUsers = users.length;
  const activeCount = users.filter((u) => u.is_active).length;
  const disabledCount = totalUsers - activeCount;
  const moduleRoleOptions = [
    { value: 'global:admin', label: 'Super Admin' },
    ...permissionModules.flatMap((module) => {
      const moduleName = module.key === 'grpo'
        ? 'GRPO'
        : module.key === 'purchase_quotation' ? 'Purchase Quotation' : module.display_name;
      return [
        { value: `${module.key}:USER`, label: `${moduleName} User` },
        { value: `${module.key}:ADMIN`, label: `${moduleName} Admin` },
      ];
    }),
  ];
  const normalizeModuleRoles = (selections) => {
    if (selections.includes('global:admin')) return ['global:admin'];
    return Array.from(selections.reduce((byModule, selection) => {
      byModule.set(selection.split(':')[0], selection);
      return byModule;
    }, new Map()).values());
  };

  return (
    <div className="page-shell um-page-shell">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header um-page-header">
        <div className="page-header-inner um-page-header__identity">
          <div className="page-icon-wrap"><UsersRound size={21} /></div>
          <div>
            <span className="section-kicker">{t('common.admin')}</span>
            <h1 className="page-subheading">{t('users.title')}</h1>
          </div>
        </div>
        <div className="um-page-header__actions">
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => navigate('/users/activity-log')}
          >
            <Activity size={16} /> {t('users.activityLog')}
          </button>
          <button
            type="button"
            className="app-button app-button--primary"
            onClick={() => { setShowCreate(true); setCreateError(''); setCreateSuccess(''); }}
          >
            <UserPlus size={16} /> {t('users.newUser')}
          </button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="um-stats-row">
        {[
          { label: t('users.totalUsers'), value: totalUsers, icon: UsersRound, tone: 'primary' },
          { label: t('users.active'), value: activeCount, icon: CircleCheck, tone: 'success' },
          { label: t('users.disabled'), value: disabledCount, icon: CircleOff, tone: 'danger' },
        ].map(({ label, value, icon: StatIcon, tone }) => (
          <div key={label} className="um-stat-card">
            <div className={`um-stat-card__icon um-stat-card__icon--${tone}`}>{React.createElement(StatIcon, { size: 17 })}</div>
            <div className="um-stat-card__content">
              <div className="um-stat-card__label">{label}</div>
              <div className="um-stat-card__value">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Users table ────────────────────────────────────────────────── */}
      <div className="um-table-wrap">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', gap: '1.25rem' }}>
            <AppSpinner size="md" label={t('users.loadingUsers')} />
            <LoadingSkeleton rows={5} style={{ width: '100%' }} />
          </div>
        ) : pageError ? (
          <div className="um-table-error-wrap">
            <div className="feedback-message feedback-message--error">{pageError}</div>
            <button type="button" className="app-button app-button--secondary feedback-message--mt"
              onClick={loadUsers}>{t('common.retry')}</button>
          </div>
        ) : users.length === 0 ? (
          <div className="um-table-state">{t('users.noUsers')}</div>
        ) : (
          <div className="um-table-overflow">
            <table className="um-table">
              <thead>
                <tr>
                  {[
                    t('users.colUsername'), t('users.colRole'), t('users.colStatus'),
                    t('users.colJoined'), t('users.colActions'),
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={!u.is_active ? 'um-table__row--inactive' : ''}
                  >
                    <td className="um-table__username">
                      {u.username}
                      {isSelf(u) && <span className="um-table__you">{t('users.you')}</span>}
                    </td>
                    <td><UserRoles user={u} /></td>
                    <td><StatusBadge isActive={u.is_active} /></td>
                    <td className="um-table__date num-ltr">{u.date_joined || '—'}</td>
                    <td>
                      <div className="um-table__actions">
                        <button type="button"
                          className="app-button app-button--secondary app-button--sm"
                          onClick={() => openEdit(u)}>
                          {t('users.editBtn')}
                        </button>

                        {isAdmin(me) && !isSelf(u) && (
                          <button type="button"
                            className="app-button app-button--secondary app-button--sm"
                            onClick={() => openPermissions(u)}>
                            <ShieldCheck size={14} /> Permissions
                          </button>
                        )}

                        {!isSelf(u) && (
                          <button type="button"
                            className={`app-button app-button--secondary app-button--sm ${u.is_active ? 'app-button--success-text' : 'app-button--danger-text'}`}
                            disabled={togglingId === u.id}
                            aria-label={u.is_active ? 'تعطيل المستخدم' : 'تفعيل المستخدم'}
                            title={u.is_active ? 'تعطيل المستخدم' : 'تفعيل المستخدم'}
                            onClick={() => handleToggleActive(u)}>
                            <Power size={14} aria-hidden="true" />
                          </button>
                        )}

                        {!isSelf(u) && (
                          <button type="button"
                            className="app-button app-button--secondary app-button--sm app-button--danger-text"
                            aria-label={t('users.deleteBtn')}
                            title={t('users.deleteBtn')}
                            onClick={() => { setDeleteTarget(u); setDeleteError(''); }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create user modal ───────────────────────────────────────────── */}
      {showCreate && (
        <Modal title={t('users.createModal')} onClose={() => setShowCreate(false)} maxWidth="560px">
          <form onSubmit={handleCreate} className="um-modal-form">
            <div className="form-field">
              <label className="form-label">{t('users.username')}</label>
              <input className="app-input" value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                required autoFocus />
            </div>
            <div className="form-field">
              <label className="form-label">{t('users.password')}</label>
              <input className="app-input" type="password" value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                required />
            </div>
            <div className="form-field">
              <label className="form-label">{t('users.role')}</label>
              {isAdmin(me) ? (
                <StandardDropdown
                  className="app-select"
                  multiple
                  options={moduleRoleOptions}
                  value={createForm.module_roles}
                  placeholder={t('common.selectOption')}
                  onChange={(module_roles) => setCreateForm((form) => ({
                    ...form,
                    module_roles: normalizeModuleRoles(module_roles),
                  }))}
                />
              ) : (
                <StandardDropdown className="app-select" value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}>
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </StandardDropdown>
              )}
            </div>
            {createError && <div className="feedback-message feedback-message--error">{createError}</div>}
            {createSuccess && <div className="feedback-message feedback-message--success">{createSuccess}</div>}

            <div className="modal-btn-row">
              <button type="button" className="app-button app-button--secondary"
                onClick={() => setShowCreate(false)}>{t('users.cancel')}</button>
              <button type="submit" className="app-button app-button--primary app-button--flex"
                disabled={createLoading} aria-busy={createLoading ? 'true' : 'false'}>
                {createLoading ? (
                  <>
                    <AppSpinner size="xs" />
                    <span>{t('users.creating')}</span>
                  </>
                ) : (
                  t('users.createUser')
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit user modal ─────────────────────────────────────────────── */}
      {editTarget && (
        <Modal title={t('users.editModal', editTarget.username)} onClose={() => setEditTarget(null)} maxWidth="560px">
          <form onSubmit={handleEdit} className="um-modal-form">
            <div className="form-field">
              <label className="form-label">{t('users.username')}</label>
              <input className="app-input" value={editForm.username}
                onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                required autoFocus />
            </div>
            <div className="form-field">
              <label className="form-label">{t('users.role')}</label>
              {isAdmin(me) && !isSelf(editTarget) ? (
                <StandardDropdown
                  className="app-select"
                  multiple
                  options={moduleRoleOptions}
                  value={editForm.module_roles || []}
                  placeholder={t('common.selectOption')}
                  onChange={(module_roles) => setEditForm((form) => ({
                    ...form,
                    module_roles: normalizeModuleRoles(module_roles),
                  }))}
                />
              ) : (
                <StandardDropdown className="app-select" value={editForm.role}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </StandardDropdown>
              )}
            </div>
            {!isSelf(editTarget) && (
              <label className="um-active-toggle">
                <input type="checkbox" checked={editForm.is_active}
                  onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))} />
                <span className="um-active-toggle__text">{t('users.accountActive')}</span>
                <StatusBadge isActive={editForm.is_active} />
              </label>
            )}

            <div className="um-pw-section">
              <div className="um-pw-section__label">{t('users.changePassword')}</div>
              <div className="um-pw-section__fields">
                <div className="form-field">
                  <label className="form-label">{t('users.newPassword')}</label>
                  <input
                    className="app-input"
                    type="password"
                    name="edit-new-password"
                    autoComplete="new-password"
                    value={editPw}
                    onChange={(e) => { setEditPw(e.target.value); setEditPwTouched(true); }}
                    placeholder={t('users.leaveBlank')}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t('users.confirmPassword')}</label>
                  <input
                    className="app-input"
                    type="password"
                    name="edit-confirm-password"
                    autoComplete="new-password"
                    value={editPwConfirm}
                    onChange={(e) => { setEditPwConfirm(e.target.value); setEditPwTouched(true); }}
                    placeholder={t('users.repeatPassword')}
                  />
                </div>
                {editPwTouched && editPw && editPwConfirm && editPw !== editPwConfirm && (
                  <div className="feedback-message feedback-message--error">{t('users.passwordMismatch')}</div>
                )}
              </div>
            </div>

            {editError && <div className="feedback-message feedback-message--error">{editError}</div>}
            {editSuccess && <div className="feedback-message feedback-message--success">{editSuccess}</div>}

            <div className="modal-btn-row">
              <button type="button" className="app-button app-button--secondary"
                onClick={() => setEditTarget(null)}>{t('users.cancel')}</button>
              <button type="submit" className="app-button app-button--primary app-button--flex"
                disabled={editLoading} aria-busy={editLoading ? 'true' : 'false'}>
                {editLoading ? (
                  <>
                    <AppSpinner size="xs" />
                    <span>{t('users.saving')}</span>
                  </>
                ) : (
                  t('users.saveChanges')
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {permissionTarget && (
        <Modal title={`Module permissions — ${permissionTarget.username}`} onClose={() => setPermissionTarget(null)} maxWidth="560px">
          <form onSubmit={savePermissions} className="um-modal-form">
            {permissionModules.map((module) => (
              <div className="form-field" key={module.key}>
                <label className="form-label" htmlFor={`permission-${module.key}`}>{module.display_name}</label>
                <StandardDropdown
                  id={`permission-${module.key}`}
                  className="app-select"
                  value={permissionForm[module.key] || ''}
                  onChange={(event) => setPermissionForm((current) => ({
                    ...current,
                    [module.key]: event.target.value,
                  }))}
                >
                  <option value="">No Access</option>
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </StandardDropdown>
              </div>
            ))}
            {permissionError && <div className="feedback-message feedback-message--error">{permissionError}</div>}
            <div className="modal-btn-row">
              <button type="button" className="app-button app-button--secondary" onClick={() => setPermissionTarget(null)}>Cancel</button>
              <button type="submit" className="app-button app-button--primary app-button--flex" disabled={permissionSaving} aria-busy={permissionSaving ? 'true' : 'false'}>
                {permissionSaving ? (
                  <>
                    <AppSpinner size="xs" />
                    <span>{t('common.saving')}</span>
                  </>
                ) : (
                  'Save permissions'
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete confirmation modal ───────────────────────────────────── */}
      {deleteTarget && (
        <Modal title={t('users.deleteModal')} onClose={() => setDeleteTarget(null)} maxWidth="400px">
          <div className="um-modal-form">
            <p style={{ color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
              {t('users.deleteConfirm', deleteTarget.username)}
              <strong>{deleteTarget.username}</strong>?
            </p>
            <div className="um-delete-warn">
              {t('users.deleteWarn')} <strong>{t('users.deleteWarnDisable')}</strong>{' '}
              {t('users.deleteWarnSuffix')}
            </div>

            {deleteError && (
              <div className="feedback-message feedback-message--error">{deleteError}</div>
            )}

            <div className="modal-btn-row">
              <button type="button" className="app-button app-button--secondary app-button--flex"
                onClick={() => setDeleteTarget(null)}>{t('users.cancel')}</button>
              <button type="button" className="um-delete-confirm"
                disabled={deleteLoading} onClick={handleDelete}>
                {deleteLoading ? t('users.deleting') : t('users.deleteBtn')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default UserManagementPage;
