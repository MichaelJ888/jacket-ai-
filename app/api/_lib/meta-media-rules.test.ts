import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkImageForPlatform,
  isMetaImageRejection,
  sniffImage,
  toAbsoluteMediaUrl,
} from './meta-media-rules.ts';

function jpeg(width: number, height: number, { progressive = false } = {}) {
  const sof = progressive ? 0xc2 : 0xc0;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

function png(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test('sniffImage reads JPEG and PNG dimensions from magic bytes', () => {
  assert.deepEqual(sniffImage(jpeg(1200, 800)), { mime: 'image/jpeg', width: 1200, height: 800 });
  assert.deepEqual(sniffImage(jpeg(640, 640, { progressive: true })), { mime: 'image/jpeg', width: 640, height: 640 });
  assert.deepEqual(sniffImage(png(1024, 768)), { mime: 'image/png', width: 1024, height: 768 });
});

test('sniffImage rejects HTML, WebP and truncated data', () => {
  assert.equal(sniffImage(new TextEncoder().encode('<!doctype html><html></html>')), null);
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), null);
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff])), null);
});

test('Instagram accepts only JPEG within 4:5 to 1.91:1 and at least 320 px wide', () => {
  assert.equal(checkImageForPlatform('instagram', { mime: 'image/jpeg', width: 1080, height: 1350 }, 500_000), null);
  assert.equal(checkImageForPlatform('instagram', { mime: 'image/jpeg', width: 1920, height: 1080 }, 500_000), null);
  assert.match(checkImageForPlatform('instagram', { mime: 'image/png', width: 1080, height: 1080 }, 500_000) ?? '', /does not accept image\/png/);
  assert.match(checkImageForPlatform('instagram', { mime: 'image/jpeg', width: 1000, height: 1000 }, 9 * 1024 * 1024) ?? '', /bytes/);
  assert.match(checkImageForPlatform('instagram', { mime: 'image/jpeg', width: 2000, height: 800 }, 500_000) ?? '', /aspect ratio/);
  assert.match(checkImageForPlatform('instagram', { mime: 'image/jpeg', width: 300, height: 400 }, 500_000) ?? '', /min/);
});

test('Facebook accepts JPEG or PNG at least 200 px per side', () => {
  assert.equal(checkImageForPlatform('facebook', { mime: 'image/png', width: 800, height: 600 }, 400_000), null);
  assert.match(checkImageForPlatform('facebook', { mime: 'image/jpeg', width: 150, height: 150 }, 400_000) ?? '', /min/);
});

test('toAbsoluteMediaUrl resolves relative paths and rejects unusable references', () => {
  const origin = 'https://jacket-ai.vercel.app';
  assert.equal(toAbsoluteMediaUrl('/images/a.jpg', origin), 'https://jacket-ai.vercel.app/images/a.jpg');
  assert.equal(toAbsoluteMediaUrl('/images/polo%20shirts/x.jpg', origin), 'https://jacket-ai.vercel.app/images/polo%20shirts/x.jpg');
  assert.equal(toAbsoluteMediaUrl('https://cdn.example.com/p.jpg', origin), 'https://cdn.example.com/p.jpg');
  assert.equal(toAbsoluteMediaUrl('http://example.com/p.jpg', origin), null);
  assert.equal(toAbsoluteMediaUrl('https://localhost:3000/p.jpg', origin), null);
  assert.equal(toAbsoluteMediaUrl('images/relative-no-slash.jpg', origin), null);
  assert.equal(toAbsoluteMediaUrl('   ', origin), null);
  assert.equal(toAbsoluteMediaUrl(null, origin), null);
});

test('isMetaImageRejection matches the Meta errors seen in production', () => {
  assert.equal(isMetaImageRejection('(#324) Missing or invalid image file'), true);
  assert.equal(isMetaImageRejection('Only photo or video can be accepted as media type'), true);
  assert.equal(isMetaImageRejection('(#190) Access token expired'), false);
  assert.equal(isMetaImageRejection(undefined), false);
});
