export function rulesForSelectedStage(rules, stage) {
  return rules.filter((rule) => rule.is_active && (
    rule.stage === stage || (rule.stage === 'BOTH' && ['STAGE_1_TO_INTERMEDIATE', 'STAGE_2_TO_FRIDGE'].includes(stage))
  ));
}

export function staleRulesForSelectedStage(rules, stage, desiredKeys) {
  return rules.filter((rule) => rule.stage === stage && (
    !desiredKeys.has(`${rule.warehouse_code}|${rule.direction}|${rule.stage}`)
  ));
}

export function filterWarehouses(warehouses, search) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return warehouses;
  return warehouses.filter((warehouse) => [
    warehouse.code,
    warehouse.name,
    warehouse.name_ar,
    warehouse.name_en,
  ].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)));
}
