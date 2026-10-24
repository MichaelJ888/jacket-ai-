import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductionSheet, splitIntoColumns, toBlackAndWhite } from './production-sheet-logic.ts';

test('toBlackAndWhite maps dark colors to black and light colors to white', () => {
  assert.equal(toBlackAndWhite('#102030'), '#000000');
  assert.equal(toBlackAndWhite('#ffeeaa'), '#ffffff');
  assert.equal(toBlackAndWhite('ff0000'), '#000000');
  assert.throws(() => toBlackAndWhite('red'), /Invalid hex color/);
});

test('splitIntoColumns balances columns and keeps every item once', () => {
  const columns = splitIntoColumns([1, 2, 3, 4, 5, 6, 7], 3);
  assert.deepEqual(columns.map((c) => c.length), [3, 2, 2]);
  assert.deepEqual(columns.flat(), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(splitIntoColumns([], 3), []);
  assert.throws(() => splitIntoColumns([1], 0), /at least 1/);
});

test('buildProductionSheet sorts by thread code and labels multi-column sheets', () => {
  const colors = Array.from({ length: 5 }, (_, i) => ({ code: `T${5 - i}`, name: `Color ${i}`, hex: '#000000', stitches: 100 }));
  const sheet = buildProductionSheet(colors, 3);
  assert.equal(sheet.length, 2);
  assert.equal(sheet[0].label, 'Column 1 of 2');
  assert.equal(sheet[0].items[0].code, 'T1');
  assert.equal(sheet.flatMap((c) => c.items).length, 5);
  assert.equal(buildProductionSheet(colors.slice(0, 2))[0].label, 'Legend');
});
