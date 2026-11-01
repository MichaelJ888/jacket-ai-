import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLICATE_BILLING_MESSAGE, ReplicateBillingError, isReplicateBillingFailure } from './replicate.ts';
import { formatManila } from './manila-time.ts';

test('402 responses are billing failures', () => {
  assert.equal(isReplicateBillingFailure(402, null), true);
});

test('billing wording in provider detail is a billing failure', () => {
  assert.equal(isReplicateBillingFailure(null, 'Insufficient credit. Add billing to continue.'), true);
  assert.equal(isReplicateBillingFailure(422, 'Payment required'), true);
});

test('unrelated errors are not billing failures', () => {
  assert.equal(isReplicateBillingFailure(500, 'Internal error'), false);
  assert.equal(isReplicateBillingFailure(401, 'Invalid token'), false);
});

test('billing error carries the top-up message', () => {
  const error = new ReplicateBillingError();
  assert.equal(error.message, REPLICATE_BILLING_MESSAGE);
  assert.match(error.message, /replicate\.com\/account\/billing/);
});

test('formatManila renders UTC instants in Philippine Time', () => {
  // 2026-01-01T00:00Z is 08:00 on 2026-01-01 in Manila.
  assert.match(formatManila('2026-01-01T00:00:00Z'), /8:00/);
});
