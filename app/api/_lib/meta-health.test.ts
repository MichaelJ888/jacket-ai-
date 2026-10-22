import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateHealth } from './meta-health-logic.ts';

const base = { appId: '1', tokenValid: true, now: 1_000_000 };
const byId = (checks: ReturnType<typeof evaluateHealth>) => Object.fromEntries(checks.map((c) => [c.id, c.ok]));

test('all green', () => {
  const checks = evaluateHealth({ ...base, tokenAppId: '1', subscribedApps: [{ id: '1', subscribed_fields: ['messages', 'messaging_postbacks', 'feed'] }], igUserId: '9' });
  assert.deepEqual(byId(checks), { token: true, webhook: true, fields: true, instagram: true });
});

test('missing subscription and fields are reported', () => {
  assert.deepEqual(byId(evaluateHealth({ ...base, subscribedApps: [], igUserId: null })), { token: true, webhook: false, fields: false, instagram: false });
  const partial = evaluateHealth({ ...base, subscribedApps: [{ id: '1', subscribed_fields: ['messages'] }] });
  assert.equal(byId(partial).webhook, true);
  assert.equal(byId(partial).fields, false);
});

test('expired or foreign token fails', () => {
  assert.equal(byId(evaluateHealth({ ...base, tokenExpiresAt: 500 }))['token'], false);
  assert.equal(byId(evaluateHealth({ ...base, tokenAppId: '2' }))['token'], false);
  assert.equal(byId(evaluateHealth({ ...base, tokenValid: false }))['token'], false);
});

