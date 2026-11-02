import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStitchSettings } from './stitch-settings.ts';

const plain = { regionCount: 10, tinyRegionCount: 0, maxSideMm: 200 };
const detailed = { regionCount: 10, tinyRegionCount: 5, maxSideMm: 200 };
const small = { regionCount: 10, tinyRegionCount: 0, maxSideMm: 30 };

test('uses fabric preset defaults when auto-tune is off', () => {
  const s = resolveStitchSettings({ fabric: 'polo-knit', autoTune: false }, plain);
  assert.equal(s.rowSpacingMm, 0.45);
  assert.equal(s.fillStitchMm, 3.2);
  assert.equal(s.pullCompMm, 0.4);
  assert.deepEqual(s.notes, []);
});

test('falls back to cotton-uniform for unknown fabric', () => {
  const s = resolveStitchSettings({ fabric: 'nylon-bogus' }, plain);
  assert.equal(s.fabric, 'cotton-uniform');
});

test('auto-tune tightens rows and shortens fills for fine detail', () => {
  const s = resolveStitchSettings({ fabric: 'cotton-uniform' }, detailed);
  assert.equal(s.rowSpacingMm, 0.35);
  assert.equal(s.fillStitchMm, 2);
  assert.ok(s.notes.some((n) => n.startsWith('Fine detail')));
});

test('auto-tune shortens fills for small designs', () => {
  const s = resolveStitchSettings({}, small);
  assert.equal(s.fillStitchMm, 2);
  assert.ok(s.notes.some((n) => n.startsWith('Small design')));
});

test('high precision multiplies row and fill by 0.85', () => {
  const standard = resolveStitchSettings({ autoTune: false }, plain);
  const high = resolveStitchSettings({ autoTune: false, precision: 'high' }, plain);
  assert.equal(high.rowSpacingMm, 0.34);
  assert.equal(high.fillStitchMm, 2.21);
  assert.ok(high.rowSpacingMm < standard.rowSpacingMm);
});

test('explicit overrides win over auto-tune and presets', () => {
  const s = resolveStitchSettings({ rowSpacingMm: '0.6', fillStitchMm: 4, pullCompMm: '0.1' }, detailed);
  assert.equal(s.rowSpacingMm, 0.6);
  assert.equal(s.fillStitchMm, 4);
  assert.equal(s.pullCompMm, 0.1);
});

test('empty-string overrides are ignored', () => {
  const s = resolveStitchSettings({ rowSpacingMm: '', fillStitchMm: '' }, plain);
  assert.equal(s.rowSpacingMm, 0.4);
  assert.equal(s.fillStitchMm, 2.6);
});

test('clamps out-of-range values to safe limits', () => {
  const s = resolveStitchSettings({ angle: 999, rowSpacingMm: 9, fillStitchMm: 0.1, pullCompMm: 5 }, plain);
  assert.equal(s.angle, 180);
  assert.equal(s.rowSpacingMm, 1.2);
  assert.equal(s.fillStitchMm, 1.2);
  assert.equal(s.pullCompMm, 0.6);
});

test('non-numeric angle falls back to 45', () => {
  assert.equal(resolveStitchSettings({ angle: 'abc' }, plain).angle, 45);
});

test('autoTune string "false" disables auto-tune', () => {
  const s = resolveStitchSettings({ autoTune: 'false' }, detailed);
  assert.equal(s.autoTune, false);
  assert.equal(s.rowSpacingMm, 0.4);
});
