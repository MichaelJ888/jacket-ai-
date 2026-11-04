import type { QuoteInput, QuoteItem } from './quote-pdf.ts';

export type QuoteRow = {
  quote_number: string;
  customer_name: string;
  customer_contact: string | null;
  product_name: string | null;
  breakdown: Record<string, unknown>;
  created_at: string;
};

const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Rebuilds the quotation PDF input from the stored formal-quote breakdown, so the PDF always matches the saved totals.
export function quoteInputFromRow(row: QuoteRow): QuoteInput {
  const b = row.breakdown;
  const quantity = num(b.quantity, 1);
  const items: QuoteItem[] = [
    { description: `${row.product_name || 'Custom uniform'} (incl. add-ons)`, quantity, unitPrice: num(b.unitPrice) },
  ];
  const programFee = num(b.programFee);
  if (programFee > 0) items.push({ description: 'Logo program fee', quantity: 1, unitPrice: programFee });
  const discount = num(b.discount);
  if (discount > 0) items.push({ description: 'Discount', quantity: 1, unitPrice: -discount });
  return {
    quoteNumber: row.quote_number,
    clientName: row.customer_name,
    contact: row.customer_contact || undefined,
    projectName: row.product_name || undefined,
    items,
    validDays: num(b.validDays, 30),
    depositPct: num(b.depositPct, 50),
    issuedAt: new Date(row.created_at),
  };
}
