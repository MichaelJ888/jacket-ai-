import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFormalQuote, type FormalQuoteInput } from './formal-quote.ts';

const base: FormalQuoteInput = {
  quantity: 100,
  marketUnitPrice: 1250,
  productClass: 'B',
  frontLogos: 1,
  backLogos: 0,
  reversible: false,
  hood: false,
  threeTone: false,
  isTshirt: false,
  isFullSublimation: false,
};

test('garment price uses the volume tier on the market rate', () => {
  const q = computeFormalQuote(base);
  assert.equal(q.garmentUnit, 850); // 1250 less 32% at 100 pcs
  assert.equal(q.subtotal, 85000);
  assert.equal(q.total, 85000);
});

test('rejects orders below MOQ', () => {
  assert.throws(() => computeFormalQuote({ ...base, quantity: 19 }), /Minimum order is 20/);
});

test('Class A adds 300 per piece; Class B does not', () => {
  const a = computeFormalQuote({ ...base, productClass: 'A' });
  const b = computeFormalQuote(base);
  assert.equal(a.addOns.classASurcharge, 300);
  assert.equal(a.unitPrice - b.unitPrice, 300);
});

test('full-sublimation bombers are exempt from the Class A surcharge', () => {
  const q = computeFormalQuote({ ...base, productClass: 'A', isFullSublimation: true });
  assert.equal(q.addOns.classASurcharge, 0);
});

test('extra front logos at 65 and back logos at 150 per piece', () => {
  const q = computeFormalQuote({ ...base, frontLogos: 3, backLogos: 2 });
  assert.equal(q.addOns.extraFrontLogos, 2 * 65);
  assert.equal(q.addOns.backLogos, 2 * 150);
});

test('reversible 400, hood 100, three-tone 100 per piece', () => {
  const q = computeFormalQuote({ ...base, reversible: true, hood: true, threeTone: true });
  assert.equal(q.addOns.perPiece, 400 + 100 + 100);
});

test('three-tone does not apply to T-shirts', () => {
  const q = computeFormalQuote({ ...base, threeTone: true, isTshirt: true });
  assert.equal(q.addOns.threeTone, 0);
});

test('program fee: 1000 per logo location, first front logo free, only up to 300 pcs', () => {
  const small = computeFormalQuote({ ...base, frontLogos: 1, backLogos: 1 });
  assert.equal(small.programFee, 1000);
  const none = computeFormalQuote({ ...base, frontLogos: 1, backLogos: 0 });
  assert.equal(none.programFee, 0);
  const large = computeFormalQuote({ ...base, quantity: 400, frontLogos: 1, backLogos: 1 });
  assert.equal(large.programFee, 0);
});

test('discount is a fixed peso amount taken off the final total, capped at the subtotal', () => {
  const q = computeFormalQuote({ ...base, discountPesos: 5000 });
  assert.equal(q.discount, 5000);
  assert.equal(q.total, 80000);
  const capped = computeFormalQuote({ ...base, discountPesos: 1e9 });
  assert.equal(capped.total, 0);
});

test('deposit is 50% of the total after discount, rounded up; balance is the rest', () => {
  const q = computeFormalQuote({ ...base, discountPesos: 1001 });
  assert.equal(q.total, 83999);
  assert.equal(q.deposit, 42000);
  assert.equal(q.balance, 41999);
});

test('signature blocks name both signatories', () => {
  const q = computeFormalQuote(base);
  assert.deepEqual(q.signatures.map((s) => s.name), ['Anne Manalo', 'Richard Venezuela']);
});
