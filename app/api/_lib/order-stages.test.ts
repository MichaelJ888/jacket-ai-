import assert from 'node:assert/strict';
import test from 'node:test';

import { canTransition, defaultDepositAmount } from './order-stages.ts';

test('stages only move forward and may skip', () => {
  assert.equal(canTransition('PO_DRAFTED', 'CUTTING'), true);
  assert.equal(canTransition('CUTTING', 'SEWING'), true);
  assert.equal(canTransition('SEWING', 'CUTTING'), false);
  assert.equal(canTransition('QC', 'QC'), false);
});

test('hold and cancel are reachable, closed orders are final', () => {
  assert.equal(canTransition('SEWING', 'ON_HOLD'), true);
  assert.equal(canTransition('ON_HOLD', 'CUTTING'), true);
  assert.equal(canTransition('COMPLETED', 'ON_HOLD'), false);
  assert.equal(canTransition('CANCELLED', 'CUTTING'), false);
  assert.equal(canTransition('CUTTING', 'BOGUS'), false);
});

test('default deposit is 50% rounded to centavos', () => {
  assert.equal(defaultDepositAmount(10001), 5000.5);
  assert.equal(defaultDepositAmount(-5), 0);
});
