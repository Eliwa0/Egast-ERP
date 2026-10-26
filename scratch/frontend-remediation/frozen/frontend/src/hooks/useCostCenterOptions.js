import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCostCenters } from '../services/purchaseGrpoService';
import { loadWithRetry, mergeCostCenterLoad } from '../services/costCenterLoader';

const INITIAL = {
  costCentersDim1: [],
  costCentersDim2: [],
  costCentersLoading: true,
  costCenterError1: null,
  costCenterError2: null,
};

export default function useCostCenterOptions() {
  const [state, setState] = useState(INITIAL);
  const latestRequest = useRef({});

  const requestDimension = useCallback((dimension) => {
    const nonce = Date.now();
    latestRequest.current[dimension] = nonce;
    setState((prev) => ({ ...prev, costCentersLoading: true }));

    loadWithRetry(() => loadCostCenters(dimension))
      .then((rows) => {
        if (latestRequest.current[dimension] !== nonce) return;
        setState((prev) =>
          mergeCostCenterLoad(
            { ...prev, costCentersLoading: false },
            { domain: 'cost-center', dimension, status: 'ok', rows },
          ),
        );
      })
      .catch((err) => {
        if (latestRequest.current[dimension] !== nonce) return;
        setState((prev) =>
          mergeCostCenterLoad(
            { ...prev, costCentersLoading: false },
            { domain: 'cost-center', dimension, status: 'error', error: err },
          ),
        );
      });
  }, []);

  useEffect(() => {
    requestDimension(1);
    requestDimension(2);
    return () => {
      latestRequest.current = {};
    };
  }, [requestDimension]);

  const reloadCostCenter = useCallback(
    (dimension) => {
      requestDimension(dimension);
    },
    [requestDimension],
  );

  return {
    costCentersDim1: state.costCentersDim1,
    costCentersDim2: state.costCentersDim2,
    costCentersLoading: state.costCentersLoading,
    costCenterError1: state.costCenterError1,
    costCenterError2: state.costCenterError2,
    reloadCostCenter,
  };
}