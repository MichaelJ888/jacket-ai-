import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutoStudioDescription,
  buildEnhanceInput,
  buildFaceSwapInput,
  isAllowedStudioAssetUrl,
  logoPlacementLeftChest,
  parseStudioCallback,
  studioImageExtension,
} from './studio-logic.ts';

const SUPABASE = 'https://abc.supabase.co';

test('builds a factual editable product description from supplied fields only', () => {
  assert.equal(
    buildAutoStudioDescription('Navy Polo', 'corporate-wear', '220gsm cotton pique'),
    'Custom corporate wear item: Navy Polo. Specified fabric: 220gsm cotton pique. A flexible option for teams, schools, and events. Add your logo and request a quotation for details.',
  );
  assert.equal(
    buildAutoStudioDescription('Canvas Tote', 'bag', ''),
    'Custom bag item: Canvas Tote. A flexible option for teams, schools, and events. Add your logo and request a quotation for details.',
  );
});

test('parseStudioCallback reads approve and reject payloads', () => {
  const id = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
  assert.deepEqual(parseStudioCallback(`studio:approve:${id}`), { decision: 'approve', jobId: id });
  assert.deepEqual(parseStudioCallback(`studio:reject:${id}`), { decision: 'reject', jobId: id });
});

test('parseStudioCallback rejects unknown or malformed payloads', () => {
  const id = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
  assert.equal(parseStudioCallback(`studio:delete:${id}`), null);
  assert.equal(parseStudioCallback(`studio:approve:not-a-uuid`), null);
  assert.equal(parseStudioCallback(`disp:approve:${id}`), null);
  assert.equal(parseStudioCallback(`studio:approve:${id} extra`), null);
});

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
