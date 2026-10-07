import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { digitizeLogo } from './index.ts';

type DecodedDst = {
  stitchRecords: number;
  colorChanges: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

function decodeDst(buffer: Buffer): DecodedDst {
  let x = 0;
  let y = 0;
  let stitchRecords = 0;
  let colorChanges = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  const decodeDelta = (b0: number, b1: number, b2: number) => {
    let dx = 0;
    let dy = 0;
    if (b2 & (1 << 2)) dx += 81;
    if (b2 & (1 << 3)) dx -= 81;
    if (b1 & (1 << 2)) dx += 27;
    if (b1 & (1 << 3)) dx -= 27;
    if (b0 & (1 << 2)) dx += 9;
    if (b0 & (1 << 3)) dx -= 9;
    if (b1 & (1 << 0)) dx += 3;
    if (b1 & (1 << 1)) dx -= 3;
    if (b0 & (1 << 0)) dx += 1;
    if (b0 & (1 << 1)) dx -= 1;

    if (b2 & (1 << 5)) dy += 81;
    if (b2 & (1 << 4)) dy -= 81;
    if (b1 & (1 << 5)) dy += 27;
    if (b1 & (1 << 4)) dy -= 27;
    if (b0 & (1 << 5)) dy += 9;
    if (b0 & (1 << 4)) dy -= 9;
    if (b1 & (1 << 7)) dy += 3;
    if (b1 & (1 << 6)) dy -= 3;
    if (b0 & (1 << 7)) dy += 1;
    if (b0 & (1 << 6)) dy -= 1;
    return { dx, dy: -dy };
  };

  for (let offset = 512; offset + 2 < buffer.length; offset += 3) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const b2 = buffer[offset + 2];
    if (b0 === 0 && b1 === 0 && b2 === 0xf3) break;
    if (b0 === 0 && b1 === 0 && b2 === 0xc3) {
      colorChanges += 1;
      continue;
    }
    const { dx, dy } = decodeDelta(b0, b1, b2);
    x += dx;
    y += dy;
    stitchRecords += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { stitchRecords, colorChanges, bounds: { minX, minY, maxX, maxY } };
}

async function makeSyntheticLogo() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="180" viewBox="0 0 220 180">
      <rect width="220" height="180" fill="white" />
      <circle cx="70" cy="90" r="42" fill="#165DFF" />
      <rect x="120" y="55" width="72" height="20" rx="4" fill="#E53935" />
      <rect x="112" y="84" width="84" height="18" rx="4" fill="#E53935" />
      <rect x="128" y="112" width="58" height="16" rx="4" fill="#E53935" />
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('digitizeLogo creates stitches, QA, preview, and embroidery files', async () => {
  const image = await makeSyntheticLogo();
  const result = await digitizeLogo({
    image,
    widthMm: 60,
    maxColors: 4,
    designName: 'synthetic-logo',
  });

  assert.ok(result.stitches.length > 0);
  assert.ok(result.colors.length >= 2);
  assert.ok(result.previewPng.length > 0);
  assert.ok(result.files.dst.length > 512);
  assert.ok(result.files.exp.length > 20);
  assert.ok(result.files.pes.length > 100);
  assert.ok(result.files.jef.length > 100);
  assert.ok(result.qa.stitchCount > 0);
  assert.ok(result.qa.designWidthMm > 0);
  assert.ok(Array.isArray(result.qa.warnings));
  assert.equal(typeof result.qa.needsHumanReview, 'boolean');
  assert.ok(result.qa.confidence > 0 && result.qa.confidence < 1);
});

test('DST output round-trips structurally and matches QA bounds', async () => {
  const image = await makeSyntheticLogo();
  const result = await digitizeLogo({
    image,
    widthMm: 55,
    maxColors: 4,
    designName: 'dst-roundtrip',
  });

  const decoded = decodeDst(result.files.dst);
  const header = result.files.dst.subarray(0, 512).toString('ascii');
  assert.match(header, /LA:/);
  assert.match(header, /ST:\s+\d+/);
  assert.match(header, /CO:\s+\d+/);
  assert.ok(decoded.stitchRecords > result.qa.stitchCount * 0.6);
  assert.ok(decoded.colorChanges >= 1);

  const decodedWidthMm = (decoded.bounds.maxX - decoded.bounds.minX) / 10;
  const decodedHeightMm = (decoded.bounds.maxY - decoded.bounds.minY) / 10;
  assert.ok(Math.abs(decodedWidthMm - result.qa.designWidthMm) < 15);
  assert.ok(Math.abs(decodedHeightMm - result.qa.designHeightMm) < 15);
});
