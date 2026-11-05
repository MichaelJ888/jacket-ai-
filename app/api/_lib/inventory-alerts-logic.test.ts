import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isAtOrBelowReorder, stockCrossingAlert } from './inventory-alerts-logic.ts';

test('fires low only when stock crosses down through the reorder level', () => {
  assert.equal(stockCrossingAlert(12, 9, 10), 'low');
  assert.equal(stockCrossingAlert(11, 10, 10), 'low', 'landing exactly on reorder level alerts');
  assert.equal(stockCrossingAlert(9, 8, 10), null, 'already low: no repeat alert');
  assert.equal(stockCrossingAlert(20, 15, 10), null, 'still healthy');
});

test('fires shortage when stock goes negative for the first time', () => {
  assert.equal(stockCrossingAlert(3, -2, 10), 'shortage');
  assert.equal(stockCrossingAlert(-2, -5, 10), null);
});

test('untracked materials (reorder_level 0) never alert', () => {
  assert.equal(stockCrossingAlert(5, -1, 0), null);
  assert.equal(isAtOrBelowReorder(0, 0), false);
});

test('isAtOrBelowReorder is inclusive', () => {
  assert.equal(isAtOrBelowReorder(10, 10), true);
  assert.equal(isAtOrBelowReorder(11, 10), false);
});
