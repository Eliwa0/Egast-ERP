import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createLatestRequestGuard } from '../utils/latestRequest';

export default function useWorkflowPagination(search, filterKey = '') {
  const [requestGuard] = useState(createLatestRequestGuard);
  const [position, setPosition] = useState({ key: filterKey, offset: 0 });
  const offset = position.key === filterKey ? position.offset : 0;
  const setOffset = useCallback(value => setPosition({ key: filterKey, offset: value }), [filterKey]);
  const [query, setQuery] = useState(search);
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => { setQuery(search); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setOffset]);
  const params = useMemo(() => ({ offset, page_size: 25, search: query }), [offset, query]);
  useLayoutEffect(() => {
    requestGuard.invalidate();
    return () => requestGuard.invalidate();
  }, [requestGuard, query, filterKey, offset]);
  return { params, info, setInfo, setOffset, requestGuard };
}
