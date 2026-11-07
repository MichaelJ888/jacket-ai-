import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicQuote, PublicQuoteError } from './public-quote.ts';
import { officialUnitPrice } from './mjic-pricelist.ts';

const base = {
  customerName: 'Juan Dela Cruz',
  category: 'jacket',
  quantity: 50,
  fabric: 'Microfiber',
  frontLogos: 1,
  backLogos: 0,
};

test('jacket at 50 pcs uses the official 920 tier and ignores client-sent prices', () => {
  const result = buildPublicQuote({ ...base, unitPrice: 1, discountPct: 99, marketUnitPrice: 1 });
  assert.equal(result.kind, 'quote');
  if (result.kind !== 'quote') return;
  assert.equal(result.quote.garmentUnit, 920);
  assert.equal(result.quote.volumeDiscountPct, 0);
});

test('quantity below MOQ is rejected', () => {
  assert.throws(() => buildPublicQuote({ ...base, quantity: 19 }), PublicQuoteError);
});

test('quantity above the public cap is rejected', () => {
  assert.throws(() => buildPublicQuote({ ...base, quantity: 100001 }), PublicQuoteError);
});

test('core apparel MOQ is 20 for scrub suits, and bracket labels are returned', () => {
  assert.throws(() => buildPublicQuote({ ...base, category: 'scrub-suit', quantity: 19 }), PublicQuoteError);
  const scrub = buildPublicQuote({ ...base, category: 'scrub-suit', quantity: 20 });
  assert.equal(scrub.kind === 'quote' ? scrub.bracket : 'sales', '20–49 pcs');
});

test('modular add-ons are priced per piece into the formal quote and unknown add-ons are rejected', () => {
  const plain = buildPublicQuote({ ...base });
  assert.equal(plain.kind, 'quote');
  if (plain.kind !== 'quote') return;
  assert.equal(plain.quote.addOns.modularAddOns, 0);

  const withAddOns = buildPublicQuote({ ...base, addOns: ['embroidery', 'inner-lining'] });
  assert.equal(withAddOns.kind, 'quote');
  if (withAddOns.kind !== 'quote') return;
  assert.equal(withAddOns.quote.addOns.modularAddOns, 110);
  assert.equal(withAddOns.quote.unitPrice, withAddOns.quote.garmentUnit + withAddOns.quote.addOns.perPiece);
  assert.equal(withAddOns.quote.addOnSubtotal, withAddOns.quote.addOns.perPiece * 50);
  assert.deepEqual(withAddOns.request.addOns, ['embroidery', 'inner-lining']);

  assert.throws(() => buildPublicQuote({ ...base, addOns: ['glitter'] }), PublicQuoteError);
});


test('T-Shirt and Company Uniform return a sales-confirmation result, not a price', () => {
  for (const category of ['t-shirt', 'company-uniform']) {
    const result = buildPublicQuote({ ...base, category });
    assert.equal(result.kind, 'sales');
  }
});

test('strict rule: listed Class B fabrics carry no surcharge', () => {
  for (const fabric of ['Microfiber', 'Michael Angelo', 'Diamond Ripstop']) {
    const result = buildPublicQuote({ ...base, fabric });
    assert.equal(result.kind, 'quote');
    if (result.kind === 'quote') assert.equal(result.quote.addOns.classASurcharge, 0);
  }
});

test('strict rule: every other fabric, listed or custom, is Class A', () => {
  for (const fabric of ['Twill', 'Brush Cotton', 'Marks & Spencer', 'Stellini', 'Vellini', 'Dri-Fit', 'Some Custom Blend']) {
    const result = buildPublicQuote({ ...base, fabric });
    assert.equal(result.kind, 'quote');
    if (result.kind === 'quote') assert.equal(result.quote.addOns.classASurcharge, 300);
  }
});

test('client-sent productClass is ignored; class comes from fabric only', () => {
  const result = buildPublicQuote({ ...base, fabric: 'Twill', productClass: 'B' });
  assert.equal(result.kind, 'quote');
  if (result.kind === 'quote') assert.equal(result.quote.addOns.classASurcharge, 300);
});

test('official unit price returns null outside tiers and for categories without a table', () => {
  assert.equal(officialUnitPrice('t-shirt', 100), null);
  assert.equal(officialUnitPrice('jacket', 10), null);
  assert.equal(officialUnitPrice('polo-shirt', 5), 800);
  assert.equal(officialUnitPrice('school-uniform', 501), 700);
});

test('the 2026 official matrix prices the newly wired garment categories', () => {
  assert.equal(officialUnitPrice('polo-jacket', 5), 1000);
  assert.equal(officialUnitPrice('coverall', 201), 1400);
  assert.equal(officialUnitPrice('scrub-suit', 501), 780);
  assert.equal(officialUnitPrice('pe-uniform', 20), 800);
  assert.equal(officialUnitPrice('chef-uniform', 21), 1200);
  assert.equal(officialUnitPrice('security-uniform', 201), 1150);
});

test('category MOQ follows the official tier floor, not the company-wide 20', () => {
  // Polo tiers start at 5: 4 is rejected, 5 prices instantly.
  assert.throws(() => buildPublicQuote({ ...base, category: 'polo-shirt', quantity: 4 }), PublicQuoteError);
  const polo = buildPublicQuote({ ...base, category: 'polo-shirt', quantity: 5 });
  assert.equal(polo.kind, 'quote');
  if (polo.kind === 'quote') assert.equal(polo.quote.garmentUnit, 800);
  // Coverall tiers start at 5 as well.
  const coverall = buildPublicQuote({ ...base, category: 'coverall', quantity: 6 });
  assert.equal(coverall.kind, 'quote');
  if (coverall.kind === 'quote') assert.equal(coverall.quote.garmentUnit, 2500);
});
