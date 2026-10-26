import React from 'react';

export default function EmptyState({ icon = 'i', title, message, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        {title && <h3>{title}</h3>}
        {message && <p>{message}</p>}
      </div>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
