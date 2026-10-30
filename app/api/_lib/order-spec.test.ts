import assert from 'node:assert/strict';
import test from 'node:test';

import { itemizedTotal, normalizeOrderSpec, orderSpecToColumns, sizeMatrixCounts } from './order-spec.ts';

test('normalizeOrderSpec keeps valid fields and drops bad dates', () => {
  const spec = normalizeOrderSpec({
    organizationName: '  Ateneo Dance Club ',
    targetDeadline: '2026-12-15',
    garmentType: 'Jersey',
    printMethod: 'Sublimation',
  });
  assert.equal(spec.organizationName, 'Ateneo Dance Club');
  assert.equal(spec.targetDeadline, '2026-12-15');
  assert.equal(spec.garmentType, 'Jersey');
  assert.equal(spec.contactPerson, null);
  assert.deepEqual(spec.itemizedItems, []);
  assert.equal(normalizeOrderSpec({ targetDeadline: '12/15/2026' }).targetDeadline, null);
});

test('itemized lines compute amount and totals', () => {
  const spec = normalizeOrderSpec({
    itemizedItems: [
      { description: 'Jacket', qty: 3, unitPrice: '₱1,250.50' },
      { description: 'Jersey', qty: 10, unitPrice: 300 },
      { description: 'Empty', qty: 0, unitPrice: 0 },
    ],
  });
  assert.equal(spec.itemizedItems.length, 2);
  assert.equal(spec.itemizedItems[0].amount, 3751.5);
  assert.equal(itemizedTotal(spec.itemizedItems), 6751.5);
});

test('size matrix keeps valid sizes and counts pieces per size', () => {
  const spec = normalizeOrderSpec({
    sizeMatrix: [
      { name: 'Juan', size: 'm', customNumber: '07' },
      { name: 'Pedro', size: 'M' },
      { name: 'Ana', size: 'XXL' },
      { name: '', size: 'XL' },
      { name: '', size: '' },
    ],
  });
  assert.equal(spec.sizeMatrix.length, 4);
  assert.equal(spec.sizeMatrix[0].size, 'M');
  assert.equal(spec.sizeMatrix[2].size, '');
  assert.deepEqual(sizeMatrixCounts(spec.sizeMatrix), { M: 2, XL: 1 });
});

test('orderSpecToColumns maps to snake_case columns', () => {
  const columns = orderSpecToColumns(normalizeOrderSpec({ garmentType: 'Hoodie' }));
  assert.equal(columns.garment_type, 'Hoodie');
  assert.deepEqual(columns.itemized_items, []);
  assert.deepEqual(columns.size_matrix, []);
});
