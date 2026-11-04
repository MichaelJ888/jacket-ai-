import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_FORM, applyDesignScan, formatPeso, toRequestBody } from './quotation-logic.ts';

test('toRequestBody coerces form strings to numbers and trims text', () => {
  const body = toRequestBody({
    ...EMPTY_FORM,
    customerName: '  CG Venezuela  ',
    quantity: '40',
    marketUnitPrice: '1250',
    discountPesos: '2500',
    frontLogos: '',
    backLogos: '2',
  });
  assert.equal(body.customerName, 'CG Venezuela');
  assert.equal(body.quantity, 40);
  assert.equal(body.marketUnitPrice, 1250);
  assert.equal(body.discountPesos, 2500);
  assert.equal(body.frontLogos, 0);
  assert.equal(body.backLogos, 2);
  assert.equal(body.signatory, 'venezuela');
});

test('applyDesignScan copies detected decoration and keeps the rest of the form', () => {
  const form = applyDesignScan(
    { ...EMPTY_FORM, customerName: 'Client', discountPesos: '500' },
    { frontLogos: 2, backLogos: 1, reversible: true, hood: false, threeTone: true, isTshirt: false, isFullSublimation: false, notes: 'x' },
  );
  assert.equal(form.frontLogos, '2');
  assert.equal(form.backLogos, '1');
  assert.equal(form.reversible, true);
  assert.equal(form.threeTone, true);
  assert.equal(form.customerName, 'Client');
  assert.equal(form.discountPesos, '500');
});

test('formatPeso renders two decimals with the peso sign', () => {
  assert.equal(formatPeso(61000), '₱61,000.00');
  assert.equal(formatPeso(0.5), '₱0.50');
});
