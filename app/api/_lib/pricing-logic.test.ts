import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteBulkOrder, recommendPrice } from './pricing-logic.ts';

test('quoteBulkOrder enforces 20-pc MOQ and charges catalog price x qty only', () => {
  const short = quoteBulkOrder(500, 12);
  assert.equal(short.moqMet, false);
  assert.equal(short.piecesShort, 8);
  const ok = quoteBulkOrder(500, 20);
  assert.equal(ok.moqMet, true);
  assert.equal(ok.subtotal, 10000);
  assert.equal(ok.total, 10000);
  assert.ok(ok.freeAddOns.includes('metro-manila-delivery'));
  assert.ok(ok.freeAddOns.includes('digital-mockup'));
  assert.ok(ok.freeAddOns.includes('first-logo-embroidery'));
});

test('quoteBulkOrder sanitizes invalid input', () => {
  assert.equal(quoteBulkOrder(NaN, 20).subtotal, 0);
  assert.equal(quoteBulkOrder(500, -5).pieces, 0);
});

test('recommends a raise when margin is below target', () => {
  const result = recommendPrice(700, 35, 850);
  assert.equal(result.suggested, 1080);
  assert.equal(result.action, 'RAISE');
});

test('holds when price already meets target', () => {
  assert.equal(recommendPrice(400, 35, 800).action, 'ROOM_TO_DISCOUNT');
  assert.equal(recommendPrice(520, 35, 800).action, 'HOLD');
});


