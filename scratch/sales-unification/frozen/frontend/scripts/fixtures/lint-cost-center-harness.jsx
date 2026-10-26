import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import useCostCenterOptions from '../../src/hooks/useCostCenterOptions';

export function CostCenterProbe() {
  const value = useCostCenterOptions();
  const [tick, setTick] = useState(0);
  return <><pre data-testid="cost-state">{JSON.stringify(value)}</pre>
    <button onClick={() => value.reloadCostCenter(1)}>Reload location</button>
    <button onClick={() => setTick(tick + 1)}>Render {tick}</button></>;
}
createRoot(document.getElementById('root')).render(<CostCenterProbe />);
