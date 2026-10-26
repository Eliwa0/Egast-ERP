import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../services/api';
import { fetchOptionsPage, mergeOptionRows } from '../services/remoteOptions';
import { useAuth } from '../contexts/AuthContext';
const EMPTY_ROWS = [];

export default function useRemoteOptions(source, input, { enabled = true, minLength = 1, debounce = 300 } = {}) {
  const { user } = useAuth();
  const [state, setState] = useState({ rows: [], loading: false, error: false, key: '', nextOffset: null });
  const [retryCount, setRetryCount] = useState(0);
  const query = String(input || '').trim();
  const endpoint = source?.endpoint || '';
  const collection = source?.collection || '';
  const browse = source?.browse === true;
  const paramsKey = JSON.stringify(source?.params || {});
  const scope = JSON.stringify([user?.id, user?.username, user?.role, user?.module_permissions]);
  const key = JSON.stringify([scope, endpoint, collection, paramsKey, browse, query]);
  const ready = Boolean(endpoint && enabled && (browse || query.length >= minLength));
  const activeKey = useRef(null);
  const morePending = useRef(false);
  const sourceRef = useRef(source);
  useEffect(() => { sourceRef.current = source; });
  useEffect(() => {
    activeKey.current = ready ? key : null;
    morePending.current = false;
    if (!ready) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      setState({ rows: [], loading: true, error: false, key, nextOffset: null });
      fetchOptionsPage(API, { endpoint, collection, params: JSON.parse(paramsKey), browse, query, scope })
        .then((page) => { if (current) setState({ rows: page.rows, nextOffset: page.nextOffset, loading: false, error: false, key }); })
        .catch(() => { if (current) setState({ rows: [], loading: false, error: true, key, nextOffset: null }); });
    }, query ? debounce : 0);
    return () => { current = false; clearTimeout(timer); activeKey.current = null; };
  }, [key, ready, endpoint, collection, paramsKey, query, browse, scope, debounce, retryCount]);

  const loadMore = useCallback(() => {
    if (!ready || state.key !== key || state.nextOffset === null || state.loading || morePending.current) return;
    morePending.current = true;
    setState((previous) => ({ ...previous, loadingMore: true, error: false }));
    fetchOptionsPage(API, { endpoint, collection, params: JSON.parse(paramsKey), browse, query, scope, offset: state.nextOffset })
      .then((page) => {
        if (activeKey.current === key) setState((previous) => ({ ...previous,
          rows: mergeOptionRows(previous.rows, page.rows, sourceRef.current?.mapOption), nextOffset: page.nextOffset, loadingMore: false, error: false }));
      }).catch(() => {
        if (activeKey.current === key) setState((previous) => ({ ...previous, loadingMore: false, error: true }));
      }).finally(() => { if (activeKey.current === key) morePending.current = false; });
  }, [ready, state.key, state.nextOffset, state.loading, key, endpoint, collection, paramsKey, browse, query, scope]);

  const retry = () => state.key === key && state.rows.length && state.nextOffset !== null ? loadMore() : setRetryCount((value) => value + 1);
  const result = ready && state.key === key ? state : { rows: EMPTY_ROWS, loading: ready, error: false, nextOffset: null };
  return { ...result, loadMore, retry, hasMore: result.nextOffset !== null };
}
