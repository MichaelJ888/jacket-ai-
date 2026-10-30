import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetweenIso,
  isDownPaymentPaid,
  isSampleDue,
  isSampleStale,
  samplesWithPaidDownPayment,
  selectStaleSamplesToAlert,
  STALE_SAMPLE_DAYS,
  staleSampleDays,
  type StaleSampleRow,
} from './sample-return-logic.ts';

const base: StaleSampleRow = {
  id: 's1',
  item: 'Jacket sample',
  quantity: 1,
  client_name: 'Client A',
  contact_phone: null,
  status: 'OUT',
  sent_at: '2026-01-01',
  last_client_activity_at: null,
  stale_alert_on: null,
};

test('daysBetweenIso counts calendar days', () => {
  assert.equal(daysBetweenIso('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysBetweenIso('2026-02-27', '2026-03-01'), 2);
});

test('sample becomes stale after 14 days (2 weeks) with no client movement', () => {
  assert.equal(STALE_SAMPLE_DAYS, 14);
  assert.equal(isSampleStale(base, '2026-01-14'), false);
  assert.equal(isSampleStale(base, '2026-01-15'), true);
});

test('recent client activity resets the stale clock', () => {
  const active = { ...base, last_client_activity_at: '2026-01-10T08:00:00Z' };
  assert.equal(staleSampleDays(active, '2026-01-15'), 5);
  assert.equal(isSampleStale(active, '2026-01-15'), false);
});

test('returned samples are never stale or due', () => {
  assert.equal(isSampleStale({ ...base, status: 'RETURNED' }, '2026-06-01'), false);
  assert.equal(isSampleDue({ ...base, status: 'RETURNED' }, '2026-06-01', true), false);
});

test('a sample is due immediately when the client has paid the down payment', () => {
  const recent = { ...base, sent_at: '2026-01-14' };
  assert.equal(isSampleDue(recent, '2026-01-15', false), false);
  assert.equal(isSampleDue(recent, '2026-01-15', true), true);
});

test('down payment counts as paid from Stage 06 onward, COMPLETED, or with a verification id', () => {
  const order = { id: 'o1', client_name: 'Client A', stage: 'S04_QUOTATION', deposit_verification_id: null };
  assert.equal(isDownPaymentPaid(order), false);
  assert.equal(isDownPaymentPaid({ ...order, stage: 'S05_DEPOSIT' }), false);
  assert.equal(isDownPaymentPaid({ ...order, stage: 'S06_SIZING' }), true);
  assert.equal(isDownPaymentPaid({ ...order, stage: 'COMPLETED' }), true);
  assert.equal(isDownPaymentPaid({ ...order, deposit_verification_id: 'v1' }), true);
  assert.equal(isDownPaymentPaid({ ...order, stage: 'CANCELLED', deposit_verification_id: 'v1' }), false);
});

test('paid-DP samples are matched by order_id, or by client name when no order_id is set', () => {
  const orders = [
    { id: 'o1', client_name: 'Client A', stage: 'S07_SAMPLE', deposit_verification_id: null },
    { id: 'o2', client_name: 'client b ', stage: 'S05_DEPOSIT', deposit_verification_id: null },
  ];
  const samples = [
    { id: 'byOrder', client_name: 'Other', order_id: 'o1' },
    { id: 'byName', client_name: 'CLIENT A', order_id: null },
    { id: 'unpaid', client_name: 'client b', order_id: null },
    { id: 'orderUnpaid', client_name: 'Client A', order_id: 'o2' },
  ];
  assert.deepEqual([...samplesWithPaidDownPayment(samples, orders)].sort(), ['byName', 'byOrder']);
});

test('selectStaleSamplesToAlert includes DP-paid samples before the idle threshold', () => {
  const fresh = { ...base, id: 's2', sent_at: '2026-01-14' };
  assert.deepEqual(selectStaleSamplesToAlert([fresh], '2026-01-15', new Set(['s2'])).map((row) => row.id), ['s2']);
  assert.deepEqual(selectStaleSamplesToAlert([fresh], '2026-01-15'), []);
});

test('already-alerted samples are skipped for the day', () => {
  const alerted = { ...base, stale_alert_on: '2026-02-01' };
  const pending = selectStaleSamplesToAlert([base, alerted], '2026-02-01');
  assert.deepEqual(pending.map((row) => row.id), ['s1']);
});
