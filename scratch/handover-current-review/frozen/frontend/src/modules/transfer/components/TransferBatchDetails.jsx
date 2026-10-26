import React from 'react';
import { TransferFieldLabels } from '../types/transferTypes';
import { getProductIcon } from '../../../utils/productIcon';

const detailFields = [
  ['itemCode', TransferFieldLabels.itemCode, '🏷️'],
  ['itemName', TransferFieldLabels.itemName, '📦'],
  ['batchNumber', TransferFieldLabels.batchNumber, '🏷️'],
  ['uom', TransferFieldLabels.uom, '⚖️'],
  ['expiryDate', TransferFieldLabels.expiryDate, '📅'],
  ['productionOrderNo', TransferFieldLabels.productionOrderNo, '📋'],
  ['receiptFromProductionDocNum', TransferFieldLabels.receiptFromProductionDocNum, '📝'],
];

function formatDetailValue(batchDetails, key) {
  return batchDetails[key] || 'Not available';
}

function TransferBatchDetails({ batchDetails, selectedSource }) {
  if (!batchDetails) {
    return (
      <div className="transfer-empty-state">
        Select a destination warehouse, then scan or enter a batch number and press Enter.
      </div>
    );
  }

  return (
    <div className="details-grid transfer-details-grid">
      {detailFields.map(([key, label, icon]) => {
        const resolvedIcon = key === 'itemName'
          ? getProductIcon(batchDetails.itemName || batchDetails.itemCode)
          : icon;
        return (
          <div className="detail-item" key={key}>
            <span className="detail-item__label">
              <span className="meta-label-icon" aria-hidden="true">{resolvedIcon}</span>
              {label}
            </span>
            <span className="detail-item__value">
              {formatDetailValue(batchDetails, key)}
            </span>
          </div>
        );
      })}
      <div className="detail-item">
        <span className="detail-item__label">
          <span className="meta-label-icon" aria-hidden="true">🏭</span>
          From Warehouse
        </span>
        <span className="detail-item__value">
          {selectedSource
            ? `${selectedSource.fromWarehouse}${selectedSource.fromWarehouseName ? ` - ${selectedSource.fromWarehouseName}` : ''}`
            : 'Select source'}
        </span>
      </div>
      <div className="detail-item">
        <span className="detail-item__label">
          <span className="meta-label-icon" aria-hidden="true">📍</span>
          From Bin/Location
        </span>
        <span className="detail-item__value">
          {selectedSource?.fromBin || 'Not available'}
        </span>
      </div>
      <div className="detail-item">
        <span className="detail-item__label">
          <span className="meta-label-icon" aria-hidden="true">📊</span>
          Available Quantity
        </span>
        <span className="detail-item__value">
          {selectedSource ? `${selectedSource.availableQuantity} ${batchDetails.uom}` : 'Select source'}
        </span>
      </div>
    </div>
  );
}

export default TransferBatchDetails;
