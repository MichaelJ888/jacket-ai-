import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ROWS, READABLE_TABLES, escapeLike, shapeRows, validateDataQuery } from './ceo-data-policy.ts';

test('only allowlisted tables are readable', () => {
  assert.equal(validateDataQuery({ table: 'orders' }).ok, true);
  for (const table of ['ceo_settings', 'approvals', 'agent_memory_events', 'rate_limits', 'constructor', '__proto__', 'pg_catalog.pg_user']) {
    assert.equal(validateDataQuery({ table }).ok, false, table);
  }
});

test('secret-bearing tables are never on the allowlist', () => {
  for (const table of ['ceo_settings', 'approvals', 'payment_verifications', 'staff_profiles', 'telegram_updates']) {
    assert.equal(table in READABLE_TABLES, false, table);
  }
});

test('columns, filters and ordering must be allowlisted', () => {
  assert.equal(validateDataQuery({ table: 'orders', columns: ['order_number', 'stage'] }).ok, true);
  assert.equal(validateDataQuery({ table: 'orders', columns: ['delivery_address'] }).ok, false);
  assert.equal(validateDataQuery({ table: 'crm_contacts', columns: ['external_id'] }).ok, false);
  assert.equal(validateDataQuery({ table: 'orders', filters: [{ column: 'secret', op: 'eq', value: 1 }] }).ok, false);
  assert.equal(validateDataQuery({ table: 'orders', filters: [{ column: 'stage', op: 'eq; drop' as never, value: 1 }] }).ok, false);
  assert.equal(validateDataQuery({ table: 'orders', orderBy: 'password' }).ok, false);
});

test('limit is clamped and defaults are applied', () => {
  const big = validateDataQuery({ table: 'leads', limit: 10_000 });
  assert.ok(big.ok && big.query.limit === MAX_ROWS);
  const none = validateDataQuery({ table: 'leads', limit: -5 });
  assert.ok(none.ok && none.query.limit >= 1);
  const def = validateDataQuery({ table: 'leads' });
  assert.ok(def.ok && def.query.limit === 20 && def.query.ascending === false);
});

test('like terms are stripped of PostgREST metacharacters', () => {
  assert.equal(escapeLike('dela cruz,or=(id.eq.1)'), 'dela cruz or= id.eq.1');
  assert.equal(escapeLike('50%_off*'), '50 off');
});

test('rows are truncated, redacted and flagged untrusted', () => {
  const shaped = shapeRows([{ content: 'x'.repeat(1000), n: 3 }], (text) => text.replace(/x{5}/g, 'Y'));
  assert.equal(shaped.count, 1);
  assert.match(shaped.notice, /untrusted/i);
  assert.ok(String(shaped.rows[0].content).length < 200);
  assert.equal(shaped.rows[0].n, 3);
});
