import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPlanPreview, parseCsv, planImport } from './csv-import-logic.ts';

const columns = [
  { name: 'sku', required: true },
  { name: 'price', required: true, type: 'number' as const },
  { name: 'qty', type: 'integer' as const },
];

test('parseCsv handles quoted commas, escaped quotes, and CRLF', () => {
  const rows = parseCsv('sku,name\r\nA1,"Polo, long sleeve"\r\nA2,"say ""hi"""\r\n');
  assert.deepEqual(rows, [['sku', 'name'], ['A1', 'Polo, long sleeve'], ['A2', 'say "hi"']]);
});

test('planImport reports row-level validation errors and blocks the import', () => {
  const result = planImport(['sku', 'price', 'qty'], [['A1', 'abc', '2'], ['', '10', '1.5']], columns, 'sku');
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => `${e.row}:${e.column}`), ['2:price', '3:sku', '3:qty', '3:sku']);
  assert.equal(result.plan.length, 0);
});

test('planImport detects duplicate keys', () => {
  const result = planImport(['sku', 'price', 'qty'], [['A1', '10', '1'], ['A1', '12', '1']], columns, 'sku');
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /duplicate key "A1" \(first on row 2\)/);
});

test('planImport splits rows into insert, update with field diffs, and unchanged', () => {
  const existing = { A1: { sku: 'A1', price: '10', qty: '5' }, A2: { sku: 'A2', price: '20', qty: '3' } };
  const result = planImport(
    ['sku', 'price', 'qty'],
    [['A1', '10', '7'], ['A2', '20', '3'], ['A3', '30', '1']],
    columns,
    'sku',
    existing,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { insert: 1, update: 1, unchanged: 1 });
  const update = result.plan.find((item) => item.action === 'update');
  assert.deepEqual(update?.action === 'update' && update.diffs, [{ column: 'qty', before: '5', after: '7' }]);
});

test('planImport fails fast when a required column is missing from the header', () => {
  const result = planImport(['sku', 'qty'], [], columns, 'sku');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.column === 'price' && e.row === 0));
});

test('formatPlanPreview tells the CEO nothing was written yet', () => {
  const result = planImport(['sku', 'price', 'qty'], [['A1', '10', '1']], columns, 'sku');
  assert.match(formatPlanPreview(result), /Nothing has been written yet/);
});
