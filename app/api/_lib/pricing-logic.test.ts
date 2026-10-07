import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendPrice } from './pricing-logic.ts';

test('recommends a raise when margin is below target', () => {
  const result = recommendPrice(700, 35, 850);
  assert.equal(result.suggested, 1080);
  assert.equal(result.action, 'RAISE');
});

test('holds when price already meets target', () => {
  assert.equal(recommendPrice(400, 35, 800).action, 'ROOM_TO_DISCOUNT');
  assert.equal(recommendPrice(520, 35, 800).action, 'HOLD');
});


