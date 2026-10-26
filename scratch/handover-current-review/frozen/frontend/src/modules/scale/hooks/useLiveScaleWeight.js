import { useState, useEffect, useRef, useCallback } from 'react';
import scaleApi from '../services/scaleApi';

export function useLiveScaleWeight(deviceId, pollingIntervalMs = 750) {
  const [weight, setWeight] = useState(0.0);
  const [weightFormatted, setWeightFormatted] = useState('0.00');
  const [isStable, setIsStable] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [deviceName, setDeviceName] = useState(deviceId || 'Scale');
  const [dataAgeSeconds, setDataAgeSeconds] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const activeRef = useRef(0);

  const fetchLiveWeight = useCallback(async () => {
    if (!deviceId) return;
    const generation = activeRef.current;
    try {
      const res = await scaleApi.getLiveWeight(deviceId);
      if (res && res.success && res.data && generation === activeRef.current) {
        const d = res.data;
        setWeight(Number(d.weight || 0));
        setWeightFormatted(d.weight_formatted || Number(d.weight || 0).toFixed(2));
        setIsStable(Boolean(d.is_stable));
        setIsOnline(Boolean(d.is_online));
        setDeviceName(d.device_name || deviceId || 'Scale');
        setDataAgeSeconds(d.data_age_seconds !== undefined ? d.data_age_seconds : null);
        setError(d.error || null);
        setIsLoading(false);
      }
    } catch (err) {
      if (generation === activeRef.current) {
        setIsOnline(false);
        setIsStable(false);
        setError(err?.response?.data?.error || err.message || 'Scale connection error');
        setIsLoading(false);
      }
    }
  }, [deviceId]);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      setWeight(0);
      setWeightFormatted('0.00');
      setIsOnline(false);
      setIsStable(false);
      setDeviceName(deviceId || 'Scale');
      setDataAgeSeconds(null);
      setError(null);
      setIsLoading(Boolean(deviceId));
      fetchLiveWeight();
    }, 0);

    const timer = setInterval(() => {
      fetchLiveWeight();
    }, pollingIntervalMs);

    return () => {
      activeRef.current += 1;
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [deviceId, fetchLiveWeight, pollingIntervalMs]);

  return {
    weight,
    weightFormatted,
    isStable,
    isOnline,
    canRecordWeight: isOnline && isStable && weight > 0,
    deviceName,
    dataAgeSeconds,
    error,
    isLoading,
    refresh: fetchLiveWeight,
  };
}

export default useLiveScaleWeight;
