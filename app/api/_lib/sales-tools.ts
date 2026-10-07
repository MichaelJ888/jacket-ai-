import { tool } from 'ai';
import { z } from 'zod';

export const mjicQuoteTool = tool({
  description: 'Calculates the complete quotation, VAT options, and required 50% down payment for MJIC orders.',
  inputSchema: z.object({
    quantity: z.number().describe('Total number of custom garments ordered'),
    unitPrice: z.number().describe('Base price per item in PHP'),
    embroideryCostPerUnit: z.number().default(0).describe('Additional cost per unit for extra embroidery/logos'),
  }),
  execute: async (input: { quantity: number; unitPrice: number; embroideryCostPerUnit: number }) => {
    const { quantity, unitPrice, embroideryCostPerUnit } = input;
    const pricePerPiece = Number((unitPrice + embroideryCostPerUnit).toFixed(2));
    const grossTotal = Number((pricePerPiece * quantity).toFixed(2));
    const initialDeposit = Number((grossTotal * 0.50).toFixed(2));
    const finalBalance = Number((grossTotal - initialDeposit).toFixed(2));

    return {
      quantity,
      pricePerPiece,
      grossTotal,
      depositRequired: initialDeposit,
      remainingBalance: finalBalance,
      paymentMethod: 'GCash / Bank Transfer',
      policyNote: '50% initial deposit required to queue for production.',
    };
  },
});
