import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTikTokAuthorizeUrl,
  createTikTokOAuthState,
  exchangeTikTokAuthorizationCode,
  TIKTOK_OAUTH_SCOPES,
  verifyTikTokOAuthState,
} from './tiktok-oauth.ts';

test('TikTok OAuth state requires the matching nonce, secret, and an unexpired payload', () => {
  const { state, nonce } = createTikTokOAuthState('test-secret', 1_000);
  assert.equal(verifyTikTokOAuthState(state, nonce, 'test-secret', 2_000), true);
  assert.equal(verifyTikTokOAuthState(state, 'wrong-nonce', 'test-secret', 2_000), false);
  assert.equal(verifyTikTokOAuthState(state, nonce, 'wrong-secret', 2_000), false);
  assert.equal(verifyTikTokOAuthState(state, nonce, 'test-secret', 1_000 + 11 * 60 * 1000), false);
  assert.equal(verifyTikTokOAuthState(`${state}.extra`, nonce, 'test-secret', 2_000), false);
  assert.equal(verifyTikTokOAuthState(null, nonce, 'test-secret', 2_000), false);
});

test('TikTok authorization URL requests Login Kit and Content Posting scopes', () => {
  const url = new URL(buildTikTokAuthorizeUrl('client-key', 'https://example.test/callback', 'state-value'));
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'), 'client-key');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/callback');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('scope'), TIKTOK_OAUTH_SCOPES.join(','));
});

test('authorization-code exchange sends TikTok Login Kit form fields and returns private token data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://open.tiktokapis.com/v2/oauth/token/');
    assert.equal(init?.method, 'POST');
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('client_key'), 'client-key');
    assert.equal(body.get('client_secret'), 'client-secret');
    assert.equal(body.get('code'), 'one-time-code');
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('redirect_uri'), 'https://example.test/callback');
    return Response.json({
      access_token: 'access-token',
      expires_in: 86400,
      refresh_token: 'refresh-token',
      refresh_expires_in: 31536000,
      open_id: 'account-id',
      scope: TIKTOK_OAUTH_SCOPES.join(','),
    });
  };

  try {
    const tokens = await exchangeTikTokAuthorizationCode(
      'one-time-code',
      'https://example.test/callback',
      'client-key',
      'client-secret',
    );
    assert.equal(tokens.access_token, 'access-token');
    assert.equal(tokens.refresh_token, 'refresh-token');
    assert.equal(tokens.open_id, 'account-id');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
