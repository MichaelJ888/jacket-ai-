// Quotation order tracking: reference generation, Supabase logging, and checkout workflow.

export interface CheckoutOrder {
  id: string;
  reference: string; // Human-readable reference code (MJIC-YYYY-NNNN format)
  clientToken: string;
  quoteNumber: string | null;
  customerName: string;
  customerContact: string | null;
  quantity: number;
  totalPhp: number;
  depositPhp: number;
  depositPaid: boolean;
  paymentMethod: 'gcash' | 'maya' | 'bpi' | 'bank_transfer' | null;
  lalamoveEstimatePhp: number | null;
  lalamoveVehicle: 'motorcycle' | 'sedan' | 'mpv' | 'l300' | null;
  orderStatus: 'draft' | 'awaiting_deposit' | 'deposit_received' | 'in_production' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

/**
 * Generate a human-readable order reference code (MJIC-YYYY-NNNN).
 * @param now Current date
 * @param sequenceNumber Sequence number (1-9999)
 * @returns Reference code like MJIC-2026-0001
 */
export function generateOrderReference(now: Date, sequenceNumber: number): string {
  const year = now.getUTCFullYear();
  const sequence = String(Math.min(9999, Math.max(1, sequenceNumber))).padStart(4, '0');
  return `MJIC-${year}-${sequence}`;
}

/**
 * Calculate 50% deposit amount.
 * @param totalPhp Total quote amount
 * @returns Deposit amount (50% of total, rounded up)
 */
export function calculateDeposit(totalPhp: number): number {
  return Math.ceil(totalPhp * 0.5);
}

/**
 * Validate checkout order data.
 * @param order Partial order to validate
 * @returns Array of validation errors, empty if valid
 */
export function validateCheckoutOrder(order: Partial<CheckoutOrder>): string[] {
  const errors: string[] = [];

  if (!order.customerName || order.customerName.length < 2) errors.push('Customer name is required (min 2 characters)');
  if (order.quantity === undefined || order.quantity < 1) errors.push('Quantity must be at least 1');
  if (order.totalPhp === undefined || !Number.isFinite(order.totalPhp) || order.totalPhp < 0) {
    errors.push('Total price must be a non-negative number');
  }
  if (order.depositPhp !== undefined && (order.depositPhp < 0 || order.depositPhp > (order.totalPhp || 0))) {
    errors.push('Deposit must be between 0 and total price');
  }
  if (order.lalamoveEstimatePhp !== undefined && order.lalamoveEstimatePhp !== null && order.lalamoveEstimatePhp < 0) {
    errors.push('Lalamove estimate cannot be negative');
  }

  return errors;
}
