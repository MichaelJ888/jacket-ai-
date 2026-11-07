import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQuote, normalizeCategoryInput, seedPricelist, tierPrice, volumeBracket, QuoteValidationError } from './pricelist-logic.ts';

const tiers = [
  { min: 5, max: 20, price: 800 },
  { min: 21, max: 50, price: 650 },
];

test('tierPrice picks the covering tier and returns null outside all tiers', () => {
  assert.equal(tierPrice(tiers, 5), 800);
  assert.equal(tierPrice(tiers, 50), 650);
  assert.equal(tierPrice(tiers, 4), null);
  assert.equal(tierPrice(tiers, 51), null);
  assert.equal(tierPrice(tiers, Number.NaN), null);
});

test('seedPricelist mirrors the official tables and labels', () => {
  const seed = seedPricelist();
  const polo = seed.categories.find((c) => c.key === 'polo-shirt');
  assert.ok(polo);
  assert.equal(polo.label, 'Polo Shirt');
  assert.equal(tierPrice(polo.tiers, 30), 650);
  const tshirt = seed.categories.find((c) => c.key === 't-shirt');
  assert.deepEqual(tshirt?.tiers, []);
});

test('normalizeCategoryInput accepts valid input and sorts tiers', () => {
  const cat = normalizeCategoryInput({
    key: ' T-Shirt ',
    label: 'T-Shirt',
    tiers: [{ min: 21, max: 50, price: 300 }, { min: 1, max: 20, price: 350 }],
  });
  assert.equal(cat.key, 't-shirt');
  assert.equal(cat.active, true);
  assert.deepEqual(cat.tiers.map((t) => t.min), [1, 21]);
});

test('normalizeCategoryInput rejects bad keys, labels, quantities, prices, and overlaps', () => {
  const base = { key: 'uniform', label: 'Uniform', tiers: [{ min: 1, max: 10, price: 100 }] };
  assert.throws(() => normalizeCategoryInput({ ...base, key: 'Bad Key!' }), /key/);
  assert.throws(() => normalizeCategoryInput({ ...base, label: 'x' }), /Label/);
  assert.throws(() => normalizeCategoryInput({ ...base, tiers: [{ min: 0, max: 5, price: 10 }] }), /quantities/);
  assert.throws(() => normalizeCategoryInput({ ...base, tiers: [{ min: 10, max: 5, price: 10 }] }), /quantities/);
  assert.throws(() => normalizeCategoryInput({ ...base, tiers: [{ min: 1, max: 5, price: 0 }] }), /price/);
  assert.throws(
    () => normalizeCategoryInput({ ...base, tiers: [{ min: 1, max: 10, price: 5 }, { min: 10, max: 20, price: 4 }] }),
    /overlap/,
  );
});

test('volumeBracket labels the four corporate brackets and returns null below 20', () => {
  assert.equal(volumeBracket(19), null);
  assert.equal(volumeBracket(20), '20–49 pcs');
  assert.equal(volumeBracket(49), '20–49 pcs');
  assert.equal(volumeBracket(50), '50–99 pcs');
  assert.equal(volumeBracket(150), '100–249 pcs');
  assert.equal(volumeBracket(250), '250+ pcs');
});

test('calculateQuote enforces MOQ 20 for core apparel and keeps official floors elsewhere', () => {
  const catalog = seedPricelist().categories;
  const jacket = catalog.find((c) => c.key === 'jacket')!;
  const scrub = catalog.find((c) => c.key === 'scrub-suit')!;
  const polo = catalog.find((c) => c.key === 'polo-shirt')!;
  assert.throws(() => calculateQuote({ category: jacket, quantity: 19 }), QuoteValidationError);
  assert.equal(calculateQuote({ category: jacket, quantity: 20 }).minQuantity, 20);
  assert.throws(() => calculateQuote({ category: scrub, quantity: 19 }), QuoteValidationError);
  assert.equal(calculateQuote({ category: polo, quantity: 5 }).minQuantity, 5);
});

test('calculateQuote adds modular add-ons per piece and rejects unknown keys', () => {
  const jacket = seedPricelist().categories.find((c) => c.key === 'jacket')!;
  const priced = calculateQuote({ category: jacket, quantity: 50, addOns: ['embroidery', 'vinyl-print', 'embroidery'] });
  assert.deepEqual(priced.addOns, ['embroidery', 'vinyl-print']);
  assert.equal(priced.addOnPerPiece, 90);
  assert.equal(priced.bracket, '50–99 pcs');
  assert.throws(() => calculateQuote({ category: jacket, quantity: 50, addOns: ['glitter'] }), QuoteValidationError);
});

