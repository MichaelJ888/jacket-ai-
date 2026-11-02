export type DstStats = {
  header: string;
  stitchRecords: number;
  colorChanges: number;
  flaggedJumps: number;
  hasEndMarker: boolean;
  widthMm: number;
  heightMm: number;
  maxStitchMm: number;
  maxJumpMm: number;
  minStitchMm: number;
};

// Decodes Tajima DST records (3 bytes each, after a 512-byte header). Units are 0.1 mm.
function decodeDelta(b0: number, b1: number, b2: number) {
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
}

export function readDstStats(buffer: Buffer): DstStats {
  let x = 0;
  let y = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let stitchRecords = 0;
  let colorChanges = 0;
  let flaggedJumps = 0;
  let hasEndMarker = false;
  let maxStitch = 0;
  let maxJump = 0;
  let minStitch = Number.POSITIVE_INFINITY;

  for (let offset = 512; offset + 2 < buffer.length; offset += 3) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const b2 = buffer[offset + 2];
    if (b0 === 0 && b1 === 0 && b2 === 0xf3) {
      hasEndMarker = true;
      break;
    }
    if (b0 === 0 && b1 === 0 && b2 === 0xc3) {
      colorChanges += 1;
      continue;
    }
    const { dx, dy } = decodeDelta(b0, b1, b2);
    const length = Math.hypot(dx, dy) / 10;
    stitchRecords += 1;
    if (b2 & 0x80 && (b2 & 0x03) === 0x03) {
      flaggedJumps += 1;
      maxJump = Math.max(maxJump, length);
    } else if (length > 0) {
      maxStitch = Math.max(maxStitch, length);
      minStitch = Math.min(minStitch, length);
    }
    x += dx;
    y += dy;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    header: buffer.subarray(0, 512).toString('ascii').replace(/\s+/g, ' ').trim(),
    stitchRecords,
    colorChanges,
    flaggedJumps,
    hasEndMarker,
    widthMm: (maxX - minX) / 10,
    heightMm: (maxY - minY) / 10,
    maxStitchMm: maxStitch,
    maxJumpMm: maxJump,
    minStitchMm: Number.isFinite(minStitch) ? minStitch : 0,
  };
}
