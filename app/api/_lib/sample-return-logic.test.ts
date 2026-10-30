import test from 'node:test';
import assert from 'node:assert/strict';
import { daysBetweenIso, isSampleStale, selectStaleSamplesToAlert, staleSampleDays, type StaleSampleRow } from './sample-return-logic.ts';

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

test('sample becomes stale after 30 days with no client movement', () => {
  assert.equal(isSampleStale(base, '2026-01-30'), false);
  assert.equal(isSampleStale(base, '2026-01-31'), true);
});

test('recent client activity resets the stale clock', () => {
  const active = { ...base, last_client_activity_at: '2026-01-20T08:00:00Z' };
  assert.equal(staleSampleDays(active, '2026-01-31'), 11);
  assert.equal(isSampleStale(active, '2026-01-31'), false);
});

test('returned samples are never stale', () => {
  assert.equal(isSampleStale({ ...base, status: 'RETURNED' }, '2026-06-01'), false);
});

test('already-alerted samples are skipped for the day', () => {
  const alerted = { ...base, stale_alert_on: '2026-02-01' };
  const pending = selectStaleSamplesToAlert([base, alerted], '2026-02-01');
  assert.deepEqual(pending.map((row) => row.id), ['s1']);
});
