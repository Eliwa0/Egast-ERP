import StandardDropdown from '../components/ui/StandardDropdown';
import { warehouseSearch, userSearch } from '../services/masterDataSearch';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { canAccessTransferRules } from '../utils/roles';
import SearchableSelect from '../components/ui/SearchableSelect';
import { rulesForSelectedStage, staleRulesForSelectedStage } from './transferRulesSelection';

const STAGE_OPTIONS = [
  { value: 'STAGE_1_TO_INTERMEDIATE', labelKey: 'transferReview.stage1' },
  { value: 'STAGE_2_TO_FRIDGE', labelKey: 'transferReview.stage2' },
  { value: 'STAGE_3_FROM_FRIDGE', labelKey: 'transferReview.stage3' },
  { value: 'STAGE_4_TO_DESTINATION', labelKey: 'transferReview.stage4' },
  { value: 'STAGE_5_TO_CONTAINER', labelKey: 'transferReview.stage5' },
];

function ruleAllowsDirection(rule, direction) {
  return rule.is_active && (rule.direction === direction || rule.direction === 'BOTH');
}

function TransferRulesPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [rules, setRules] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedFrom, setSelectedFrom] = useState([]);
  const [selectedTo, setSelectedTo] = useState([]);
  const [selectedStage, setSelectedStage] = useState('STAGE_1_TO_INTERMEDIATE');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ error: '', success: '' });
  const sourceOnly = selectedStage === 'STAGE_5_TO_CONTAINER';

  const refreshRules = useCallback(async () => {
    const response = await API.get('/transfer/rules/warehouse-access/');
    setRules(response.data?.data?.rules || []);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      API.get('/admin/users/', { params: { lookup: 1, module: 'transfer', level: 'USER', initial: 1, limit: 1 } }),
      Promise.resolve({ data: { data: { warehouses: [] } } }),
      API.get('/transfer/rules/warehouse-access/'),
    ])
      .then(([usersRes, whRes, rulesRes]) => {
        if (!mounted) return;
        const loadedUsers = usersRes.data?.data?.users || [];
        setUsers(loadedUsers);
        setWarehouses(whRes.data?.data?.warehouses || []);
        setRules(rulesRes.data?.data?.rules || []);
        if (loadedUsers.length > 0) {
          setSelectedUserId(String(loadedUsers[0].id));
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setFeedback({
          error: err.response?.data?.error || err.message || t('transferRules.loadFailed'),
          success: '',
        });
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [t]);

  const selectedUserRules = useMemo(
    () => rules.filter((rule) => String(rule.user_id) === String(selectedUserId)),
    [rules, selectedUserId],
  );

  useEffect(() => {
    const activeRules = rulesForSelectedStage(selectedUserRules, selectedStage);
    setSelectedFrom(Array.from(new Set(
      activeRules.filter((rule) => ruleAllowsDirection(rule, 'FROM')).map((rule) => rule.warehouse_code),
    )).filter((code) => typeof code === 'string' && code.trim()).slice(0, 1));
    setSelectedTo(Array.from(new Set(
      activeRules.filter((rule) => ruleAllowsDirection(rule, 'TO')).map((rule) => rule.warehouse_code),
    )).filter((code) => typeof code === 'string' && code.trim()).slice(0, 1));
  }, [selectedUserRules, selectedStage]);

  const toggleCode = (direction, code) => {
    const setter = direction === 'FROM' ? setSelectedFrom : setSelectedTo;
    setter((prev) => (
      prev.includes(code)
        ? []
        : [code]
    ));
    setFeedback({ error: '', success: '' });
  };

  const saveRules = async () => {
    if (!selectedUserId) return;
    if (selectedFrom.length !== 1 || (!sourceOnly && selectedTo.length !== 1)) {
      setFeedback({ error: t(sourceOnly ? 'transferRules.stage5SourceRequired' : 'transferRules.fixedRouteRequired'), success: '' });
      return;
    }
    setSaving(true);
    setFeedback({ error: '', success: '' });
    try {
      const fromSet = new Set(selectedFrom);
      const toSet = new Set(sourceOnly ? [] : selectedTo);
      const allCodes = Array.from(new Set([...selectedFrom, ...(sourceOnly ? [] : selectedTo)]));
      const desired = allCodes.map((code) => {
        const direction = fromSet.has(code) && toSet.has(code)
          ? 'BOTH'
          : fromSet.has(code)
          ? 'FROM'
          : 'TO';
        const wh = warehouses.find((item) => item.code === code);
        return {
          user_id: Number(selectedUserId),
          warehouse_code: code,
          warehouse_name: wh?.name || code,
          direction,
          stage: selectedStage,
          is_active: true,
        };
      });

      await Promise.all(desired.map((payload) => API.post('/transfer/rules/warehouse-access/', payload)));

      const desiredKeys = new Set(
        desired.map((rule) => `${rule.warehouse_code}|${rule.direction}|${rule.stage}`),
      );
      const staleRules = staleRulesForSelectedStage(selectedUserRules, selectedStage, desiredKeys);
      await Promise.all(staleRules.map((rule) => API.delete(`/transfer/rules/warehouse-access/${rule.id}/`)));

      await refreshRules();
      setFeedback({ error: '', success: t('transferRules.saved') });
    } catch (err) {
      setFeedback({
        error: err.response?.data?.error || err.message || t('transferRules.saveFailed'),
        success: '',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (ruleId) => {
    setFeedback({ error: '', success: '' });
    try {
      await API.delete(`/transfer/rules/warehouse-access/${ruleId}/`);
      await refreshRules();
      setFeedback({ error: '', success: t('transferRules.deleted') });
    } catch (err) {
      setFeedback({
        error: err.response?.data?.error || err.message || t('transferRules.deleteFailed'),
        success: '',
      });
    }
  };

  if (!canAccessTransferRules(user)) {
    return (
      <div className="page-shell page-shell--center">
        <div className="feedback-message feedback-message--error">{t('common.accessDenied')}</div>
      </div>
    );
  }

  return (
    <div className="page-shell page-shell--padded-lg">
      <div className="rules-page-shell">
        <div className="rules-page__header">
          <div className="page-icon-wrap page-icon-wrap--warning">TR</div>
          <div>
            <span className="section-kicker">{t('transferRules.admin')}</span>
            <h1 className="page-subheading">{t('transferRules.title')}</h1>
          </div>
          <button
            type="button"
            className="app-button app-button--secondary toolbar-nav-btn rules-page__back-btn"
            onClick={() => navigate('/order-rules')}
          >
            {t('transferRules.back')}
          </button>
        </div>

        {feedback.error && (
          <div className="feedback-message feedback-message--error rules-feedback">{feedback.error}</div>
        )}
        {feedback.success && (
          <div className="feedback-message feedback-message--success rules-feedback">{feedback.success}</div>
        )}

        <div className="rules-tab-layout transfer-rules-layout">
          <section className="card-panel rules-sidebar">
            <h2 className="rules-sidebar__title">{t('transferRules.users')}</h2>
            {loading ? (
              <span className="rules-sidebar__empty">{t('transferRules.loadingUsers')}</span>
            ) : users.length === 0 ? (
              <span className="rules-sidebar__empty">{t('transferRules.noUsers')}</span>
            ) : (
              <div className="rules-sidebar__list">
                {users.map((item) => {
                  const count = rules.filter((rule) => rule.user_id === item.id && rule.is_active).length;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`sidebar-card transfer-rules-user-card${String(selectedUserId) === String(item.id) ? ' sidebar-card--active' : ''}`}
                      onClick={() => setSelectedUserId(String(item.id))}
                    >
                      <span className="sidebar-card__title">{item.username}</span>
                      <span className="sidebar-card__subtitle">{item.role}</span>
                      <span className="sidebar-card__badge">{t('transferRules.rulesCount', count)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card-panel rules-panel">
            <div className="transfer-rules-toolbar">
              <div className="form-field">
                <label className="form-label">{t('transferRules.user')}</label>
                <SearchableSelect
                  className="app-select"
                  searchSource={{ ...userSearch, params: { module: 'transfer', level: 'USER' } }}
                  onSearchResults={(rows) => setUsers((previous) => [...new Map([...previous, ...rows].map((row) => [row.id, row])).values()])}
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  disabled={loading || users.length === 0}
                >
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>{item.username}</option>
                  ))}
                </SearchableSelect>
              </div>

              <div className="form-field">
                <label className="form-label">{t('transferRules.allowedStages')}</label>
                <StandardDropdown
                  className="app-select"
                  value={selectedStage}
                  onChange={(event) => setSelectedStage(event.target.value)}
                >
                  {STAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.labelKey ? t(option.labelKey) : option.label}</option>
                  ))}
                </StandardDropdown>
              </div>
            </div>

            <div className="transfer-rules-grid">
              <WarehouseChecklist
                title={t('transferRules.allowedFrom')}
                warehouses={warehouses}
                selected={selectedFrom}
                onToggle={(code) => toggleCode('FROM', code)}
                loading={loading}
                onResults={(rows) => setWarehouses((previous) => [...new Map([...previous, ...rows].map((row) => [row.code, row])).values()])}
              />
              {!sourceOnly && <WarehouseChecklist
                title={t('transferRules.allowedTo')}
                warehouses={warehouses}
                selected={selectedTo}
                onToggle={(code) => toggleCode('TO', code)}
                loading={loading}
                onResults={(rows) => setWarehouses((previous) => [...new Map([...previous, ...rows].map((row) => [row.code, row])).values()])}
              />}
            </div>

            <button
              type="button"
              className="app-button app-button--primary app-button--block rules-save-btn"
              disabled={saving || !selectedUserId}
              onClick={saveRules}
            >
              {saving ? t('transferRules.saving') : t('transferRules.saveAccess')}
            </button>

            {selectedUserRules.length > 0 && (
              <div className="transfer-rules-current">
                <h2 className="rules-sidebar__title">{t('transferRules.currentRules')}</h2>
                <div className="transfer-rules-table-wrap">
                  <table className="transfer-rules-table">
                    <thead>
                      <tr>
                        <th>{t('transferRules.warehouse')}</th>
                        <th>{t('transferRules.direction')}</th>
                        <th>{t('transferRules.stage')}</th>
                        <th>{t('transferRules.status')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUserRules.map((rule) => (
                        <tr key={rule.id}>
                          <td>
                            <span className="transfer-rules-code">{rule.warehouse_code}</span>
                            {rule.warehouse_name && <span className="transfer-rules-name">{rule.warehouse_name}</span>}
                          </td>
                          <td>{rule.direction}</td>
                          <td>{rule.stage}</td>
                          <td>{rule.is_active ? t('transferRules.active') : t('transferRules.inactive')}</td>
                          <td>
                            <button
                              type="button"
                              className="app-button app-button--danger transfer-rules-delete-btn"
                              onClick={() => deleteRule(rule.id)}
                            >
                              {t('transferRules.delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default TransferRulesPage;

function WarehouseChecklist({ title, warehouses, selected, onToggle, loading, onResults }) {
  const id = React.useId();
  return <div className="transfer-rules-checklist">
    <label className="form-label transfer-rules-warehouse-label" htmlFor={id}>{title}</label>
    <SearchableSelect id={id} aria-label={title} className="transfer-rules-warehouse-select" searchInDropdown searchSource={warehouseSearch} options={[]} disabled={loading}
      value={selected[0] || ''} onSearchResults={onResults}
      selectedOptions={selected.slice(0, 1).map((code) => ({ value: code, label: `${code} - ${warehouses.find((row) => row.code === code)?.name || code}` }))}
      onChange={(code) => { if (code !== (selected[0] || '')) onToggle(code || selected[0]); }} />
  </div>;
}
