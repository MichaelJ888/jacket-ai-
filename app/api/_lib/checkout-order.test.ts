import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderReference, calculateDeposit, validateCheckoutOrder, type CheckoutOrder } from './checkout-order.ts';

describe('checkout-order', () => {
  describe('generateOrderReference', () => {
    it('generates reference code in MJIC-YYYY-NNNN format', () => {
      const now = new Date('2026-11-15T12:00:00Z');
      const reference = generateOrderReference(now, 1);
      assert.match(reference, /^MJIC-2026-\d{4}$/);
      assert.equal(reference, 'MJIC-2026-0001');
    });

    it('pads sequence numbers to 4 digits', () => {
      const now = new Date('2026-11-15T12:00:00Z');
      assert.equal(generateOrderReference(now, 5), 'MJIC-2026-0005');
      assert.equal(generateOrderReference(now, 123), 'MJIC-2026-0123');
      assert.equal(generateOrderReference(now, 9999), 'MJIC-2026-9999');
    });

    it('caps sequence at 9999', () => {
      const now = new Date('2026-11-15T12:00:00Z');
      assert.equal(generateOrderReference(now, 10000), 'MJIC-2026-9999');
    });
  });

  describe('calculateDeposit', () => {
    it('calculates 50% deposit', () => {
      assert.equal(calculateDeposit(1000), 500);
      assert.equal(calculateDeposit(2500), 1250);
    });

    it('rounds up deposit', () => {
      assert.equal(calculateDeposit(1001), 501);
      assert.equal(calculateDeposit(999), 500);
    });

    it('handles zero total', () => {
      assert.equal(calculateDeposit(0), 0);
    });
  });

  describe('validateCheckoutOrder', () => {
    it('returns empty array for valid order', () => {
      const order: Partial<CheckoutOrder> = {
        customerName: 'John Doe',
        quantity: 10,
        totalPhp: 5000,
        depositPhp: 2500,
      };
      const errors = validateCheckoutOrder(order);
      assert.equal(errors.length, 0);
    });

    it('validates customer name length', () => {
      const order: Partial<CheckoutOrder> = {
        customerName: 'A',
        quantity: 10,
        totalPhp: 5000,
      };
      const errors = validateCheckoutOrder(order);
      assert(errors.some((e) => e.includes('Customer name')));
    });

    it('validates quantity', () => {
      const order: Partial<CheckoutOrder> = {
        customerName: 'John Doe',
        quantity: 0,
        totalPhp: 5000,
      };
      const errors = validateCheckoutOrder(order);
      assert(errors.some((e) => e.includes('Quantity')));
    });

    it('validates total price', () => {
      const order: Partial<CheckoutOrder> = {
        customerName: 'John Doe',
        quantity: 10,
        totalPhp: -100,
      };
      const errors = validateCheckoutOrder(order);
      console.log('Total price validation errors:', errors);
      assert(errors.some((e) => e.includes('Total price')));
    });

    it('validates deposit range', () => {
      const order: Partial<CheckoutOrder> = {
        customerName: 'John Doe',
        quantity: 10,
        totalPhp: 5000,
        depositPhp: 6000,
      };
      const errors = validateCheckoutOrder(order);
      assert(errors.some((e) => e.includes('Deposit')));
    });

    it('validates lalamove estimate', () => {
      const order: Partial<CheckoutOrder> = {
        customerName: 'John Doe',
        quantity: 10,
        totalPhp: 5000,
        lalamoveEstimatePhp: -500,
      };
      const errors = validateCheckoutOrder(order);
      assert(errors.some((e) => e.includes('Lalamove')));
    });
  });
});
