import { cachedSearchPage } from './searchCache.js';

export const SEARCH_PAGE_SIZE = 25;

export function fetchOptionsPage(api, { endpoint, collection, params, browse, query, scope, offset = 0 }) {
  const key = JSON.stringify([scope, endpoint, collection, params, browse, query, offset]);
  return cachedSearchPage(key, async () => {
    const response = await api.get(endpoint, { params: { ...params, lookup: 1, search: query,
      limit: SEARCH_PAGE_SIZE, offset, ...(browse ? { initial: 1, browse: 1 } : {}) } });
    if (response.data?.success === false) throw new Error('Search failed');
    const payload = response.data?.data ?? response.data;
    const rows = payload?.[collection];
    if (!Array.isArray(rows) || rows.length > SEARCH_PAGE_SIZE) throw new Error('Invalid search response');
    const next = payload.next_offset;
    if (next !== undefined && next !== null && (!Number.isInteger(next) || next <= offset)) throw new Error('Invalid next page');
    return { rows, nextOffset: next ?? null };
  });
}

export function mergeOptionRows(previous, incoming, mapOption) {
  const key = (row) => String(mapOption ? mapOption(row).value : row.code ?? row.id ?? row.item_code ?? row.card_code ?? row.farmCode ?? row.contractorCode ?? row.batch_number);
  return [...new Map([...previous, ...incoming].map((row) => [key(row), row])).values()];
}
