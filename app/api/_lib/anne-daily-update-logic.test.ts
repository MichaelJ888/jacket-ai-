import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnneClientUpdate, isDailyUpdateDue, pendingSamplesFor, sampleBelongsToOrder, type DailySample } from './anne-daily-update-logic.ts';
import type { OpenOrder } from './client-pulse.ts';

const now = new Date('2026-11-01T00:00:00Z');

const order: OpenOrder = {
  id: 'o1',
  order_number: 'ORD-001',
  client_name: 'Reden',
  project_name: 'Coworking Jackets',
  quantity: 50,
  total_amount: 45000,
  stage: 'S05_DEPOSIT',
  updated_at: '2026-10-29T00:00:00Z',
  created_at: '2026-10-28T00:00:00Z',
};

const sample: DailySample = { id: 's1', item: 'Jacket', quantity: 2, client_name: 'reden', order_id: null, status: 'OUT' };

test('one update per client includes status, recent progress, and pending items', () => {
  const text = buildAnneClientUpdate(order, 0, 3, [sample], now);
  assert.match(text, /^<b>1\/3 · Reden<\/b> — Coworking Jackets/);
  assert.match(text, /Huling galaw: 3 araw na ang nakalipas/);
  assert.match(text, /Hinihintay ang 50% D\.P\./);
  assert.match(text, /Ibalik ang sample: Jacket × 2/);
});

test('a client with nothing pending says so', () => {
  const text = buildAnneClientUpdate({ ...order, stage: 'S08_PRODUCTION', updated_at: '2026-11-01T00:00:00Z' }, 1, 2, [], now);
  assert.match(text, /Wala — walang nakabinbin/);
  assert.match(text, /Huling galaw: ngayong araw/);
});

test('client text is HTML-escaped', () => {
  const text = buildAnneClientUpdate({ ...order, client_name: 'A & <B>' }, 0, 1, [], now);
  assert.match(text, /A &amp; &lt;B&gt;/);
});

test('samples are matched by order_id first, else by client name', () => {
  assert.equal(sampleBelongsToOrder({ client_name: 'Other', order_id: 'o1' }, order), true);
  assert.equal(sampleBelongsToOrder({ client_name: 'Reden', order_id: 'o9' }, order), false);
  assert.equal(sampleBelongsToOrder({ client_name: ' REDEN ', order_id: null }, order), true);
  const returned = { ...sample, status: 'RETURNED' };
  assert.deepEqual(pendingSamplesFor(order, [sample, returned]).map((row) => row.id), ['s1']);
});

test('daily update runs once per Manila date', () => {
  assert.equal(isDailyUpdateDue(null, '2026-11-01'), true);
  assert.equal(isDailyUpdateDue('2026-10-31', '2026-11-01'), true);
  assert.equal(isDailyUpdateDue('2026-11-01', '2026-11-01'), false);
});
