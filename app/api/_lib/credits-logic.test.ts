import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentBalance, parseLedgerInput, shouldAlertLow, summarizeBalances, type LedgerRow } from './credits-logic.ts';

const rows: LedgerRow[] = [
  { id: 1, provider: 'replicate', kind: 'balance', amount_usd: 50 },
  { id: 2, provider: 'replicate', kind: 'spend', amount_usd: 12.5 },
  { id: 3, provider: 'fal', kind: 'spend', amount_usd: 3 },
];

test('currentBalance subtracts spends after the latest balance entry', () => {
  assert.equal(currentBalance(rows, 'replicate'), 37.5);
  assert.equal(currentBalance(rows, 'fal'), null);
});

test('summarizeBalances flags providers under the $10 threshold', () => {
  const low = summarizeBalances([
    { id: 1, provider: 'replicate', kind: 'balance', amount_usd: 9 },
    { id: 2, provider: 'fal', kind: 'balance', amount_usd: 40 },
  ]);
  assert.equal(low.find((p) => p.provider === 'replicate')?.low, true);
  assert.equal(low.find((p) => p.provider === 'fal')?.low, false);
});

test('shouldAlertLow fires only when crossing below $10', () => {
  assert.equal(shouldAlertLow(15, 9), true);
  assert.equal(shouldAlertLow(null, 4), true);
  assert.equal(shouldAlertLow(9, 5), false);
  assert.equal(shouldAlertLow(15, 10), false);
  assert.equal(shouldAlertLow(15, null), false);
});

test('parseLedgerInput validates provider, kind, and amount', () => {
  const ok = parseLedgerInput({ provider: 'fal', kind: 'balance', amountUsd: '25.123456', note: ' top up ' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value, { provider: 'fal', kind: 'balance', amountUsd: 25.1235, note: 'top up' });
  assert.equal(parseLedgerInput({ provider: 'openai', kind: 'balance', amountUsd: 1 }).ok, false);
  assert.equal(parseLedgerInput({ provider: 'fal', kind: 'refund', amountUsd: 1 }).ok, false);
  assert.equal(parseLedgerInput({ provider: 'fal', kind: 'spend', amountUsd: -1 }).ok, false);
  assert.equal(parseLedgerInput({ provider: 'fal', kind: 'spend', amountUsd: 'abc' }).ok, false);
  assert.equal(parseLedgerInput(null).ok, false);
});
