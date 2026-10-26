// Browser-only regression fixture; never imported by the application.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SignaturePad } from '../../src/modules/scale/components/SignaturePad';
import { ActionIconButton } from '../../src/components/ui/ActionIconButton';
import { ScalePrintableTicket } from '../../src/modules/scale/components/ScalePrintableTicket';

// eslint-disable-next-line react-refresh/only-export-components -- Test-only module exports mount controllers, not an application HMR boundary.
function Harness() {
  const [value, setValue] = useState(null);
  return <section id="responsive-harness" style={{ width: '240px', background: 'white', color: 'black' }}>
    <h1>Responsive test</h1>
    <p><span id="print-probe">Print typography</span></p>
    <input className="app-input" aria-label="Test input" />
    <ActionIconButton label="Inspect" icon="+" />
    <button className="app-button app-button--compact">Compact action</button>
    <SignaturePad value={value} onChange={(next) => {
      window.signatureChanges = (window.signatureChanges || 0) + 1;
      window.signatureValue = next;
      if (next) window.recordedSignature = next;
      setValue(next);
    }} />
    <button id="restore-signature" onClick={() => setValue(window.recordedSignature)}>Restore fixture</button>
  </section>;
}

export function mountTicket() {
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<ScalePrintableTicket draft={{
    id: 1, draft_number: 'AUDIT-PRINT-001', status: 'COMPLETED',
    created_at: '2026-10-19T10:00:00Z', vehicle_number: 'TEST-123',
    net_weight_loaded: 22345, net_weight_empty: 10000, product_weight: 12345,
    allocations: [], draft_elements: [],
  }} />);
}

export function mount() {
  document.querySelector('#root').style.display = 'none';
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<Harness />);
}
