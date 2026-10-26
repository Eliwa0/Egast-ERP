const results = new Map();
const pending = new Map();
const pendingReads = new Map();
const TTL = 60_000;

export function clearSearchCache() {
  results.clear();
  pending.clear();
  pendingReads.clear();
}

// Merge simultaneous reads only; a later Refresh always makes a fresh request.
export function deduplicatePendingRead(key, loader) {
  if (pendingReads.has(key)) return pendingReads.get(key);
  const task = Promise.resolve().then(loader).finally(() => {
    if (pendingReads.get(key) === task) pendingReads.delete(key);
  });
  pendingReads.set(key, task);
  return task;
}

async function cachedResult(key, loader, valid) {
  const hit = results.get(key);
  if (hit && hit.expires > Date.now()) return hit.rows;
  if (pending.has(key)) return pending.get(key);
  const task = Promise.resolve().then(loader).then((rows) => {
    if (!valid(rows)) throw new Error('Invalid search response');
    if (results.size >= 200) results.delete(results.keys().next().value);
    results.set(key, { rows, expires: Date.now() + TTL });
    return rows;
  }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
  pending.set(key, task);
  return task;
}

export const cachedSearch = (key, loader) => cachedResult(key, loader, Array.isArray);
export const cachedSearchPage = (key, loader) => cachedResult(`page:${key}`, loader,
  (page) => Array.isArray(page?.rows) && (page.nextOffset === null || Number.isInteger(page.nextOffset)));
