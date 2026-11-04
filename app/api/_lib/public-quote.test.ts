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
