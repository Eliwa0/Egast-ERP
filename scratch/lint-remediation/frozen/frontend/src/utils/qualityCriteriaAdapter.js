const CATEGORY_STYLE_BY_CODE = {
  PEST: { key: 'pests', className: 'pests', icon: '', barClass: 'bar-pest' },
  MECH: { key: 'mechanical', className: 'mechanical', icon: '', barClass: 'bar-mechanical' },
  PHYS: { key: 'others', className: 'others', icon: '', barClass: 'bar-other' },
  GRADE: { key: 'grades', className: 'others', icon: '', barClass: 'bar-other' },
};

const fallbackStyleForIndex = (index) => {
  if (index === 0) return { key: 'pests', className: 'pests', icon: '', barClass: 'bar-pest' };
  if (index === 1) return { key: 'mechanical', className: 'mechanical', icon: '', barClass: 'bar-mechanical' };
  if (index === 2) return { key: 'others', className: 'others', icon: '', barClass: 'bar-other' };
  return { key: `category-${index + 1}`, className: 'others', icon: '', barClass: 'bar-other' };
};

export function adaptInspectionCriteriaCategories(groupedCategories = []) {
  return groupedCategories.reduce((result, entry, index) => {
    const category = entry.category || {};
    const configuredStyle = CATEGORY_STYLE_BY_CODE[String(category.code || '').toUpperCase()] || fallbackStyleForIndex(index);
    const key = result[configuredStyle.key] ? `category-${category.id || index + 1}` : configuredStyle.key;
    result[key] = {
      titleKey: '',
      titleDefault: category.name_ar || category.name_en || category.code || key,
      titleAr: category.name_ar || '',
      titleEn: category.name_en || '',
      class: configuredStyle.className,
      icon: configuredStyle.icon,
      barClass: configuredStyle.barClass,
      items: (entry.criteria || [])
        .filter((criterion) => criterion.calculation_key)
        .map((criterion) => ({
          id: criterion.id,
          key: criterion.calculation_key,
          code: criterion.code,
          name: criterion.name_en || criterion.name_ar || criterion.code,
          nameAr: criterion.name_ar || '',
          nameEn: criterion.name_en || '',
        })),
    };
    return result;
  }, {});
}

export function createDefectTemplate(defectCategories = {}) {
  return Object.values(defectCategories).reduce((template, category) => {
    (category.items || []).forEach((item) => {
      template[item.key] = 0;
    });
    return template;
  }, {});
}
