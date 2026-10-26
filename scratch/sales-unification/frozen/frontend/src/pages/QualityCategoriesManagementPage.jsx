import React from 'react';
import PageHeader from '../components/ui/PageHeader';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import { useQualityCategoriesManagement } from '../hooks/useQualityCategoriesManagement';

function fieldError(errors, field) {
  const value = errors?.[field];
  if (Array.isArray(value)) return value.join(' ');
  return value || '';
}

function QualityCategoryDialog({ open, editingCategory, form, errors, saving, onChange, onClose, onSubmit, t }) {
  if (!open) return null;
  return (
    <div className="simple-modal-backdrop" role="presentation">
      <div className="simple-modal-card" role="dialog" aria-modal="true" aria-labelledby="quality-category-dialog-title">
        <div className="simple-modal__header">
          <h2 id="quality-category-dialog-title" className="simple-modal__title">
            {editingCategory ? t('qualityCategories.editCategory') : t('qualityCategories.addCategory')}
          </h2>
          <button type="button" className="simple-modal__close" onClick={onClose} aria-label={t('common.close')}>
            x
          </button>
        </div>
        <form className="um-modal-form" onSubmit={onSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="category-code">{t('qualityCategories.code')}</label>
            <input
              id="category-code"
              className={`app-input ${fieldError(errors, 'code') ? 'app-input--invalid' : ''}`}
              value={form.code}
              onChange={(event) => onChange('code', event.target.value)}
              required
            />
            {fieldError(errors, 'code') && <span className="error-msg">{fieldError(errors, 'code')}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="category-name-ar">{t('qualityCategories.nameAr')}</label>
            <input
              id="category-name-ar"
              className={`app-input ${fieldError(errors, 'name_ar') ? 'app-input--invalid' : ''}`}
              value={form.name_ar}
              onChange={(event) => onChange('name_ar', event.target.value)}
              required
            />
            {fieldError(errors, 'name_ar') && <span className="error-msg">{fieldError(errors, 'name_ar')}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="category-name-en">{t('qualityCategories.nameEn')}</label>
            <input
              id="category-name-en"
              className={`app-input ${fieldError(errors, 'name_en') ? 'app-input--invalid' : ''}`}
              value={form.name_en}
              onChange={(event) => onChange('name_en', event.target.value)}
              required
            />
            {fieldError(errors, 'name_en') && <span className="error-msg">{fieldError(errors, 'name_en')}</span>}
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="category-order">{t('qualityCategories.sortOrder')}</label>
            <input
              id="category-order"
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
            <span>{t('qualityCategories.active')}</span>
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

function QualityCategoriesManagementPage() {
  const { t } = useI18n();
  const toast = useToast();
  const controller = useQualityCategoriesManagement(toast, t);

  return (
    <div className="page-shell page-shell--padded-lg">
      <PageHeader
        eyebrow={t('qualityCategories.eyebrow')}
        title={t('qualityCategories.title')}
        description={t('qualityCategories.description')}
      />

      <div className="rules-page-shell">
        <section className="card-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="rr-stats-row" style={{ flex: '1 1 320px', margin: 0 }}>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value">{controller.categories.length}</span>
                <span className="rr-stat-chip__label">{t('qualityCategories.total')}</span>
              </div>
              <div className="rr-stat-chip">
                <span className="rr-stat-chip__value" style={{ color: 'var(--success)' }}>{controller.activeCount}</span>
                <span className="rr-stat-chip__label">{t('qualityCategories.active')}</span>
              </div>
            </div>
            <button type="button" className="app-button app-button--primary" onClick={controller.openCreateDialog}>
              + {t('qualityCategories.addCategory')}
            </button>
          </div>
        </section>

        <section className="card-panel rules-panel">
          <form
            className="rules-panel__lookup-form"
            onSubmit={(event) => {
              event.preventDefault();
              controller.loadCategories();
            }}
          >
            <input
              className="app-input"
              type="search"
              value={controller.search}
              onChange={(event) => controller.setSearch(event.target.value)}
              placeholder={t('qualityCategories.searchPlaceholder')}
            />
            <button type="submit" className="app-button app-button--secondary">
              {t('common.search')}
            </button>
          </form>

          <div className="table-scroll-wrap">
            <table className="data-table management-table">
              <thead>
                <tr>
                  <th>{t('qualityCategories.code')}</th>
                  <th>{t('qualityCategories.nameAr')}</th>
                  <th>{t('qualityCategories.nameEn')}</th>
                  <th>{t('qualityCategories.sortOrder')}</th>
                  <th>{t('qualityCategories.status')}</th>
                  <th>{t('qualityCategories.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {controller.loading ? (
                  <tr><td colSpan="6">{t('common.loading')}</td></tr>
                ) : controller.categories.length === 0 ? (
                  <tr><td colSpan="6">{t('common.noData')}</td></tr>
                ) : controller.categories.map((category) => (
                  <tr key={category.id}>
                    <td><strong>{category.code}</strong></td>
                    <td>{category.name_ar}</td>
                    <td>{category.name_en}</td>
                    <td>{category.sort_order}</td>
                    <td>{category.is_active ? t('qualityCategories.enabled') : t('qualityCategories.disabled')}</td>
                    <td>
                      <div className="management-table__actions">
                        <button type="button" className="app-button app-button--secondary app-button--compact" onClick={() => controller.openEditDialog(category)}>
                          {t('common.edit')}
                        </button>
                        <button type="button" className="app-button app-button--secondary app-button--compact" onClick={() => controller.toggleCategory(category)}>
                          {category.is_active ? t('qualityCategories.disable') : t('qualityCategories.enable')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <QualityCategoryDialog
        open={controller.dialogOpen}
        editingCategory={controller.editingCategory}
        form={controller.form}
        errors={controller.errors}
        saving={controller.saving}
        onChange={controller.updateForm}
        onClose={controller.closeDialog}
        onSubmit={controller.saveCategory}
        t={t}
      />
    </div>
  );
}

export default QualityCategoriesManagementPage;
