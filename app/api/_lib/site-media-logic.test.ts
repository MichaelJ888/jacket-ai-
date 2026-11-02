import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodedByteLength, mapStrings, parseImageDataUrl } from './site-media-logic.ts';

test('parseImageDataUrl accepts allowed image types and strips whitespace', () => {
  const parsed = parseImageDataUrl('data:image/PNG;base64,iVBO\nRw0K');
  assert.deepEqual(parsed, { mime: 'image/png', base64: 'iVBORw0K' });
});

test('parseImageDataUrl rejects non-image or unsupported payloads', () => {
  assert.equal(parseImageDataUrl('data:text/html;base64,PGgxPg=='), null);
  assert.equal(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(parseImageDataUrl('https://example.com/a.png'), null);
});

test('decodedByteLength matches real decoded size', () => {
  assert.equal(decodedByteLength(Buffer.from('hello').toString('base64')), 5);
  assert.equal(decodedByteLength(Buffer.from('hi').toString('base64')), 2);
  assert.equal(decodedByteLength(Buffer.from('abcd').toString('base64')), 4);
});

test('mapStrings rewrites nested strings without mutating input', () => {
  const input = { a: 'x', b: ['x', { c: 'y', d: 2 }] };
  const out = mapStrings(input, (s) => s.toUpperCase());
  assert.deepEqual(out, { a: 'X', b: ['X', { c: 'Y', d: 2 }] });
  assert.equal(input.a, 'x');
});
