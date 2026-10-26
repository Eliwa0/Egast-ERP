import React from 'react';
import { getProductIcon } from '../../../utils/productIcon';

const successRows = [
  ['batchNumber', 'Batch Number', '🏷️'],
  ['itemCode', 'Item Code', '🏷️'],
  ['quantity', 'Quantity Moved', '📊'],
  ['fromWarehouse', 'From Warehouse', '🏭'],
  ['fromBin', 'From Bin/Location', '📍'],
  ['destinationWarehouse', 'To Warehouse', '🏭'],
  ['destinationBin', 'Destination Bin', '📍'],
  ['docEntry', 'SAP Inventory Transfer DocEntry', '🔢'],
  ['docNum', 'SAP Inventory Transfer DocNum', '📋'],
];

function TransferSuccessSummary({ transfer }) {
  if (!transfer) return null;

  return (
    <div className="feedback-message feedback-message--success transfer-success-summary">
      <strong>
        {transfer.mock ? 'Mock SAP Inventory Transfer created.' : 'SAP Inventory Transfer posted.'}
      </strong>
      <div className="details-grid transfer-details-grid">
        {successRows.map(([key, label, icon]) => {
          const resolvedIcon = (key === 'itemCode' || key === 'itemName')
            ? getProductIcon(transfer.itemName || transfer.itemCode)
            : icon;
          return (
            <div className="detail-item" key={key}>
              <span className="detail-item__label">
                <span className="meta-label-icon" aria-hidden="true">{resolvedIcon}</span>
                {label}
              </span>
              <span className="detail-item__value">
                {key === 'quantity' ? `${transfer.quantity} ${transfer.uom}` : transfer[key]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TransferSuccessSummary;
