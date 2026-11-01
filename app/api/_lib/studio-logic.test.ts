import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnhanceInput,
  buildFaceSwapInput,
  isAllowedStudioAssetUrl,
  logoPlacementLeftChest,
  studioImageExtension,
} from './studio-logic.ts';

const SUPABASE = 'https://abc.supabase.co';

test('allows only https public storage URLs on the project host', () => {
  assert.equal(isAllowedStudioAssetUrl(`${SUPABASE}/storage/v1/object/public/studio-inputs/a.png`, SUPABASE), true);
  assert.equal(isAllowedStudioAssetUrl('https://evil.example/storage/v1/object/public/x.png', SUPABASE), false);
  assert.equal(isAllowedStudioAssetUrl(`${SUPABASE}/rest/v1/secrets`, SUPABASE), false);
  assert.equal(isAllowedStudioAssetUrl(`http://abc.supabase.co/storage/v1/object/public/a.png`, SUPABASE), false);
  assert.equal(isAllowedStudioAssetUrl('not a url', SUPABASE), false);
  assert.equal(isAllowedStudioAssetUrl(`${SUPABASE}/storage/v1/object/public/a.png`, undefined), false);
});

test('maps only supported image MIME types to extensions', () => {
  assert.equal(studioImageExtension('image/png'), 'png');
  assert.equal(studioImageExtension('image/jpeg'), 'jpg');
  assert.equal(studioImageExtension('image/gif'), null);
  assert.equal(studioImageExtension('image/svg+xml'), null);
});

test('builds Replicate face-swap and enhance inputs', () => {
  assert.deepEqual(buildFaceSwapInput('https://s/a.jpg', 'https://s/face.png'), { swap_image: 'https://s/face.png', input_image: 'https://s/a.jpg' });
  assert.deepEqual(buildEnhanceInput('https://s/a.png', 4), { image: 'https://s/a.png', scale: 4, face_enhance: false });
  assert.equal(buildEnhanceInput('https://s/a.png', 8).scale, 2);
});

test('places the logo at the left chest inside image bounds', () => {
  const p = logoPlacementLeftChest(2000, 3000, 400, 400);
  assert.equal(p.width, 240);
  assert.equal(p.height, 240);
  assert.ok(p.left >= 0 && p.left + p.width <= 2000);
  assert.ok(p.top >= 0 && p.top + p.height <= 3000);
  assert.ok(p.left > 1000, 'left chest sits right of centre for a front-facing garment');
  assert.ok(p.top < 1500, 'left chest sits in the upper body');
});

test('keeps logo placement in bounds for tiny images', () => {
  const p = logoPlacementLeftChest(100, 100, 50, 20, 0.5);
  assert.ok(p.left >= 0 && p.left + p.width <= 100);
  assert.ok(p.top >= 0 && p.top + p.height <= 100);
});
