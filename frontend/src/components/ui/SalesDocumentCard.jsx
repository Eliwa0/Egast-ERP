import React from 'react';
import '../../styles/pages/customization-delivery.css';

export default function SalesDocumentCard({children, className = '', active = false}) {
  return <div className={`card-panel sales-document-card${active ? ' sales-document-card--active' : ''}${className ? ` ${className}` : ''}`}>
    {children}
  </div>;
}
