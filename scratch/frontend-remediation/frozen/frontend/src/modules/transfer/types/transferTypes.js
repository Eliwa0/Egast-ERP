export const TransferStatus = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
});

export const TransferStage = Object.freeze({
  STAGE_1_TO_INTERMEDIATE: 'STAGE_1_TO_INTERMEDIATE',
  STAGE_2_TO_FRIDGE: 'STAGE_2_TO_FRIDGE',
  STAGE_3_FROM_FRIDGE: 'STAGE_3_FROM_FRIDGE',
  STAGE_4_TO_DESTINATION: 'STAGE_4_TO_DESTINATION',
  STAGE_4_TO_SHIPPING_HALL: 'STAGE_4_TO_DESTINATION',
  STAGE_5_TO_CONTAINER: 'STAGE_5_TO_CONTAINER',
});

export const TransferFieldLabels = Object.freeze({
  itemCode: 'Item Code',
  itemName: 'Item Name',
  batchNumber: 'Batch Number',
  currentWarehouse: 'From Warehouse',
  availableQuantity: 'Available Quantity',
  uom: 'UOM',
  binLocation: 'From Bin/Location',
  expiryDate: 'Expiry Date',
  productionOrderNo: 'Production Order No',
  receiptFromProductionDocNum: 'Receipt From Production DocNum',
});
