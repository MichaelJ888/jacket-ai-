import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readDstStats } from './dst-reader.ts';
import { ISACORD_PALETTE, matchThreadColor, nearestIsacordThread, rgbToLab, type ThreadPaletteEntry } from './thread-match.ts';

const palette: ThreadPaletteEntry[] = [
  { brand: 'Isacord', code: '0015', name: 'White', rgb: [255, 255, 255] },
  { brand: 'Isacord', code: '0020', name: 'Black', rgb: [0, 0, 0] },
  { brand: 'Isacord', code: '3335', name: 'Flag Blue', rgb: [0, 56, 147] },
];

test('rgbToLab maps white to L≈100 and black to L≈0', () => {
  assert.ok(Math.abs(rgbToLab([255, 255, 255]).l - 100) < 0.5);
  assert.ok(Math.abs(rgbToLab([0, 0, 0]).l) < 0.5);
});

test('matchThreadColor returns the nearest thread within tolerance', () => {
  const match = matchThreadColor([2, 54, 150], palette);
  assert.equal(match?.entry.code, '3335');
  assert.ok((match?.deltaE ?? Infinity) < 12);
});

test('matchThreadColor returns null when nothing is close enough or palette is empty', () => {
  assert.equal(matchThreadColor([255, 0, 0], palette, 5), null);
  assert.equal(matchThreadColor([255, 0, 0], []), null);
});

test('ISACORD_PALETTE has 398 entries with unique codes and valid RGB', () => {
  assert.equal(ISACORD_PALETTE.length, 398);
  assert.equal(new Set(ISACORD_PALETTE.map((e) => e.code)).size, 398);
  for (const e of ISACORD_PALETTE) {
    assert.equal(e.brand, 'Isacord');
    for (const c of e.rgb) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255);
  }
});

test('nearestIsacordThread returns the closest Isacord thread for a hex colour', () => {
  const match = nearestIsacordThread('#003893');
  assert.ok(match);
  assert.equal(match.entry.brand, 'Isacord');
  assert.ok(match.deltaE < 5);
});

test('nearestIsacordThread returns null for invalid hex', () => {
  assert.equal(nearestIsacordThread('not-a-colour'), null);
});

// Calibration against the DBHS 25yrs rev fixture. Set MJIC_DST_FIXTURE to the .DST path to run;
// values come from the Wilcom production worksheet (8,740 stitches, 2 color changes, 77.6 x 71.2 mm).
const fixturePath = process.env.MJIC_DST_FIXTURE;
test('DBHS 25yrs rev DST fixture matches production worksheet', { skip: !fixturePath }, () => {
  const stats = readDstStats(readFileSync(fixturePath as string));
  assert.match(stats.header, /ST:\s+8740/);
  assert.equal(stats.colorChanges, 2);
  assert.ok(stats.hasEndMarker);
  assert.ok(Math.abs(stats.widthMm - 77.6) < 1);
  assert.ok(Math.abs(stats.heightMm - 71.2) < 1);
  assert.ok(Math.abs(stats.minStitchMm - 0.1) < 0.05);
  assert.ok(stats.maxJumpMm <= 12.1, `max jump ${stats.maxJumpMm}mm exceeds DST 12.1mm limit`);
  assert.ok(stats.stitchRecords > 8000 && stats.stitchRecords < 8800);
});
