import StandardDropdown from '../components/ui/StandardDropdown';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { warehouseSearch } from '../services/masterDataSearch';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import SearchableSelect from '../components/ui/SearchableSelect';
import AppSpinner from '../components/ui/AppSpinner';
import { canManageUsers, defaultCreatableRole, getRoleOptionsForUser, isProductionUserRole } from '../utils/roles';

function CreateUserPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const roleOptions = getRoleOptionsForUser(user);
  const defaultRole = defaultCreatableRole(user);
  const [form, setForm] = useState({ username: '', password: '', warehouse: '', role: defaultRole });
  const warehouses = [];
  const warehousesLoading = false;
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);



  if (!canManageUsers(user)) {
    return (
      <div className="page-shell page-shell--center">
        <div className="feedback-message feedback-message--error">{t('common.accessDenied')}</div>
      </div>
    );
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await API.post('/create-user/', form);
      if (res.data.success) {
        setSuccess(t('createUser.created', form.username));
        setForm({ username: '', password: '', warehouse: '', role: defaultRole });
      } else {
        setError(res.data.error || t('common.noData'));
      }
    } catch (err) {
      const data = err.response?.data;
      const msg = (typeof data === 'object' && data?.error)
        ? data.error
        : (err.response?.statusText || err.message || t('common.noData'));
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell page-shell--center">
      <section className="card-panel card-panel--compact">
        <div className="page-header-inner">
          <div className="page-icon-wrap">👤</div>
          <div>
            <span className="section-kicker">{t('common.admin')}</span>
            <h1 className="page-subheading">{t('createUser.title')}</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="form-stack">
          <div className="form-field">
            <label className="form-label">{t('createUser.username')}</label>
            <input className="app-input" value={form.username} onChange={set('username')} required autoFocus />
          </div>

          <div className="form-field">
            <label className="form-label">{t('createUser.password')}</label>
            <input className="app-input" type="password" value={form.password} onChange={set('password')} required />
          </div>

          <div className="form-field">
            <label className="form-label">{t('createUser.warehouse')}</label>
            <SearchableSelect
              className="app-select"
              searchSource={warehouseSearch}
              value={form.warehouse}
              onChange={set('warehouse')}
              required={isProductionUserRole(form.role)}
              disabled={warehousesLoading}
              placeholder={t('createUser.selectWarehouse')}
            >
              <option value="">{warehousesLoading ? t('createUser.loadingWarehouses') : t('createUser.selectWarehouse')}</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code}{w.name ? ` — ${w.name}` : ''}
                </option>
              ))}
            </SearchableSelect>
          </div>

          <div className="form-field">
            <label className="form-label">{t('createUser.role')}</label>
            <StandardDropdown className="app-select" value={form.role} onChange={set('role')}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </StandardDropdown>
          </div>

          {error && <div className="feedback-message feedback-message--error">{error}</div>}
          {success && <div className="feedback-message feedback-message--success">{success}</div>}

          <div className="modal-btn-row">
            <button type="button" className="app-button app-button--secondary"
              onClick={() => navigate('/')}>
              {t('createUser.back')}
            </button>
            <button type="submit" className="app-button app-button--primary app-button--flex"
              disabled={loading || warehousesLoading} aria-busy={loading ? 'true' : 'false'}>
              {loading ? (
                <>
                  <AppSpinner size="xs" />
                  <span>{t('createUser.creating')}</span>
                </>
              ) : (
                t('createUser.createUser')
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default CreateUserPage;
