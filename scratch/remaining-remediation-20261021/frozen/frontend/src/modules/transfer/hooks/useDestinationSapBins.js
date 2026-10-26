import { useEffect, useState } from 'react';
import { fetchDestinationSapBins } from '../services/transferService';

export default function useDestinationSapBins(warehouse, enabled) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!enabled || !warehouse) return;
    let cancelled = false;
    fetchDestinationSapBins(warehouse).then(data => {
      if (!cancelled) setResult({ warehouse, data });
    }).catch(() => {
      if (!cancelled) setResult({ warehouse, error: true });
    });
    return () => { cancelled = true; };
  }, [warehouse, enabled]);
  const current = enabled && result?.warehouse === warehouse ? result : null;
  return {
    loading: Boolean(enabled && warehouse && !current),
    error: Boolean(current?.error),
    required: current?.data?.requires_bin === true,
    bins: current?.data?.locations || [],
  };
}
