import React, { useEffect, useState } from 'react';
import { subscribeToNetworkActivity } from '../../services/api';

/**
 * AppTopBarProgress: Slim, non-intrusive top progress indicator.
 * Displays at the very top of the window during any active background API requests,
 * ensuring users always have immediate feedback that the application is busy communicating,
 * without obstructing clicks or freezing the screen.
 */
export default function AppTopBarProgress() {
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToNetworkActivity((busy) => {
      setIsBusy(busy);
    });
    return unsubscribe;
  }, []);

  if (!isBusy) return null;

  return (
    <div className="app-top-bar-progress" aria-hidden="true" role="progressbar" aria-label="Network Activity">
      <div className="app-top-bar-progress__bar" />
    </div>
  );
}
