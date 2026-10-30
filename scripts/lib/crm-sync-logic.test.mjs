import assert from 'node:assert/strict';
import test from 'node:test';
import { clientKey, groupOrders, normalizePhone, toCrmRow } from './crm-sync-logic.mjs';

test('phone formats collapse to the same 10-digit identity', () => {
  assert.equal(normalizePhone('09171234567'), '9171234567');
  assert.equal(normalizePhone('9171234567'), '9171234567');
  assert.equal(normalizePhone('+63 917 123 4567'), '9171234567');
});

test('same client across rows is grouped; unnamed rows without phone are skipped', () => {
  const orders = [
    { order_number: 'A', client_name: 'Juan Dela Cruz', contact_phone: '09171234567', stage: 'S08_PRODUCTION', total_amount: 25000 },
    { order_number: 'B', client_name: 'Juan  Dela Cruz', contact_phone: '9171234567', stage: 'S05_DEPOSIT', total_amount: 10000 },
    { order_number: 'C', client_name: 'Jackqueline Sulo', contact_phone: null, stage: 'S05_DEPOSIT', total_amount: 0 },
    { order_number: 'D', client_name: '  jackqueline sulo ', contact_phone: '', stage: 'S05_DEPOSIT', total_amount: 0 },
    { order_number: 'E', client_name: '', contact_phone: null, stage: 'S05_DEPOSIT', total_amount: 0 },
  ];
  const { groups, skipped } = groupOrders(orders);
  assert.equal(groups.length, 2);
  assert.deepEqual(skipped, ['E']);
  const juan = groups.find((g) => g.externalId === '9171234567');
  assert.equal(juan.orders.length, 2);
  assert.equal(juan.name, 'Juan Dela Cruz');
});

test('CRM row aggregates non-cancelled totals and marks all-cancelled clients as lost', () => {
  const won = toCrmRow({ externalId: 'name:x', name: 'X', phone: null, orders: [
    { stage: 'S08_PRODUCTION', total_amount: '100' },
    { stage: 'CANCELLED', total_amount: 999 },
  ] }, 'now');
  assert.equal(won.stage, 'won');
  assert.equal(won.orders_count, 1);
  assert.equal(won.lifetime_value, 100);
  const lost = toCrmRow({ externalId: 'name:y', name: 'Y', phone: null, orders: [{ stage: 'CANCELLED', total_amount: 5 }] }, 'now');
  assert.equal(lost.stage, 'lost');
});

test('client key prefers phone and falls back to normalized name', () => {
  assert.deepEqual(clientKey({ client_name: 'Max', contact_phone: null }), { key: 'name:max', externalId: 'name:max' });
  assert.equal(clientKey({ client_name: 'Max', contact_phone: null, order_number: 'z' }).externalId, 'name:max');
});
