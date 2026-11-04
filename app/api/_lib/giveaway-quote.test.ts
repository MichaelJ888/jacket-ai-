import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeGiveawayQuote,
  GiveawayQuoteError,
  overlayGiveawayCatalog,
  seedGiveawayCatalog,
} from './giveaway-quote.ts';

test('giveaway catalog seeds the official tables with per-category MOQs', () => {
  const catalog = seedGiveawayCatalog();
  const tote = catalog.find((c) => c.key === 'tote-bag')!;
  const mug = catalog.find((c) => c.key === 'mug')!;
  const lanyard = catalog.find((c) => c.key === 'lanyard')!;
  const pin = catalog.find((c) => c.key === 'enamel-pin')!;
  assert.equal(tote.moq, 50);
  assert.equal(mug.moq, 50);
  assert.equal(lanyard.moq, 10);
  assert.equal(pin.moq, 10);
  assert.ok(tote.singleTier, 'tote bag is the flat official base rate');
  assert.ok(!lanyard.singleTier, 'lanyard has the full official tier table');
});

test('itemized quote: official tier prices, subtotal, and 50% deposit math', () => {
  const quote = computeGiveawayQuote([
    { key: 'lanyard', quantity: 100 }, // 58/pc official tier
    { key: 'mug', quantity: 50 }, // 180 flat
  ]);
  const lanyard = quote.lines.find((l) => l.key === 'lanyard')!;
  const mug = quote.lines.find((l) => l.key === 'mug')!;
  assert.equal(lanyard.unitPrice, 58);
  assert.equal(lanyard.subtotal, 5800);
  assert.equal(mug.unitPrice, 180);
  assert.equal(mug.subtotal, 9000);
  assert.equal(quote.subtotal, 14800);
  assert.equal(quote.depositPct, 50);
  assert.equal(quote.deposit, 7400);
  assert.equal(quote.balance, 7400);
  assert.equal(quote.totalQuantity, 150);
});

test('below-MOQ, duplicates, and unknown items are rejected', () => {
  assert.throws(() => computeGiveawayQuote([{ key: 'tote-bag', quantity: 49 }]), GiveawayQuoteError);
  assert.throws(() => computeGiveawayQuote([{ key: 'mug', quantity: 50 }, { key: 'mug', quantity: 100 }]), GiveawayQuoteError);
  assert.throws(() => computeGiveawayQuote([{ key: 'jacket', quantity: 100 }]), GiveawayQuoteError);
  assert.throws(() => computeGiveawayQuote([]), GiveawayQuoteError);
});

test('DB overlay refines giveaway tiers without leaking unknown keys', () => {
  const overlaid = overlayGiveawayCatalog([
    { key: 'tote-bag', label: 'Eco Bags, Tote Bags & Backpacks', active: true, tiers: [{ min: 50, max: 499, price: 250 }, { min: 500, max: 999999, price: 210 }] },
    { key: 't-shirt', label: 'T-Shirt', active: true, tiers: [{ min: 1, max: 9, price: 1 }] },
  ]);
  const tote = overlaid.find((c) => c.key === 'tote-bag')!;
  assert.equal(tote.tiers.length, 2, 'DB tiers replace the seed');
  assert.ok(!overlaid.some((c) => c.key === 't-shirt'), 'garment/unknown keys never enter the giveaway catalog');
  const quote = computeGiveawayQuote([{ key: 'tote-bag', quantity: 500 }], overlaid);
  assert.equal(quote.lines[0].unitPrice, 210);
});
