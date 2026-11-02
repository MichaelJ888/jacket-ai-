import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B2B_SEO_KEYWORDS, buildSeoOverride, publicOverlay, sanitizeOverlay } from './site-overlay-logic.ts';

test('sanitizeOverlay keeps only editable sections', () => {
  const result = sanitizeOverlay({ products: [{ id: 1 }], evil: 'x', crmOrders: [] });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(Object.keys(result.doc).sort(), ['crmOrders', 'products']);
});

test('sanitizeOverlay rejects non-objects and empty payloads', () => {
  assert.equal(sanitizeOverlay(null).ok, false);
  assert.equal(sanitizeOverlay([]).ok, false);
  assert.equal(sanitizeOverlay({ unrelated: 1 }).ok, false);
});

test('publicOverlay strips internal client and staff data', () => {
  const pub = publicOverlay({ products: [], crmOrders: [{ client: 'x' }], teamSchedules: [] });
  assert.deepEqual(pub, { products: [] });
  assert.equal(publicOverlay(null), null);
});

test('buildSeoOverride injects every required B2B keyword once', () => {
  const first = buildSeoOverride(null, '2026-01-01T00:00:00Z');
  for (const keyword of B2B_SEO_KEYWORDS) assert.ok(first.keywords.includes(keyword));
  const second = buildSeoOverride({ keywords: ['Custom Jackets Philippines', 'Legacy Term'] }, '2026-01-02T00:00:00Z');
  assert.equal(second.keywords.filter((k) => k === 'Custom Jackets Philippines').length, 1);
  assert.ok(second.keywords.includes('Legacy Term'));
  assert.equal(second.jsonLd['@type'], undefined);
  const graph = second.jsonLd['@graph'] as Array<{ '@type': string }>;
  assert.deepEqual(graph.map((n) => n['@type']), ['Organization', 'FAQPage']);
});
