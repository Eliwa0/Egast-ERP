const by = (valueKey, nameKey) => (row) => ({
  value: String(row[valueKey] ?? ''),
  label: `${row[valueKey]} - ${row[nameKey] || row[valueKey]}`,
  raw: row,
});

export const warehouseSearch = {
  endpoint: '/warehouses/', collection: 'warehouses', browse: true, mapOption: by('code', 'name'),
};
export const transferWarehouseSearch = { ...warehouseSearch, endpoint: '/transfer/warehouses/' };
export const farmSearch = {
  endpoint: '/quality/farms/', collection: 'farms', mapOption: by('farmCode', 'farmName'),
};
export const contractorSearch = {
  endpoint: '/quality/contractors/', collection: 'contractors', mapOption: by('contractorCode', 'contractorName'),
};
export const scaleFarmSearch = { ...farmSearch, endpoint: '/scale/master-data/farms/' };
export const customerSearch = {
  endpoint: '/customization-delivery/customers/', collection: 'customers', mapOption: by('card_code', 'card_name'),
};
export const itemSearch = {
  endpoint: '/quality/items/', collection: 'items', browse: true, mapOption: by('item_code', 'item_name'),
};
export const scaleItemSearch = { ...itemSearch, endpoint: '/scale/master-data/items/' };
export const salesItemSearch = { ...itemSearch, endpoint: '/customization-delivery/items/' };
export const userSearch = {
  endpoint: '/admin/users/', collection: 'users', browse: true, mapOption: by('id', 'username'),
};
export function binSearch(warehouse, { valueKey = 'code', physicalOnly = false } = {}) {
  return {
    endpoint: `/bin-locations/${encodeURIComponent(warehouse)}/`, collection: 'locations',
    browse: true,
    mapOption: (row) => ({ ...by(valueKey, 'name')(row),
      label: `${row.code} - ${row.name || row.code}`,
      disabled: physicalOnly && (row.inactive || row.is_system_bin || !row.absEntry || row.warehouse !== warehouse),
    }),
  };
}
