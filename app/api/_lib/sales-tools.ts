import { tool } from 'ai';
import { z } from 'zod';
import { quoteBulkOrder, quoteUniformOrder, type SchoolUniformGarment } from './pricing-logic';

export const mjicQuoteTool = tool({
  description: 'Calculates MJIC quotations and the 50% down payment. For ordinary custom products use category custom and pass the 20-piece-MOQ market unit price. For company_uniform, pass quantity in sets and includeBlazer if applicable. For school_uniform, pass quantity in sets and the selected schoolGarments (one of each selected garment per set). These uniform categories enforce their own MOQ and fixed prices without generic volume discounts.',
  inputSchema: z.object({
    category: z.enum(['custom', 'company_uniform', 'school_uniform']).default('custom'),
    quantity: z.number().int().positive().describe('Number of pieces for custom orders, or number of sets for company/school uniforms'),
    marketUnitPrice: z.number().nonnegative().optional().describe('Required for custom products: market unit price per item in PHP at the 20-pc MOQ rate, before volume discount'),
    embroideryCostPerUnit: z.number().default(0).describe('Additional cost per unit for extra embroidery/logos'),
    includeBlazer: z.boolean().optional().describe('For company uniforms, whether to add one ₱900 blazer per set'),
    schoolGarments: z.array(z.enum(['blouse', 'skirt', 'pants', 'shorts', 'vest', 'jumper'])).optional().describe('For school uniforms, the garments included in each set'),
  }),
  execute: async (input: {
    category: 'custom' | 'company_uniform' | 'school_uniform';
    quantity: number;
    marketUnitPrice?: number;
    embroideryCostPerUnit: number;
    includeBlazer?: boolean;
    schoolGarments?: SchoolUniformGarment[];
  }) => {
    if (input.category !== 'custom') {
      return quoteUniformOrder({
        category: input.category,
        quantity: input.quantity,
        includeBlazer: input.includeBlazer,
        garments: input.schoolGarments,
      });
    }

    if (input.marketUnitPrice === undefined) {
      return { quoteable: false, reason: 'The official market unit price is required for a custom-product quote.' };
    }

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
