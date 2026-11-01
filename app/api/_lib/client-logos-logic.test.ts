import assert from 'node:assert/strict';
import test from 'node:test';
import { detectImage, matchTrustClient, normalizeClientRef, parseLogoCaption, TRUST_CLIENTS } from './client-logos-logic.ts';

test('parseLogoCaption reads logo commands and ignores other captions', () => {
  assert.deepEqual(parseLogoCaption('logo Panasonic'), { ref: 'panasonic' });
  assert.deepEqual(parseLogoCaption('/LOGO  Office of the President'), { ref: 'office of the president' });
  assert.deepEqual(parseLogoCaption('logo'), { ref: '' });
  assert.equal(parseLogoCaption('logos of my clients'), null);
  assert.equal(parseLogoCaption('please logo Globe'), null);
});

test('matchTrustClient resolves names, slugs and aliases to the roster client', () => {
  assert.equal(matchTrustClient('DOH')?.slug, 'doh');
  assert.equal(matchTrustClient('Department of Health')?.slug, 'doh');
  assert.equal(matchTrustClient('office-of-the-president')?.slug, 'office-of-the-president');
  assert.equal(matchTrustClient('PPIC')?.slug, 'philippine-power-industries');
  assert.equal(matchTrustClient('Metro Logistics Group')?.slug, 'metro-logistics');
  assert.equal(matchTrustClient('Random Co'), null);
  assert.equal(matchTrustClient(''), null);
});

test('every trust client has a unique slug', () => {
  const slugs = TRUST_CLIENTS.map((client) => client.slug);
  assert.equal(new Set(slugs).size, TRUST_CLIENTS.length);
  assert.equal(normalizeClientRef(' Nokia!! '), 'nokia');
});

test('detectImage recognises PNG, JPEG and WebP by magic bytes only', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));
  assert.deepEqual(detectImage(png), { type: 'image/png', ext: 'png' });
  assert.deepEqual(detectImage(jpeg), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectImage(webp), { type: 'image/webp', ext: 'webp' });
  assert.equal(detectImage(new TextEncoder().encode('<svg></svg>')), null);
  assert.equal(detectImage(new Uint8Array([0x89, 0x50])), null);
});
