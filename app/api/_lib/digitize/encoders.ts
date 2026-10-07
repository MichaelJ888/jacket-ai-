import type { Stitch, ThreadColor } from './types.ts';

type WriterCommand = 'stitch' | 'jump' | 'trim' | 'color-change' | 'end';

type WriterStitch = {
  x: number;
  y: number;
  command: WriterCommand;
  color: number;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const PEC_GRAPHIC_BYTES = 6 * 38;

function pushInt16Le(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function pushInt32Le(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function pushFloat32Le(bytes: number[], value: number) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  bytes.push(...new Uint8Array(buffer));
}

function pushAscii(bytes: number[], value: string) {
  bytes.push(...Buffer.from(value, 'utf8'));
}

function roundUnit(value: number) {
  return Math.round(value);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getBounds(stitches: WriterStitch[]): Bounds {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const stitch of stitches) {
    minX = Math.min(minX, stitch.x);
    minY = Math.min(minY, stitch.y);
    maxX = Math.max(maxX, stitch.x);
    maxY = Math.max(maxY, stitch.y);
  }
  return { minX, minY, maxX, maxY };
}

function colorChanges(stitches: WriterStitch[]) {
  return stitches.filter((stitch) => stitch.command === 'color-change').length;
}

function splitMovementRecord(command: WriterCommand, from: { x: number; y: number }, to: { x: number; y: number }, maxDelta: number) {
  const total = distance(from, to);
  if (total <= maxDelta || total === 0) return [{ ...to, command }];
  const steps = Math.ceil(total / maxDelta);
  const records: Array<{ x: number; y: number; command: WriterCommand }> = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    records.push({
      x: roundUnit(from.x + (to.x - from.x) * t),
      y: roundUnit(from.y + (to.y - from.y) * t),
      command,
    });
  }
  return records;
}

function normalizeForDst(stitches: Stitch[]): WriterStitch[] {
  const normalized: WriterStitch[] = [];
  let current = { x: 0, y: 0 };
  for (const stitch of stitches) {
    if (stitch.command === 'trim' || stitch.command === 'color-change' || stitch.command === 'end') {
      normalized.push({ ...stitch });
      continue;
    }
    const records = splitMovementRecord(stitch.command, current, stitch, 121);
    for (const record of records) normalized.push({ ...record, color: stitch.color });
    current = { x: stitch.x, y: stitch.y };
  }
  if (!normalized.length || normalized[normalized.length - 1].command !== 'end') {
    normalized.push({
      x: current.x,
      y: current.y,
      command: 'end',
      color: normalized[normalized.length - 1]?.color ?? 0,
    });
  }
  return normalized;
}

function normalizeForExpOrJef(stitches: Stitch[]): WriterStitch[] {
  const normalized: WriterStitch[] = [];
  let current = { x: 0, y: 0 };
  for (const stitch of stitches) {
    if (stitch.command === 'trim' || stitch.command === 'color-change' || stitch.command === 'end') {
      normalized.push({ ...stitch });
      continue;
    }
    const records = splitMovementRecord(stitch.command, current, stitch, 127);
    for (const record of records) normalized.push({ ...record, color: stitch.color });
    current = { x: stitch.x, y: stitch.y };
  }
  if (!normalized.length || normalized[normalized.length - 1].command !== 'end') {
    normalized.push({
      x: current.x,
      y: current.y,
      command: 'end',
      color: normalized[normalized.length - 1]?.color ?? 0,
    });
  }
  return normalized;
}

function normalizeForPec(stitches: Stitch[]): WriterStitch[] {
  const normalized: WriterStitch[] = [];
  let current = { x: 0, y: 0 };
  for (const stitch of stitches) {
    if (stitch.command === 'trim' || stitch.command === 'color-change' || stitch.command === 'end') {
      normalized.push({ ...stitch });
      continue;
    }
    const records = splitMovementRecord(stitch.command, current, stitch, 2047);
    for (const record of records) normalized.push({ ...record, color: stitch.color });
    current = { x: stitch.x, y: stitch.y };
  }
  if (!normalized.length || normalized[normalized.length - 1].command !== 'end') {
    normalized.push({
      x: current.x,
      y: current.y,
      command: 'end',
      color: normalized[normalized.length - 1]?.color ?? 0,
    });
  }
  return normalized;
}

function signedByte(value: number) {
  return ((value % 256) + 256) % 256;
}

// Adapted from EmbroidePy/pyembroidery (MIT) DST writer bit packing.
function encodeDstRecord(dx: number, dy: number, command: WriterCommand) {
  let x = roundUnit(dx);
  let y = -roundUnit(dy);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const bit = (index: number) => 1 << index;

  if (command === 'jump') b2 |= bit(7);

  if (command === 'stitch' || command === 'jump') {
    b2 |= bit(0) | bit(1);
    if (x > 40) { b2 |= bit(2); x -= 81; }
    if (x < -40) { b2 |= bit(3); x += 81; }
    if (x > 13) { b1 |= bit(2); x -= 27; }
    if (x < -13) { b1 |= bit(3); x += 27; }
    if (x > 4) { b0 |= bit(2); x -= 9; }
    if (x < -4) { b0 |= bit(3); x += 9; }
    if (x > 1) { b1 |= bit(0); x -= 3; }
    if (x < -1) { b1 |= bit(1); x += 3; }
    if (x > 0) { b0 |= bit(0); x -= 1; }
    if (x < 0) { b0 |= bit(1); x += 1; }
    if (x !== 0) throw new Error(`DST dx out of range after split: ${dx}`);

    if (y > 40) { b2 |= bit(5); y -= 81; }
    if (y < -40) { b2 |= bit(4); y += 81; }
    if (y > 13) { b1 |= bit(5); y -= 27; }
    if (y < -13) { b1 |= bit(4); y += 27; }
    if (y > 4) { b0 |= bit(5); y -= 9; }
    if (y < -4) { b0 |= bit(4); y += 9; }
    if (y > 1) { b1 |= bit(7); y -= 3; }
    if (y < -1) { b1 |= bit(6); y += 3; }
    if (y > 0) { b0 |= bit(7); y -= 1; }
    if (y < 0) { b0 |= bit(6); y += 1; }
    if (y !== 0) throw new Error(`DST dy out of range after split: ${dy}`);
  } else if (command === 'color-change') {
    b2 = 0b11000011;
  } else if (command === 'end') {
    b2 = 0b11110011;
  }

  return [b0, b1, b2];
}

function writeDstHeader(stitches: WriterStitch[], designName: string) {
  const bytes: number[] = [];
  const bounds = getBounds(stitches);
  const lastPoint = [...stitches].reverse().find((stitch) => stitch.command === 'stitch' || stitch.command === 'jump');
  const ax = lastPoint ? roundUnit(lastPoint.x) : 0;
  const ay = lastPoint ? roundUnit(-lastPoint.y) : 0;
  const headerLines = [
    `LA:${designName.slice(0, 16).padEnd(16, ' ')}\r`,
    `ST:${String(stitches.filter((stitch) => stitch.command !== 'end').length).padStart(7, ' ')}\r`,
    `CO:${String(colorChanges(stitches)).padStart(3, ' ')}\r`,
    `+X:${String(Math.max(0, roundUnit(bounds.maxX))).padStart(5, ' ')}\r`,
    `-X:${String(Math.abs(Math.min(0, roundUnit(bounds.minX)))).padStart(5, ' ')}\r`,
    `+Y:${String(Math.max(0, roundUnit(bounds.maxY))).padStart(5, ' ')}\r`,
    `-Y:${String(Math.abs(Math.min(0, roundUnit(bounds.minY)))).padStart(5, ' ')}\r`,
    `AX:${ax >= 0 ? '+' : '-'}${String(Math.abs(ax)).padStart(5, ' ')}\r`,
    `AY:${ay >= 0 ? '+' : '-'}${String(Math.abs(ay)).padStart(5, ' ')}\r`,
    `MX:+${String(0).padStart(5, ' ')}\r`,
    `MY:+${String(0).padStart(5, ' ')}\r`,
    'PD:******\r',
  ];
  for (const line of headerLines) pushAscii(bytes, line);
  bytes.push(0x1a);
  while (bytes.length < 512) bytes.push(0x20);
  return bytes;
}

export function encodeDst(stitches: Stitch[], designName = 'MJIC') {
  const normalized = normalizeForDst(stitches);
  const bytes = writeDstHeader(normalized, designName);
  let current = { x: 0, y: 0 };
  for (const stitch of normalized) {
    if (stitch.command === 'trim') {
      const trimPattern: Array<[number, number]> = [[-2, -2], [4, 4], [-4, -4], [2, 2]];
      for (const [dx, dy] of trimPattern) bytes.push(...encodeDstRecord(dx, dy, 'jump'));
      continue;
    }
    const dx = roundUnit(stitch.x - current.x);
    const dy = roundUnit(stitch.y - current.y);
    bytes.push(...encodeDstRecord(dx, dy, stitch.command));
    if (stitch.command === 'stitch' || stitch.command === 'jump') {
      current = { x: stitch.x, y: stitch.y };
    }
  }
  return Buffer.from(bytes);
}

export function encodeExp(stitches: Stitch[]) {
  const normalized = normalizeForExpOrJef(stitches);
  const bytes: number[] = [];
  let current = { x: 0, y: 0 };
  for (const stitch of normalized) {
    if (stitch.command === 'trim') {
      bytes.push(0x80, 0x80, 0x07, 0x00);
      continue;
    }
    if (stitch.command === 'color-change') {
      bytes.push(0x80, 0x01, 0x00, 0x00);
      continue;
    }
    if (stitch.command === 'end') break;
    const dx = roundUnit(stitch.x - current.x);
    const dy = roundUnit(stitch.y - current.y);
    current = { x: stitch.x, y: stitch.y };
    if (stitch.command === 'jump') bytes.push(0x80, 0x04);
    bytes.push(signedByte(dx), signedByte(-dy));
  }
  return Buffer.from(bytes);
}

function buildPecPaletteIndices(colors: ThreadColor[]) {
  return colors.map((_, index) => index % 64);
}

function writePecHeader(bytes: number[], colors: ThreadColor[]) {
  pushAscii(bytes, '#PEC0001');
  pushAscii(bytes, `LA:${'MJIC'.padEnd(16, ' ').slice(0, 16)}\r`);
  bytes.push(...new Array(12).fill(0x20), 0xff, 0x00);
  bytes.push(6, 38);
  if (colors.length > 0) {
    bytes.push(...new Array(12).fill(0x20));
    const palette = buildPecPaletteIndices(colors);
    bytes.push(palette.length - 1, ...palette);
    for (let index = colors.length; index < 463; index += 1) bytes.push(0x20);
  } else {
    bytes.push(...new Array(12).fill(0x20), 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff);
    for (let index = 0; index < 463; index += 1) bytes.push(0x20);
  }
  while (bytes.length < 520) bytes.push(0x20);
}

function writePecValue(bytes: number[], value: number, longForm: boolean, flag: number) {
  if (!longForm && value > -64 && value < 63) {
    bytes.push(value & 0x7f);
    return;
  }
  let encoded = value & 0x0fff;
  encoded |= 0x8000;
  encoded |= flag << 8;
  bytes.push((encoded >> 8) & 0xff, encoded & 0xff);
}

function writePecBlock(bytes: number[], stitches: WriterStitch[]) {
  const bounds = getBounds(stitches);
  const width = roundUnit(bounds.maxX - bounds.minX);
  const height = roundUnit(bounds.maxY - bounds.minY);
  const start = bytes.length;
  bytes.push(0x00, 0x00, 0x00, 0x00, 0x00);
  bytes.push(0x31, 0xff, 0xf0);
  pushInt16Le(bytes, width);
  pushInt16Le(bytes, height);
  pushInt16Le(bytes, 0x1e0);
  pushInt16Le(bytes, 0x1b0);

  let current = { x: 0, y: 0 };
  let jumping = true;
  let firstMovement = true;
  let colorToggle = true;
  for (const stitch of stitches) {
    if (stitch.command === 'trim') continue;
    if (stitch.command === 'color-change') {
      if (jumping) {
        writePecValue(bytes, 0, false, 0);
        writePecValue(bytes, 0, false, 0);
        jumping = false;
      }
      bytes.push(0xfe, 0xb0, colorToggle ? 0x02 : 0x01);
      colorToggle = !colorToggle;
      continue;
    }
    if (stitch.command === 'end') {
      bytes.push(0xff);
      break;
    }
    const dx = roundUnit(stitch.x - current.x);
    const dy = roundUnit(current.y - stitch.y);
    current = { x: stitch.x, y: stitch.y };
    if (stitch.command === 'jump') {
      jumping = true;
      writePecValue(bytes, dx, true, firstMovement ? 0x10 : 0x20);
      writePecValue(bytes, dy, true, firstMovement ? 0x10 : 0x20);
    } else {
      if (jumping && dx !== 0 && dy !== 0) {
        writePecValue(bytes, 0, false, 0);
        writePecValue(bytes, 0, false, 0);
      }
      jumping = false;
      writePecValue(bytes, dx, false, 0);
      writePecValue(bytes, dy, false, 0);
    }
    firstMovement = false;
  }

  const blockLength = bytes.length - start;
  const view = new DataView(new ArrayBuffer(3));
  view.setUint8(0, blockLength & 0xff);
  view.setUint8(1, (blockLength >> 8) & 0xff);
  view.setUint8(2, (blockLength >> 16) & 0xff);
  bytes[start + 2] = view.getUint8(0);
  bytes[start + 3] = view.getUint8(1);
  bytes[start + 4] = view.getUint8(2);
}

function writePecGraphics(bytes: number[], colorCount: number) {
  bytes.push(...new Array(PEC_GRAPHIC_BYTES).fill(0));
  for (let index = 0; index < colorCount; index += 1) {
    bytes.push(...new Array(PEC_GRAPHIC_BYTES).fill(0));
  }
}

function encodePec(stitches: Stitch[], colors: ThreadColor[]) {
  const normalized = normalizeForPec(stitches);
  const bytes: number[] = [];
  writePecHeader(bytes, colors);
  writePecBlock(bytes, normalized);
  writePecGraphics(bytes, Math.max(colors.length, 1));
  return Buffer.from(bytes);
}

export function encodePes(stitches: Stitch[], colors: ThreadColor[]) {
  const bytes: number[] = [];
  const normalized = normalizeForPec(stitches);
  const bounds = getBounds(normalized);
  const cx = (bounds.maxX + bounds.minX) / 2;
  const cy = (bounds.maxY + bounds.minY) / 2;
  const left = bounds.minX - cx;
  const top = bounds.minY - cy;
  const right = bounds.maxX - cx;
  const bottom = bounds.maxY - cy;
  const palette = buildPecPaletteIndices(colors);

  const writePesString16 = (value: string) => {
    pushInt16Le(bytes, value.length);
    pushAscii(bytes, value);
  };

  const writePesHeaderV1 = (distinctBlockObjects: number) => {
    pushInt16Le(bytes, 0x01);
    pushInt16Le(bytes, 0x01);
    pushInt16Le(bytes, distinctBlockObjects);
  };

  const writePesSewSegHeader = () => {
    const width = right - left;
    const height = bottom - top;
    const hoopHeight = 1800;
    const hoopWidth = 1300;
    for (let index = 0; index < 8; index += 1) pushInt16Le(bytes, 0);
    const transX = 350 + hoopWidth / 2 - width / 2;
    const transY = 100 + height + hoopHeight / 2 - height / 2;
    pushFloat32Le(bytes, 1);
    pushFloat32Le(bytes, 0);
    pushFloat32Le(bytes, 0);
    pushFloat32Le(bytes, 1);
    pushFloat32Le(bytes, transX);
    pushFloat32Le(bytes, transY);
    pushInt16Le(bytes, 1);
    pushInt16Le(bytes, 0);
    pushInt16Le(bytes, 0);
    pushInt16Le(bytes, Math.round(width));
    pushInt16Le(bytes, Math.round(height));
    bytes.push(0, 0, 0, 0, 0, 0, 0, 0);
    const placeholder = bytes.length;
    pushInt16Le(bytes, 0);
    return placeholder;
  };

  const commandBlocks: Array<{ command: WriterCommand; points: Array<{ x: number; y: number }>; colorCode: number }> = [];
  let currentColor = 0;
  let currentBlock: { command: WriterCommand; points: Array<{ x: number; y: number }>; colorCode: number } | null = null;
  for (const stitch of normalized) {
    if (stitch.command === 'trim' || stitch.command === 'end') continue;
    if (stitch.command === 'color-change') {
      if (currentBlock?.points.length) commandBlocks.push(currentBlock);
      currentBlock = null;
      currentColor = Math.min(currentColor + 1, Math.max(0, palette.length - 1));
      continue;
    }
    const colorCode = palette[Math.min(currentColor, Math.max(0, palette.length - 1))] ?? 0;
    if (!currentBlock || currentBlock.command !== stitch.command || currentBlock.colorCode !== colorCode) {
      if (currentBlock?.points.length) commandBlocks.push(currentBlock);
      currentBlock = { command: stitch.command, points: [], colorCode };
    }
    currentBlock.points.push({ x: stitch.x, y: stitch.y });
  }
  if (currentBlock?.points.length) commandBlocks.push(currentBlock);

  pushAscii(bytes, '#PES0001');
  const pecPointerOffset = bytes.length;
  pushInt32Le(bytes, 0);
  if (!commandBlocks.length) {
    writePesHeaderV1(0);
    pushInt16Le(bytes, 0x0000);
    pushInt16Le(bytes, 0x0000);
  } else {
    writePesHeaderV1(1);
    pushInt16Le(bytes, 0xffff);
    pushInt16Le(bytes, 0x0000);
    writePesString16('CEmbOne');
    const sewSegHeaderOffset = writePesSewSegHeader();
    pushInt16Le(bytes, 0xffff);
    pushInt16Le(bytes, 0x0000);
    writePesString16('CSewSeg');

    let sections = 0;
    const colorLog: Array<[number, number]> = [];
    let previousColorCode = -1;
    const adjustX = left + cx;
    const adjustY = bottom + cy;
    for (const block of commandBlocks) {
      if (sections > 0) pushInt16Le(bytes, 0x8003);
      if (previousColorCode !== block.colorCode) {
        colorLog.push([sections, block.colorCode]);
        previousColorCode = block.colorCode;
      }
      const flag = block.command === 'jump' ? 1 : 0;
      pushInt16Le(bytes, flag);
      pushInt16Le(bytes, block.colorCode);
      pushInt16Le(bytes, block.points.length);
      for (const point of block.points) {
        pushInt16Le(bytes, Math.round(point.x - adjustX));
        pushInt16Le(bytes, Math.round(point.y - adjustY));
      }
      sections += 1;
    }
    pushInt16Le(bytes, colorLog.length);
    for (const [section, colorCode] of colorLog) {
      pushInt16Le(bytes, section);
      pushInt16Le(bytes, colorCode);
    }

    const sectionView = new DataView(new ArrayBuffer(2));
    sectionView.setUint16(0, sections, true);
    bytes[sewSegHeaderOffset] = sectionView.getUint8(0);
    bytes[sewSegHeaderOffset + 1] = sectionView.getUint8(1);

    pushInt16Le(bytes, 0x0000);
    pushInt16Le(bytes, 0x0000);
  }
  const pecStart = bytes.length;
  const pointerView = new DataView(new ArrayBuffer(4));
  pointerView.setUint32(0, pecStart, true);
  bytes[pecPointerOffset] = pointerView.getUint8(0);
  bytes[pecPointerOffset + 1] = pointerView.getUint8(1);
  bytes[pecPointerOffset + 2] = pointerView.getUint8(2);
  bytes[pecPointerOffset + 3] = pointerView.getUint8(3);
  bytes.push(...encodePec(stitches, colors));
  return Buffer.from(bytes);
}

function getJefHoopSize(width: number, height: number) {
  if (width < 500 && height < 500) return 1;
  if (width < 1260 && height < 1100) return 3;
  if (width < 1400 && height < 2000) return 2;
  if (width < 2000 && height < 2000) return 4;
  return 0;
}

function writeHoopDistance(bytes: number[], x: number, y: number) {
  if (Math.min(x, y) >= 0) {
    pushInt32Le(bytes, x);
    pushInt32Le(bytes, y);
    pushInt32Le(bytes, x);
    pushInt32Le(bytes, y);
    return;
  }
  pushInt32Le(bytes, -1);
  pushInt32Le(bytes, -1);
  pushInt32Le(bytes, -1);
  pushInt32Le(bytes, -1);
}

export function encodeJef(stitches: Stitch[], colors: ThreadColor[]) {
  const normalized = normalizeForExpOrJef(stitches);
  const bytes: number[] = [];
  const bounds = getBounds(normalized);
  const designWidth = roundUnit(bounds.maxX - bounds.minX);
  const designHeight = roundUnit(bounds.maxY - bounds.minY);
  const colorCount = Math.max(colors.length, 1);
  const pointCount = normalized.reduce((count, stitch) => {
    if (stitch.command === 'stitch') return count + 1;
    if (stitch.command === 'jump' || stitch.command === 'color-change') return count + 2;
    return count;
  }, 1);
  const offsets = 0x74 + (colorCount * 8);
  const date = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14).padEnd(14, '0');
  pushInt32Le(bytes, offsets);
  pushInt32Le(bytes, 0x14);
  pushAscii(bytes, date);
  bytes.push(0x00, 0x00);
  pushInt32Le(bytes, colorCount);
  pushInt32Le(bytes, pointCount);
  pushInt32Le(bytes, getJefHoopSize(designWidth, designHeight));
  const halfWidth = Math.round(designWidth / 2);
  const halfHeight = Math.round(designHeight / 2);
  pushInt32Le(bytes, halfWidth);
  pushInt32Le(bytes, halfHeight);
  pushInt32Le(bytes, halfWidth);
  pushInt32Le(bytes, halfHeight);
  writeHoopDistance(bytes, 550 - halfWidth, 550 - halfHeight);
  writeHoopDistance(bytes, 250 - halfWidth, 250 - halfHeight);
  writeHoopDistance(bytes, 700 - halfWidth, 1000 - halfHeight);
  writeHoopDistance(bytes, 700 - halfWidth, 1000 - halfHeight);
  for (let index = 0; index < colorCount; index += 1) pushInt32Le(bytes, index % 78);
  for (let index = 0; index < colorCount; index += 1) pushInt32Le(bytes, 0x0d);

  let current = { x: 0, y: 0 };
  for (const stitch of normalized) {
    if (stitch.command === 'trim') continue;
    if (stitch.command === 'end') break;
    const dx = roundUnit(stitch.x - current.x);
    const dy = roundUnit(current.y - stitch.y);
    current = { x: stitch.x, y: stitch.y };
    if (stitch.command === 'stitch') {
      bytes.push(signedByte(dx), signedByte(dy));
    } else if (stitch.command === 'color-change') {
      bytes.push(0x80, 0x01, signedByte(dx), signedByte(dy));
    } else if (stitch.command === 'jump') {
      bytes.push(0x80, 0x02, signedByte(dx), signedByte(dy));
    }
  }
  bytes.push(0x80, 0x10);
  return Buffer.from(bytes);
}

export function encodeAllFormats(stitches: Stitch[], colors: ThreadColor[], designName = 'MJIC') {
  return {
    dst: encodeDst(stitches, designName),
    exp: encodeExp(stitches),
    pes: encodePes(stitches, colors),
    jef: encodeJef(stitches, colors),
  };
}
