import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_ROUTES, exportFileName, redactSecrets } from './html-export.ts';

test('redactSecrets replaces long secret-named env values only', () => {
  const env = {
    SUPABASE_SERVICE_ROLE_KEY: 'sb-service-role-value-123',
    ADMIN_TOKEN: 'admin-token-value-xyz',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    SHORT_SECRET: 'abc',
  };
  const html = '<p>sb-service-role-value-123 admin-token-value-xyz https://example.supabase.co abc</p>';
  const out = redactSecrets(html, env);
  assert.equal(out.includes('sb-service-role-value-123'), false);
  assert.equal(out.includes('admin-token-value-xyz'), false);
  assert.ok(out.includes('[redacted:SUPABASE_SERVICE_ROLE_KEY]'));
  assert.ok(out.includes('https://example.supabase.co'), 'public URL is not a secret name');
  assert.ok(out.includes('abc'), 'values under the minimum length are left alone');
});

test('redactSecrets ignores undefined and empty values', () => {
  assert.equal(redactSecrets('plain', { API_KEY: undefined, TOKEN: '' }), 'plain');
});

test('export allowlist contains only public storefront routes', () => {
  for (const route of EXPORT_ROUTES) {
    assert.ok(route.startsWith('/'));
    assert.ok(!route.startsWith('/admin') && !route.startsWith('/api'));
  }
});

test('exportFileName is date-stamped', () => {
  assert.equal(exportFileName(new Date('2026-11-05T10:00:00Z')), 'mjic-site-export-2026-11-05.html');
});
