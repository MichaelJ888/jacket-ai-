import { tool } from 'ai';
import { z } from 'zod';
import { quoteBulkOrder } from './pricing-logic';

export const mjicQuoteTool = tool({
  description: 'Calculates the complete quotation, VAT options, and required 50% down payment for MJIC orders. Pass the market unit price (the 20-pc MOQ rate); the volume discount is applied by the server, so do not discount it yourself.',
  inputSchema: z.object({
    quantity: z.number().describe('Total number of custom garments ordered'),
    marketUnitPrice: z.number().describe('Market unit price per item in PHP at the 20-pc MOQ rate, before volume discount'),
    embroideryCostPerUnit: z.number().default(0).describe('Additional cost per unit for extra embroidery/logos'),
  }),
  execute: async (input: { quantity: number; marketUnitPrice: number; embroideryCostPerUnit: number }) => {
    const { quantity, marketUnitPrice, embroideryCostPerUnit } = input;
    const bulk = quoteBulkOrder(marketUnitPrice, quantity);
    const unitPrice = bulk.unitPrice;
    const pricePerPiece = Number((unitPrice + embroideryCostPerUnit).toFixed(2));
    const grossTotal = Number((pricePerPiece * quantity).toFixed(2));
    const initialDeposit = Number((grossTotal * 0.50).toFixed(2));
    const finalBalance = Number((grossTotal - initialDeposit).toFixed(2));

    return {
      quantity,
      marketUnitPrice,
      discountPct: bulk.discountPct,
      moqMet: bulk.moqMet,
      pricePerPiece,
      grossTotal,
      depositRequired: initialDeposit,
      remainingBalance: finalBalance,
      paymentMethod: 'GCash / Bank Transfer',
      policyNote: '50% initial deposit required to queue for production.',
    };
  },
});
