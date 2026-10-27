import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMetaPublishing, evaluatePublishingToken, metaPublishFailure } from './meta-publishing.ts';

const env = { META_APP_ID: 'app', META_APP_SECRET: 'private-secret', META_WEBHOOK_VERIFY_TOKEN: 'private-verify' };
const valid = { is_valid: true, app_id: 'app', scopes: ['pages_manage_posts', 'pages_read_engagement'], expires_at: 0 };

test('publishing checks validity, both expiries, app and required scope coverage', () => {
  assert.equal(evaluatePublishingToken(valid, 'app', 'facebook', 'page').ok, true);
  for (const data of [
    { ...valid, is_valid: false },
    { ...valid, expires_at: 1 },
    { ...valid, data_access_expires_at: 1 },
    { ...valid, app_id: 'other' },
    { ...valid, scopes: ['pages_read_engagement'] },
    { ...valid, granular_scopes: [{ scope: 'pages_manage_posts', target_ids: ['other-page'] }] },
  ]) assert.equal(evaluatePublishingToken(data, 'app', 'facebook', 'page').ok, false);
  assert.equal(evaluatePublishingToken(valid, 'app', 'instagram', 'page').ok, false);
  assert.equal(evaluatePublishingToken({ ...valid, scopes: ['instagram_basic', 'instagram_content_publish'] }, 'app', 'instagram', 'page').ok, true);
});

test('all required Meta configuration is validated before any provider request', async () => {
  for (const key of Object.keys(env)) {
    const result = await checkMetaPublishing('page', 'private-token', 'facebook', { ...env, [key]: '' }, async () => { throw new Error('must not fetch'); });
    assert.equal(result.code, 'missing_config');
    assert.match(result.reason, new RegExp(key));
    assert.ok(!result.reason.includes('private-'));
  }
  assert.equal((await checkMetaPublishing('page', undefined, 'facebook', env)).code, 'missing_config');
});

test('token and correct Page identity are verified using GET only', async () => {
  const urls: string[] = [];
  const result = await checkMetaPublishing('page', 'private-token', 'facebook', env, async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.method, undefined);
    assert.ok(init?.signal);
    return Response.json(urls.length === 1 ? { data: valid } : { id: 'page' });
  });
  assert.equal(result.ok, true);
  assert.equal(urls.length, 2);
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('missing permission stops before identity/publication and provides an actionable diagnostic', async () => {
  let calls = 0;
  const result = await checkMetaPublishing('page', 'token', 'facebook', env, async () => {
    calls++;
    return Response.json({ data: { ...valid, scopes: [] } });
  });
  assert.equal(calls, 1);
  assert.equal(result.code, 'missing_permissions');
  assert.match(result.reason, /pages_manage_posts/);
});

test('foreign Page identity, denied access, timeouts and malformed responses return safe failures', async () => {
  let calls = 0;
  const foreign = await checkMetaPublishing('page', 'token', 'facebook', env, async () => Response.json(++calls === 1 ? { data: valid } : { id: 'other' }));
  assert.equal(foreign.code, 'wrong_page');
  for (const fetcher of [
    async () => new Response('private-provider-response', { status: 403 }),
    async () => { throw new Error('private-token-in-exception'); },
    async () => new Response('not json'),
  ]) {
    const result = await checkMetaPublishing('page', 'private-token', 'facebook', env, fetcher);
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('private-'));
  }
});

test('permission and expired-token errors at publish time are recoverable credential blocks', () => {
  for (const code of [190, 10, 200]) {
    const result = metaPublishFailure({ code, message: 'private-provider-message' });
    assert.equal(result?.ok, false);
    assert.ok(!JSON.stringify(result).includes('private-'));
  }
  for (const error of [null, new Error('network error'), { code: 500 }, '190']) {
    assert.equal(metaPublishFailure(error), null);
  }
});

test('malformed provider expiry metadata cannot pass as a healthy token', () => {
  for (const expires_at of [-1, NaN, Infinity]) {
    assert.equal(evaluatePublishingToken({ ...valid, expires_at }, 'app', 'facebook', 'page').code, 'invalid_metadata');
  }
});
