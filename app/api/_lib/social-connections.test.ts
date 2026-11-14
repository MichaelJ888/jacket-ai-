import test from 'node:test';
import assert from 'node:assert/strict';
import { socialConnection, socialProviderConfigured } from './social-connections.ts';

test('marks only verified provider credentials as configured', () => {
  assert.equal(socialProviderConfigured('tiktok', new Set(['TIKTOK_ACCESS_TOKEN'])), true);
  assert.equal(socialProviderConfigured('tiktok', new Set(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'])), true);
  assert.equal(socialProviderConfigured('tiktok', new Set()), false);
  assert.equal(socialProviderConfigured('youtube', new Set([
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_REFRESH_TOKEN',
  ])), true);
  assert.equal(socialProviderConfigured('youtube', new Set(['YOUTUBE_REFRESH_TOKEN'])), false);
  assert.equal(socialProviderConfigured('shopee', new Set()), false);
});

test('keeps unverified credentials distinct from a healthy live connection', () => {
  const connection = socialConnection('youtube', 'unverified', 'Credential present.', true);
  assert.equal(connection.state, 'unverified');
  assert.equal(connection.configured, true);
});
