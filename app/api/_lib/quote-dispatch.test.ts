import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteInputFromRow } from './quote-dispatch-logic.ts';
import { quoteTotals } from './quote-pdf.ts';

const row = {
  quote_number: 'MJIC-2026-0001',
  customer_name: 'Test Client',
  customer_contact: 'client@example.com',
  product_name: 'Polo',
  created_at: '2026-11-05T02:00:00Z',
  breakdown: { quantity: 20, unitPrice: 300, programFee: 1000, discount: 200, total: 6800, deposit: 3400, validDays: 30, depositPct: 50 },
};

test('quote PDF line items reconcile to the saved total', () => {
  const input = quoteInputFromRow(row);
  const totals = quoteTotals(input.items, input.depositPct);
  assert.equal(totals.subtotal, 6800);
  assert.equal(totals.deposit, 3400);
  assert.equal(totals.balance, 3400);
});

test('quote input keeps number, customer, validity and deposit percent', () => {
  const input = quoteInputFromRow(row);
  assert.equal(input.quoteNumber, 'MJIC-2026-0001');
  assert.equal(input.clientName, 'Test Client');
  assert.equal(input.validDays, 30);
  assert.equal(input.depositPct, 50);
  assert.equal(input.items.length, 3);
});

test('quote input omits the program and discount lines when they are zero', () => {
  const input = quoteInputFromRow({ ...row, breakdown: { quantity: 20, unitPrice: 300, programFee: 0, discount: 0, total: 6000 } });
  assert.equal(input.items.length, 1);
});
