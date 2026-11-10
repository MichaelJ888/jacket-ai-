import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAuthorizeUrl, createOAuthState, META_OAUTH_SCOPES, metaSubscribedFieldsForPage, oauthRedirectUri, verifyOAuthState } from './meta-oauth.ts';

test('state verifies only with matching cookie, secret and before expiry', () => {
  const { state, nonce } = createOAuthState('s3cret', 1000);
  assert.equal(verifyOAuthState(state, nonce, 's3cret', 2000), true);
  assert.equal(verifyOAuthState(state, 'other', 's3cret', 2000), false);
  assert.equal(verifyOAuthState(state, nonce, 'wrong', 2000), false);
  assert.equal(verifyOAuthState(state, nonce, 's3cret', 1000 + 11 * 60 * 1000), false);
  assert.equal(verifyOAuthState(state + 'x', nonce, 's3cret', 2000), false);
  assert.equal(verifyOAuthState(null, nonce, 's3cret'), false);
  assert.equal(verifyOAuthState(state, undefined, 's3cret', 2000), false);
});

test('authorize url carries scopes, state and redirect', () => {
  const url = new URL(buildAuthorizeUrl('123', oauthRedirectUri('https://x.test/'), 'st'));
  assert.equal(url.searchParams.get('client_id'), '123');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x.test/api/meta/oauth/callback');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('scope'), [...META_OAUTH_SCOPES, 'leads_retrieval'].join(','));
  assert.ok(META_OAUTH_SCOPES.includes('public_profile'));
  assert.ok(!META_OAUTH_SCOPES.includes('leads_retrieval'));
  for (const context of ['popup', 'connect'] as const) {
    const buyerUrl = new URL(buildAuthorizeUrl('123', 'https://x.test/callback', 'st', context));
    assert.equal(buyerUrl.searchParams.get('scope'), META_OAUTH_SCOPES.join(','));
    assert.ok(!buyerUrl.searchParams.get('scope')?.includes('leads_retrieval'));
  }
});

test('only the configured MJIC Page receives the leadgen subscription', () => {
  assert.equal(metaSubscribedFieldsForPage('mjic-page', 'mjic-page'), 'messages,messaging_postbacks,feed,leadgen');
  assert.equal(metaSubscribedFieldsForPage('cgv-page', 'mjic-page'), 'messages,messaging_postbacks,feed');
  assert.equal(metaSubscribedFieldsForPage('mjic-page', undefined), 'messages,messaging_postbacks,feed');
  assert.equal(metaSubscribedFieldsForPage('shared-page', 'shared-page', 'shared-page'), 'messages,messaging_postbacks,feed');
});
