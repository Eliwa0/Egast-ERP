export const COST_CENTER_DIMENSIONS = {
  LOCATION: 1,
  GENERAL: 2,
};

export async function loadWithRetry(loadFn, { retries = 1, retryDelayMs = 700 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await loadFn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}

export function parseCostCenterRows(rows) {
  return Array.isArray(rows)
    ? rows
        .filter((row) => row && typeof row.code === 'string' && row.code.trim() !== '')
        .map((row) => ({ code: String(row.code).trim(), name: String(row.name || row.code).trim() }))
    : [];
}

export function costCenterKeys(dimension) {
  const dim = Number(dimension);
  if (dim === COST_CENTER_DIMENSIONS.LOCATION) {
    return { rows: 'costCentersDim1', error: 'costCenterError1' };
  }
  if (dim === COST_CENTER_DIMENSIONS.GENERAL) {
    return { rows: 'costCentersDim2', error: 'costCenterError2' };
  }
  return null;
}

export function mergeCostCenterLoad(prev, outcome) {
  if (!outcome || outcome.domain !== 'cost-center') {
    return prev;
  }
  const keys = costCenterKeys(outcome.dimension);
  if (!keys) {
    return prev;
  }
  if (outcome.status === 'error') {
    return { ...prev, [keys.error]: outcome.error };
  }
  return { ...prev, [keys.rows]: parseCostCenterRows(outcome.rows), [keys.error]: null };
}