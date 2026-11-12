import assert from 'node:assert/strict';
import test from 'node:test';
import { digitizeQuote, quoteBulkOrder, quoteUniformOrder, recommendPrice, volumeDiscountPct, volumeLadder, tierUnitPrice } from './pricing-logic.ts';

test('digitizeQuote converts stitches to machine time and cost per piece', () => {
  const q = digitizeQuote({ stitchCount: 7000, machineRatePerHour: 300, quantity: 100, garmentCostPerPiece: 200 });
  assert.equal(q.machineMinutesPerPiece, 10);
  assert.equal(q.embroideryCostPerPiece, 50);
  assert.equal(q.unitCostPerPiece, 250);
  assert.equal(q.machineMinutesTotal, 1000);
  assert.ok(q.costFloorPerPiece >= 300, 'floor is at least 1.2x unit cost');
  assert.equal(q.costFloorTotal, q.costFloorPerPiece * 100);
  assert.equal(q.action, 'NO_PRICE');
});

test('digitizeQuote with zero machine rate charges no embroidery cost and sanitizes bad input', () => {
  const q = digitizeQuote({ stitchCount: -5, machineRatePerHour: NaN, quantity: 0, currentUnitPrice: 0 });
  assert.equal(q.stitchCount, 0);
  assert.equal(q.machineRatePerHour, 0);
  assert.equal(q.embroideryCostPerPiece, 0);
  assert.equal(q.quantity, 0);
  assert.equal(q.currentUnitPrice, null);
});

test('digitizeQuote flags a current price below the floor as RAISE', () => {
  const q = digitizeQuote({ stitchCount: 7000, machineRatePerHour: 300, quantity: 20, garmentCostPerPiece: 200, currentUnitPrice: 100 });
  assert.equal(q.action, 'RAISE');
  assert.ok((q.suggestedUnitPrice ?? 0) > 100);
});

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

test('company uniform quotes enforce 50 sets and include optional blazer pricing without generic discounts', () => {
  const belowMinimum = quoteUniformOrder({ category: 'company_uniform', quantity: 49 });
  assert.equal(belowMinimum.quoteable, false);
  if (!belowMinimum.quoteable) assert.equal(belowMinimum.setsShort, 1);

  const quote = quoteUniformOrder({ category: 'company_uniform', quantity: 50, includeBlazer: true });
  assert.equal(quote.quoteable, true);
  if (quote.quoteable) {
    assert.equal(quote.pricePerSet, 2300);
    assert.equal(quote.grossTotal, 115000);
    assert.equal(quote.depositRequired, 57500);
    assert.equal(quote.discountPct, 0);
  }
});

test('school uniform quotes require selected garments and enforce 100 sets at fixed piece prices', () => {
  const missingGarments = quoteUniformOrder({ category: 'school_uniform', quantity: 100 });
  assert.equal(missingGarments.quoteable, false);

  const belowMinimum = quoteUniformOrder({ category: 'school_uniform', quantity: 99, garments: ['blouse', 'skirt'] });
  assert.equal(belowMinimum.quoteable, false);
  if (!belowMinimum.quoteable) assert.equal(belowMinimum.minimumSets, 100);

  const quote = quoteUniformOrder({
    category: 'school_uniform',
    quantity: 100,
    garments: ['blouse', 'skirt', 'blouse'],
  });
  assert.equal(quote.quoteable, true);
  if (quote.quoteable) {
    assert.deepEqual(quote.garments, ['blouse', 'skirt']);
    assert.equal(quote.pricePerSet, 800);
    assert.equal(quote.grossTotal, 80000);
    assert.equal(quote.depositRequired, 40000);
    assert.equal(quote.discountPct, 0);
  }
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

