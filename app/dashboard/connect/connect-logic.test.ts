import assert from 'node:assert/strict';
import test from 'node:test';

import { describeError, parseOAuthMessage, rolesUrl, wizardStep } from './connect-logic.ts';

test('only same-origin oauth messages are accepted', () => {
  const ok = { type: 'mjic-meta-oauth', meta: 'connected', pages: '2', failed: '1' };
  assert.deepEqual(parseOAuthMessage(ok, 'https://a.test', 'https://a.test'), { status: 'connected', pages: 2, failed: 1 });
  assert.equal(parseOAuthMessage(ok, 'https://evil.test', 'https://a.test'), null);
  assert.equal(parseOAuthMessage({ type: 'other' }, 'https://a.test', 'https://a.test'), null);
  assert.equal(parseOAuthMessage('x', 'https://a.test', 'https://a.test'), null);
  assert.deepEqual(parseOAuthMessage({ type: 'mjic-meta-oauth', meta: 'error' }, 'https://a.test', 'https://a.test'), { status: 'error', reason: 'Connection failed' });
});

test('wizard step progression', () => {
  assert.equal(wizardStep([], false, {}), 1);
  assert.equal(wizardStep([], true, {}), 2);
  const pages = [{ page_id: '1', webhook_subscribed: true }];
  assert.equal(wizardStep(pages, false, {}), 3);
  assert.equal(wizardStep(pages, false, { '1': true }), 4);
});

test('helpers', () => {
  assert.equal(rolesUrl('42'), 'https://developers.facebook.com/apps/42/roles/roles/');
  assert.match(describeError('No Facebook Pages were granted.'), /choose at least one Page/);
});
