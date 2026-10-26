import StandardDropdown from '../components/ui/StandardDropdown';
import { itemSearch as remoteItemSearch } from '../services/masterDataSearch';
import React from 'react';
import PageHeader from '../components/ui/PageHeader';
import { useI18n } from '../contexts/I18nContext';
import { useToast } from '../components/ui/ToastProvider';
import SearchableSelect from '../components/ui/SearchableSelect';
import { useItemQualityCriteriaMapping } from '../hooks/useItemQualityCriteriaMapping';

function CriterionCard({ criterion, selected, onToggle, t }) {
  return (
    <button
      type="button"
      className={`quality-vendor-card${selected ? ' quality-vendor-card--selected' : ''}`}
      role="checkbox"
      aria-checked={selected}
      onClick={() => onToggle(criterion.id)}
      style={{ textAlign: 'start' }}
    >
      <span className="quality-vendor-card__check" aria-hidden="true">✓</span>
      <strong className="quality-vendor-card__name">{criterion.name_ar || criterion.name_en}</strong>
      <span className="quality-vendor-card__code">{criterion.code}</span>
      <span className="quality-vendor-card__pinned">{criterion.category_detail?.name_ar || criterion.category_name_ar || criterion.category_code}</span>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {selected ? t('itemCriteria.selected') : t('itemCriteria.notSelected')}
      </span>
    </button>
  );
}

