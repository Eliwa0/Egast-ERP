import assert from 'node:assert';
import fs from 'node:fs';

const workflow = fs.readFileSync('src/modules/transfer/hooks/useTransferWorkflow.js', 'utf8');
const page = fs.readFileSync('src/modules/transfer/pages/TransferPage.jsx', 'utf8');
const map = fs.readFileSync('src/modules/transfer/components/ColdStorageMap.jsx', 'utf8');

const setToBinBody = workflow.match(/const setToBin = \(code\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
assert(setToBinBody.includes('setPalletPositionIdState(null)'));
assert(setToBinBody.includes("setPalletPositionCodeState('')"));

const setToWarehouseBody = workflow.match(/const setToWarehouse = \(code\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
assert(setToWarehouseBody.includes('setPalletPositionIdState(null)'));
assert(setToWarehouseBody.includes("setPalletPositionCodeState('')"));

assert(workflow.includes('(!destinationPalletPositionRequired || Boolean(palletPositionId))'));
assert(page.includes('(!destinationPalletPositionRequired || Boolean(palletPositionId))'));
assert(map.includes("if (!selectedPositionId) {\n      setSelectedPosition(null);"));

let state = {
  toBin: 'BIN-A',
  palletPositionId: 10,
  palletPositionCode: 'BIN-A-01',
};
function changeBin(code) {
  state = { ...state, toBin: code, palletPositionId: null, palletPositionCode: '' };
}
changeBin('BIN-B');
assert.equal(state.palletPositionId, null);
assert.equal(state.palletPositionCode, '');

function selectPosition(position) {
  state = {
    ...state,
    toBin: position.bin_code,
    palletPositionId: position.id,
    palletPositionCode: position.position_code,
  };
}
selectPosition({ id: 20, position_code: 'BIN-B-01', bin_code: 'BIN-B' });
assert.deepEqual(
  [state.toBin, state.palletPositionId, state.palletPositionCode],
  ['BIN-B', 20, 'BIN-B-01'],
);

assert(page.includes("{!isPhysicalStage && palletPositionCode && ("));
assert(page.includes("t('transfer.physicalPosition')"));
assert(page.includes('{palletPositionCode}'));

console.log('Stage 2 destination position frontend integrity checks passed.');
