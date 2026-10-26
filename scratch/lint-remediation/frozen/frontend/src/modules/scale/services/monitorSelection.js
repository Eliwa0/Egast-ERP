export function selectMonitorDevice(devices, currentId) {
  if (devices.some((device) => device.device_id === currentId)) return currentId;
  const preferred = devices.find((device) => device.is_active && device.device_type === 'local')
    || devices.find((device) => device.is_active) || devices[0];
  return preferred?.device_id || null;
}
