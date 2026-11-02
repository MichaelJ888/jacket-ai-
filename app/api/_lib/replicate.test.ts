import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLICATE_BILLING_MESSAGE, ReplicateBillingError, isReplicateBillingFailure, replicateSpendUsd, type ReplicatePrediction } from './replicate.ts';
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

const spendPrediction = (seconds: number | null): ReplicatePrediction => ({ id: 'p1', status: 'succeeded', metrics: { predict_time: seconds } });
const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('replicateSpendUsd falls back to the A100 worst-case default rate when the env var is unset', () => {
  delete process.env.REPLICATE_USD_PER_SECOND;
  closeTo(replicateSpendUsd(spendPrediction(10)), 0.014);
});

test('replicateSpendUsd honors an explicit env rate; 0 disables recording', () => {
  process.env.REPLICATE_USD_PER_SECOND = '0.0005';
  closeTo(replicateSpendUsd(spendPrediction(10)), 0.005);
  process.env.REPLICATE_USD_PER_SECOND = '0';
  assert.equal(replicateSpendUsd(spendPrediction(10)), 0);
  delete process.env.REPLICATE_USD_PER_SECOND;
});

test('replicateSpendUsd returns 0 without measured GPU run time', () => {
  delete process.env.REPLICATE_USD_PER_SECOND;
  assert.equal(replicateSpendUsd(spendPrediction(null)), 0);
  assert.equal(replicateSpendUsd(spendPrediction(0)), 0);
});

test('formatManila renders UTC instants in Philippine Time', () => {
  // 2026-01-01T00:00Z is 08:00 on 2026-01-01 in Manila.
  assert.match(formatManila('2026-01-01T00:00:00Z'), /8:00/);
});
