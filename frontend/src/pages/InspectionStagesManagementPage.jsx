import React from 'react';
import PageHeader from '../components/ui/PageHeader';
import StagedDeleteDialog from '../components/ui/StagedDeleteDialog';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import { useInspectionStagesManagement } from '../hooks/useInspectionStagesManagement';
import { canManageQuality } from '../utils/roles';

function fieldError(errors, field) {
  const value = errors?.[field];
  if (Array.isArray(value)) return value.join(' ');
  return value || '';
}

function InspectionStageDialog({ open, editingStage, form, errors, saving, onChange, onClose, onSubmit, t }) {
  if (!open) return null;
  return (
    <div className="simple-modal-backdrop" role="presentation">
      <div className="simple-modal-card" role="dialog" aria-modal="true" aria-labelledby="inspection-stage-dialog-title">
        <div className="simple-modal__header">
          <h2 id="inspection-stage-dialog-title" className="simple-modal__title">
            {editingStage ? t('inspectionStages.editStage') : t('inspectionStages.addStage')}
          </h2>
          <button type="button" className="simple-modal__close" onClick={onClose} aria-label={t('common.close')}>
            x
          </button>
        </div>
        <form className="um-modal-form" onSubmit={onSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="stage-code">{t('inspectionStages.code')}</label>
            <input
              id="stage-code"
              className={`app-input ${fieldError(errors, 'code') ? 'app-input--invalid' : ''}`}
              value={form.code}
              onChange={(event) => onChange('code', event.target.value)}
              required
            />
            {fieldError(errors, 'code') && <span className="error-msg">{fieldError(errors, 'code')}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="stage-name-ar">{t('inspectionStages.nameAr')}</label>
            <input
              id="stage-name-ar"
              className={`app-input ${fieldError(errors, 'name_ar') ? 'app-input--invalid' : ''}`}
              value={form.name_ar}
              onChange={(event) => onChange('name_ar', event.target.value)}
              required
            />
            {fieldError(errors, 'name_ar') && <span className="error-msg">{fieldError(errors, 'name_ar')}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="stage-name-en">{t('inspectionStages.nameEn')}</label>
            <input
              id="stage-name-en"
              className={`app-input ${fieldError(errors, 'name_en') ? 'app-input--invalid' : ''}`}
              value={form.name_en}
              onChange={(event) => onChange('name_en', event.target.value)}
              required
            />
            {fieldError(errors, 'name_en') && <span className="error-msg">{fieldError(errors, 'name_en')}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="stage-order">{t('inspectionStages.sortOrder')}</label>
            <input
              id="stage-order"
              className="app-input"
              type="number"
              value={form.sort_order}
              onChange={(event) => onChange('sort_order', event.target.value)}
            />
          </div>
          <label className="form-field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => onChange('is_active', event.target.checked)}
            />
            <span>{t('inspectionStages.active')}</span>
          </label>
          {fieldError(errors, 'non_field_errors') && <div className="feedback-message feedback-message--error">{fieldError(errors, 'non_field_errors')}</div>}
          <div className="modal-btn-row">
            <button type="button" className="app-button app-button--secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="app-button app-button--primary" disabled={saving}>
              {saving ? t('common.working') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InspectionStagesManagementPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const controller = useInspectionStagesManagement(toast, t);
  const adminUser = canManageQuality(user);
  const deleteStageName = controller.deleteTarget?.name_ar || controller.deleteTarget?.name_en || controller.deleteTarget?.code || '';

  return (
    <div className="page-shell page-shell--padded-lg">
      <PageHeader
        eyebrow={t('inspectionStages.eyebrow')}
        title={t('inspectionStages.title')}
        description={t('inspectionStages.description')}
      />

      <div className="rules-page-shell">
        <section className="card-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="rr-stats-row" style={{ flex: '1 1 320px', margin: 0 }}>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value">{controller.stages.length}</span>
                <span className="rr-stat-chip__label">{t('inspectionStages.total')}</span>
              </div>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value" style={{ color: 'var(--success)' }}>{controller.activeCount}</span>
                <span className="rr-stat-chip__label">{t('inspectionStages.active')}</span>
              </div>
            </div>
            <button type="button" className="app-button app-button--primary" onClick={controller.openCreateDialog}>
              + {t('inspectionStages.addStage')}
            </button>
          </div>
        </section>

        <section className="card-panel rules-panel">
          <form
            className="rules-panel__lookup-form"
            onSubmit={(event) => {
              event.preventDefault();
              controller.loadStages();
            }}
          >
            <input
              className="app-input"
              type="search"
              value={controller.search}
              onChange={(event) => controller.setSearch(event.target.value)}
              placeholder={t('inspectionStages.searchPlaceholder')}
            />
            <button type="submit" className="app-button app-button--secondary">
              {t('common.search')}
            </button>
          </form>

          <div className="table-scroll-wrap">
            <table className="data-table management-table">
              <thead>
                <tr>
                  <th>{t('inspectionStages.code')}</th>
                  <th>{t('inspectionStages.nameAr')}</th>
                  <th>{t('inspectionStages.nameEn')}</th>
                  <th>{t('inspectionStages.sortOrder')}</th>
                  <th>{t('inspectionStages.status')}</th>
                  <th>{t('inspectionStages.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {controller.loading ? (
                  <tr><td colSpan="6">{t('common.loading')}</td></tr>
                ) : controller.stages.length === 0 ? (
                  <tr><td colSpan="6">{t('common.noData')}</td></tr>
                ) : controller.stages.map((stage) => (
                  <tr key={stage.id}>
                    <td><strong>{stage.code}</strong></td>
                    <td>{stage.name_ar}</td>
                    <td>{stage.name_en}</td>
                    <td>{stage.sort_order}</td>
                    <td>{stage.is_active ? t('inspectionStages.enabled') : t('inspectionStages.disabled')}</td>
                    <td>
                      <div className="management-table__actions">
                        <button type="button" className="app-button app-button--secondary app-button--compact" onClick={() => controller.openEditDialog(stage)}>
                          {t('common.edit')}
                        </button>
                        <button type="button" className="app-button app-button--secondary app-button--compact" onClick={() => controller.toggleStage(stage)}>
                          {stage.is_active ? t('inspectionStages.disable') : t('inspectionStages.enable')}
                        </button>
                        {adminUser && (
                          <button type="button" className="app-button app-button--danger app-button--compact" onClick={() => controller.openDeleteDialog(stage)}>
                            {t('inspectionStages.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <InspectionStageDialog
        open={controller.dialogOpen}
        editingStage={controller.editingStage}
        form={controller.form}
        errors={controller.errors}
        saving={controller.saving}
        onChange={controller.updateForm}
        onClose={controller.closeDialog}
        onSubmit={controller.saveStage}
        t={t}
      />
      <StagedDeleteDialog
        open={Boolean(controller.deleteTarget)}
        step={controller.deleteStep}
        title={t('inspectionStages.deleteFirstTitle')}
        message={t('inspectionStages.deleteFirstMessage', deleteStageName)}
        secondTitle={t('inspectionStages.deleteSecondTitle')}
        secondMessage={t('inspectionStages.deleteSecondMessage', deleteStageName)}
        confirmationValue={controller.deleteConfirmationText}
        error={controller.deleteError}
        loading={controller.deleting}
        onConfirmationChange={controller.setDeleteConfirmationText}
        onContinue={controller.continueDelete}
        onDelete={controller.deleteStage}
        onClose={controller.closeDeleteDialog}
      />
    </div>
  );
}

export default InspectionStagesManagementPage;
