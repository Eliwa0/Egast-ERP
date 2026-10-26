import axios from 'axios';
import { beginApiMeasurement, finishApiMeasurement, recordLoadingState } from './performanceMetrics.js';

const defaultBaseURL =
  typeof window !== 'undefined' && window.location.hostname
    ? `http://${window.location.hostname}:8000/api/`
    : 'http://172.20.10.5:8000/api/';

const API = axios.create({
  baseURL: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || defaultBaseURL,
  timeout: 30000,
  withCredentials: true,
});

let activeRequestCount = 0;
const activitySubscribers = new Set();

function notifyActivity() {
  const isBusy = activeRequestCount > 0;
  recordLoadingState(isBusy);
  for (const listener of activitySubscribers) {
    try {
      listener(isBusy, activeRequestCount);
    } catch (err) {
      console.error('[API Activity Listener Error]', err);
    }
  }
}

export function subscribeToNetworkActivity(callback) {
  activitySubscribers.add(callback);
  callback(activeRequestCount > 0, activeRequestCount);
  return () => {
    activitySubscribers.delete(callback);
  };
}

export function getActiveRequestCount() {
  return activeRequestCount;
}

// Interceptor لتعقب بدء الطلبات
API.interceptors.request.use(
  (config) => {
    beginApiMeasurement(config);
    if (!config?.skipGlobalLoading) {
      activeRequestCount++;
      notifyActivity();
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor للتعامل مع الأخطاء وانتهاء الطلبات
API.interceptors.response.use(
  (response) => {
    finishApiMeasurement(response.config, response.status);
    if (!response.config?.skipGlobalLoading) {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      notifyActivity();
    }
    return response;
  },
  (error) => {
    finishApiMeasurement(error.config, error.response?.status);
    if (!error.config?.skipGlobalLoading) {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      notifyActivity();
    }
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default API;
