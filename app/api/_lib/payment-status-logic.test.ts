import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAITING_SLIP, isPaymentStatusQuery, paymentQueryRef, paymentState } from './payment-status-logic.ts';

test('detects payment questions and extracts a client reference', () => {
  assert.equal(isPaymentStatusQuery('DP status Panasonic'), true);
  assert.equal(isPaymentStatusQuery('Nabayaran na ba ang down payment ng Globe?'), true);
  assert.equal(isPaymentStatusQuery('Magkano ang minimum order?'), false);
  assert.equal(typeof paymentQueryRef('DP status Panasonic'), 'string');
});

test('payment state never reports received without evidence', () => {
  assert.equal(AWAITING_SLIP.length > 0, true);
  const state = paymentState({ deposit_amount: 5000 } as never, null, false);
  assert.notEqual(state, 'RECEIVED_VERIFIED');
  assert.notEqual(state, 'RECEIVED_LEDGER');
});