function ItemCriteriaMappingPage() {
  const { t } = useI18n();
  const toast = useToast();
  const controller = useItemQualityCriteriaMapping(toast, t);

  return (
    <div className="page-shell page-shell--padded-lg">
      <PageHeader
        eyebrow={t('itemCriteria.eyebrow')}
        title={t('itemCriteria.title')}
        description={t('itemCriteria.description')}
      />

      <div className="rules-tab-layout">
        <section className="card-panel rules-sidebar">
          <h2 className="rules-sidebar__title">{t('itemCriteria.stage')}</h2>
          <div className="form-field" style={{ marginBottom: '14px' }}>
            <StandardDropdown
              className="app-input"
              value={controller.selectedStageId}
              onChange={(event) => controller.selectStage(event.target.value)}
              disabled={controller.stagesLoading}
              placeholder={t('itemCriteria.selectStage')}
            >
              <option value="">{controller.stagesLoading ? t('common.loading') : t('itemCriteria.selectStage')}</option>
              {controller.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name_ar || stage.name_en} ({stage.code})
                </option>
              ))}
            </StandardDropdown>
          </div>

          <h2 className="rules-sidebar__title">{t('itemCriteria.items')}</h2>
          <div className="form-field" style={{ marginBottom: '10px' }}>
            <label className="form-label" htmlFor="item-criteria-group">{t('itemCriteria.itemGroup')}</label>
            <SearchableSelect
              id="item-criteria-group"
              className="app-input"
              value={controller.selectedItemGroupCode}
              onChange={(event) => controller.selectItemGroup(event.target.value)}
              disabled={!controller.selectedStageId || controller.itemGroupsLoading}
              placeholder={t('itemCriteria.selectItemGroup')}
            >
              <option value="">
                {controller.itemGroupsLoading ? t('common.loading') : t('itemCriteria.selectItemGroup')}
              </option>
              {controller.itemGroups.map((group) => (
                <option key={group.ItmsGrpCod} value={String(group.ItmsGrpCod)}>
                  {group.ItmsGrpNam}
                </option>
              ))}
            </SearchableSelect>
          </div>
          <SearchableSelect options={[]} label={t('itemCriteria.itemSearchPlaceholder')}
            searchSource={{ ...remoteItemSearch, params: { item_group_code: controller.selectedItemGroupCode } }}
            disabled={!controller.selectedItemGroupCode} value={controller.selectedItem?.item_code || ''}
            selectedOptions={controller.selectedItem ? [{ value: controller.selectedItem.item_code, label: `${controller.selectedItem.item_code} - ${controller.selectedItem.item_name}` }] : []}
            onSelectOption={(option) => controller.selectItem(option?.raw || null)} />
        </section>

        <section className="card-panel rules-panel">
          {controller.selectedItem ? (
            <>
              <div className="rules-panel__info-box">
                <span className="rules-panel__info-icon">QI</span>
                <div>
                  <div className="rules-panel__info-title">{controller.selectedItem.item_name || controller.selectedItem.item_code}</div>
                  <div className="rules-panel__info-sub">
                    {controller.selectedItem.item_code}
                    {controller.selectedStage ? ` · ${controller.selectedStage.name_ar || controller.selectedStage.name_en}` : ''}
                  </div>
                </div>
                <span className="rules-panel__restricted-badge">
                  {t('itemCriteria.selectedCount', controller.selectedCount)}
                </span>
              </div>

              {controller.criteriaLoading || controller.categoriesLoading || controller.mappingsLoading ? (
                <div className="rules-panel__loading">{t('common.loading')}</div>
              ) : controller.activeCriteria.length === 0 ? (
                <div className="rules-panel__empty-hint">
                  <strong>{t('itemCriteria.noCriteriaTitle')}</strong>
                  <span>{t('itemCriteria.noCriteriaDesc')}</span>
                </div>
              ) : (
                <>
                  <div
                    className="rules-panel__lookup-form"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginBottom: '16px' }}
                  >
                    <SearchableSelect
                      className="app-input"
                      value={controller.selectedCriteriaCategoryId}
                      onChange={(event) => controller.setSelectedCriteriaCategoryId(event.target.value)}
                      aria-label={t('itemCriteria.categoryFilter')}
                      placeholder={t('itemCriteria.allCategories')}
                    >
                      <option value="">{t('itemCriteria.allCategories')}</option>
                      {controller.categories.map((category) => (
                        <option key={category.id} value={String(category.id)}>
                          {category.name_ar || category.name_en || category.code}
                        </option>
                      ))}
                    </SearchableSelect>
                    <input
                      className="app-input"
                      type="search"
                      value={controller.criteriaSearch}
                      onChange={(event) => controller.setCriteriaSearch(event.target.value)}
                      placeholder={t('itemCriteria.criteriaSearchPlaceholder')}
                      aria-label={t('itemCriteria.criteriaSearch')}
                    />
                    <StandardDropdown
                      className="app-input"
                      value={controller.criteriaSelectionFilter}
                      onChange={(event) => controller.setCriteriaSelectionFilter(event.target.value)}
                      aria-label={t('itemCriteria.selectionFilter')}
                      placeholder={t('itemCriteria.selectionAll')}
                    >
                      <option value="all">{t('itemCriteria.selectionAll')}</option>
                      <option value="selected">{t('itemCriteria.selectionSelected')}</option>
                      <option value="unselected">{t('itemCriteria.selectionUnselected')}</option>
                    </StandardDropdown>
                  </div>
                  {controller.filteredCriteria.length === 0 ? (
                    <div className="rules-panel__empty-hint">
                      <strong>{t('itemCriteria.noCriteriaMatchTitle')}</strong>
                      <span>{t('itemCriteria.noCriteriaMatchDesc')}</span>
                    </div>
                  ) : (
                    <div className="quality-vendor-grid" role="group" aria-label={t('itemCriteria.criteria')}>
                      {controller.filteredCriteria.map((criterion) => (
                        <CriterionCard
                          key={criterion.id}
                          criterion={criterion}
                          selected={controller.selectedCriterionIds.includes(criterion.id)}
                          onToggle={controller.toggleCriterion}
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="wizard-nav-row" style={{ justifyContent: 'flex-end', marginTop: '18px' }}>
                <button
                  type="button"
                  className="app-button app-button--primary"
                  onClick={controller.saveMappings}
                  disabled={controller.saving || controller.criteriaLoading || controller.mappingsLoading || !controller.selectedStageId}
                >
                  {controller.saving ? t('common.working') : t('itemCriteria.saveMappings')}
                </button>
              </div>
            </>
          ) : (
            <div className="rules-panel__empty-hint">
              <strong>{controller.selectedStageId ? t('itemCriteria.selectItemTitle') : t('itemCriteria.selectStageTitle')}</strong>
              <span>{controller.selectedStageId ? t('itemCriteria.selectItemDesc') : t('itemCriteria.selectStageDesc')}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default ItemCriteriaMappingPage;
