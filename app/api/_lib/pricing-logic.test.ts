import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteBulkOrder, recommendPrice, volumeDiscountPct, volumeLadder, tierUnitPrice } from './pricing-logic.ts';

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

test('MOQ run pays the full market rate (cost ~300 -> 1,250/pc)', () => {
  const quote = quoteBulkOrder(1250, 20, 300);
  assert.equal(quote.unitPrice, 1250);
  assert.equal(quote.discountPct, 0);
  assert.equal(quote.subtotal, 25000);
});

test('volume discount narrows with quantity and never falls below the cost floor', () => {
  assert.equal(volumeDiscountPct(19), 0);
  assert.equal(volumeDiscountPct(50), 24);
  assert.equal(tierUnitPrice(1250, 50, 300), 950);
  assert.equal(tierUnitPrice(1250, 100, 300), 850);
  assert.equal(tierUnitPrice(1250, 1000, 300), 688);
  assert.equal(tierUnitPrice(400, 1000, 380), 456);
});

test('volume ladder never increases as quantity grows', () => {
  const ladder = volumeLadder(1250, 300).map((tier) => tier.unitPrice);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] <= ladder[i - 1]);
});

test('recommendPrice keeps a price that clears the cost floor', () => {
  const result = recommendPrice(300, 1250);
  assert.equal(result.floor, 360);
  assert.equal(result.action, 'HOLD');
  assert.equal(result.costCoverPct, 416.7);
});

test('recommendPrice raises a price that has fallen under the cost floor', () => {
  const result = recommendPrice(700, 800);
  assert.equal(result.floor, 840);
  assert.equal(result.suggested, 840);
  assert.equal(result.action, 'RAISE');
});


