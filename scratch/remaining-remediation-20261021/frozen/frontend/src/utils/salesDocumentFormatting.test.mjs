import assert from 'node:assert/strict';
import test from 'node:test';
import {formatMoney,formatQuantity} from './salesDocumentFormatting.js';
test('document formatting preserves absence, literal text, quantities and currency',()=>{
  for(const value of [null,undefined,'']){
    assert.equal(formatQuantity(value),'—');assert.equal(formatMoney(value,'EGP'),'—');
  }
  assert.equal(formatQuantity('ABC'),'ABC');assert.equal(formatMoney('ABC','EGP'),'ABC');
  assert.equal(formatQuantity(0),'0');assert.equal(formatQuantity('1250.5'),Number(1250.5).toLocaleString());
  const amount=Number(1250.5).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  assert.equal(formatMoney(1250.5,'EGP'),`${amount} EGP`);assert.equal(formatMoney(1250.5),amount);
});
