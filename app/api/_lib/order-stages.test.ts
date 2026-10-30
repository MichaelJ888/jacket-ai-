import assert from 'node:assert/strict';
import test from 'node:test';

import { canTransition, defaultDepositAmount, requiresDepositFirst, DEFAULT_ORDER_STAGE } from './order-stages.ts';

test('stages only move forward and may skip', () => {
  assert.equal(canTransition('S02_SOURCING', 'S08_PRODUCTION'), true);
  assert.equal(canTransition('S08_PRODUCTION', 'S09_QC'), true);
  assert.equal(canTransition('S09_QC', 'S08_PRODUCTION'), false);
  assert.equal(canTransition('S09_QC', 'S09_QC'), false);
  assert.equal(canTransition('S11_DISPATCH', 'COMPLETED'), true);
  assert.equal(canTransition('S08_PRODUCTION', 'COMPLETED'), false);
});

test('production cannot start before the down payment (Stage 05)', () => {
  assert.equal(DEFAULT_ORDER_STAGE, 'S05_DEPOSIT');
  assert.equal(requiresDepositFirst('S05_DEPOSIT', 'S06_SIZING'), true);
  assert.equal(requiresDepositFirst('S04_QUOTATION', 'S08_PRODUCTION'), true);
  assert.equal(requiresDepositFirst('S01_INQUIRY', 'S05_DEPOSIT'), false);
  assert.equal(requiresDepositFirst('S06_SIZING', 'S08_PRODUCTION'), false);
});

test('hold and cancel are reachable, closed orders are final', () => {
  assert.equal(canTransition('S08_PRODUCTION', 'ON_HOLD'), true);
  assert.equal(canTransition('ON_HOLD', 'S08_PRODUCTION'), true);
  assert.equal(canTransition('COMPLETED', 'ON_HOLD'), false);
  assert.equal(canTransition('CANCELLED', 'S08_PRODUCTION'), false);
  assert.equal(canTransition('S08_PRODUCTION', 'BOGUS'), false);
});

test('default deposit is 50% rounded to centavos', () => {
  assert.equal(defaultDepositAmount(10001), 5000.5);
  assert.equal(defaultDepositAmount(-5), 0);
});
