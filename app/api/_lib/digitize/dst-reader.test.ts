import assert from 'node:assert/strict';
import test from 'node:test';

import { readDstStats, splitMoveForLimit, STITCH_LIMIT_MM } from './dst-reader.ts';

// Builds a minimal DST buffer: 512-byte header, the given 3-byte records, then an end marker.
function buildDst(records: number[][]): Buffer {
  const header = Buffer.alloc(512, 0x20);
  const body = Buffer.from([...records.flat(), 0x00, 0x00, 0xf3]);
  return Buffer.concat([header, body]);
}

test('splitMoveForLimit keeps short moves whole', () => {
  assert.deepEqual(splitMoveForLimit(30, -40), [{ dx: 30, dy: -40 }]);
});

test('splitMoveForLimit sub-moves always sum exactly to the original move', () => {
  const cases: Array<[number, number]> = [
    [81, 0],
    [-121, 37],
    [100, 100],
    [0, 200],
  ];
  for (const [dx, dy] of cases) {
    const parts = splitMoveForLimit(dx, dy);
    assert.equal(parts.reduce((s, p) => s + p.dx, 0), dx);
    assert.equal(parts.reduce((s, p) => s + p.dy, 0), dy);
  }
});

test('splitMoveForLimit produces segments no longer than the limit', () => {
  const parts = splitMoveForLimit(0, 200); // 20.0 mm
  assert.equal(parts.length, Math.ceil(20 / STITCH_LIMIT_MM));
  for (const p of parts) {
    assert.ok(Math.hypot(p.dx, p.dy) / 10 <= STITCH_LIMIT_MM + 0.1);
  }
});

test('readDstStats counts stitches over 6.7 mm and the split segments they need', () => {
  // dx=+81 units is 8.1 mm, over the 6.7 mm limit; it needs one extra split segment.
  // A zero-length record is included to confirm it is not counted as over-limit.
  const within = [0x00, 0x00, 0x00];
  const over = [0x00, 0x00, 0x04];
  const stats = readDstStats(buildDst([within, over]));
  assert.equal(stats.stitchRecords, 2);
  assert.equal(stats.overLimitStitches, 1);
  assert.equal(stats.limitSplitSegments, 1);
  assert.ok(Math.abs(stats.maxStitchMm - 8.1) < 0.01);
});

test('readDstStats reports no over-limit stitches for a short file', () => {
  const stats = readDstStats(buildDst([[0x00, 0x00, 0x00]]));
  assert.equal(stats.overLimitStitches, 0);
  assert.equal(stats.limitSplitSegments, 0);
});
