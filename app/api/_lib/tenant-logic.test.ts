import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { pageLimit, parseSignedRequest, planConnect, readCookie, sessionSecret, signSession, verifySession } from './tenant-logic.ts';

test('session round-trips and rejects tampering, expiry and wrong secret', () => {
  const token = signSession('t1', 'k', 1000);
  assert.equal(verifySession(token, 'k', 2000), 't1');
  assert.equal(verifySession(token, 'other', 2000), null);
  assert.equal(verifySession(token + 'x', 'k', 2000), null);
  assert.equal(verifySession(token, 'k', 1000 + 31 * 24 * 3600 * 1000), null);
  assert.equal(verifySession(null, 'k'), null);
  assert.equal(verifySession(token, null), null);
});

test('session secret derives from the app secret, SESSION_SECRET wins', () => {
  assert.equal(sessionSecret({}), null);
  assert.ok(sessionSecret({ META_APP_SECRET: 'a' }));
  assert.equal(sessionSecret({ META_APP_SECRET: 'a', SESSION_SECRET: 's' }), 's');
});

test('plan limits and page selection', () => {
  assert.equal(pageLimit('pro'), 3);
  assert.equal(pageLimit('weird'), 1);
  assert.equal(pageLimit(null), 1);
  assert.deepEqual(planConnect(1, [], [], ['a', 'b']), { allowed: ['a'], skipped: [{ id: 'b', reason: 'plan_limit' }] });
  assert.deepEqual(planConnect(1, ['a'], [], ['a', 'b']), { allowed: ['a'], skipped: [{ id: 'b', reason: 'plan_limit' }] });
  assert.deepEqual(planConnect(3, ['x'], ['b'], ['a', 'b']), { allowed: ['a'], skipped: [{ id: 'b', reason: 'other_account' }] });
});

test('signed_request verification', () => {
  const payload = Buffer.from(JSON.stringify({ user_id: '99' })).toString('base64url');
  const sig = createHmac('sha256', 'sec').update(payload).digest('base64url');
  assert.deepEqual(parseSignedRequest(`${sig}.${payload}`, 'sec'), { user_id: '99' });
  assert.equal(parseSignedRequest(`${sig}.${payload}`, 'bad'), null);
  assert.equal(parseSignedRequest('nope', 'sec'), null);
});

test('cookie reader', () => {
  assert.equal(readCookie('a=1; mjic_session=abc.def; b=2', 'mjic_session'), 'abc.def');
  assert.equal(readCookie(null, 'x'), undefined);
});
