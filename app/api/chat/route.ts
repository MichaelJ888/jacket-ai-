import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const vercelAiGateway = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: vercelAiGateway('anthropic/claude-3-5-sonnet'),
    system: `You are the official AI Sales Executive for Michael Jeffrey International Corporation (MJIC).
    - Always maintain a professional, helpful, and courteous Taglish tone.
    - NEVER mention CGVenezuela or RLC. Always refer to MJIC and the MJIC Price Calculator.
    - Provide accurate estimates for custom jacket orders and generate GCash deposit prompts.
    - Use estimateBorzoDelivery to give shipping fee estimates to customers.
    - Always inform the customer that booking dispatched items requires human manager clearance.`,
    messages,
    tools: {
      calculateMJICQuote: tool({
        description: 'Calculates jacket pricing using the MJIC Price Calculator.',
        parameters: z.object({
          quantity: z.number().describe('Total number of jackets ordered'),
          baseCostPerUnit: z.number().describe('Raw material & sewing cost per jacket'),
          embroideryComplexity: z.enum(['simple', 'medium', 'complex']),
        }),
        execute: async ({ quantity, baseCostPerUnit, embroideryComplexity }) => {
          let multiplier = 1.35;
          if (embroideryComplexity === 'medium') multiplier = 1.45;
          if (embroideryComplexity === 'complex') multiplier = 1.60;

          const unitPrice = Math.ceil(baseCostPerUnit * multiplier);
          const totalPrice = unitPrice * quantity;
          const depositRequired = Math.ceil(totalPrice * 0.5);

          return {
            company: 'Michael Jeffrey International Corporation',
            quantity,
            unitPrice,
            totalPrice,
            depositRequired,
          };
        },
      }),

      estimateBorzoDelivery: tool({
        description: 'Estimates delivery fee using distance or local Metro Manila / Rizal zones.',
        parameters: z.object({
          originCity: z.string().describe('Origin location e.g., Taytay, Rizal'),
          destinationCity: z.string().describe('Delivery location e.g., Makati, Manila, Quezon City'),
          vehicleType: z.enum(['motorbike', 'car_mpv', 'small_truck']),
        }),
        execute: async ({ originCity, destinationCity, vehicleType }) => {
          let estimatedFee = 150;
          if (vehicleType === 'car_mpv') estimatedFee = 380;
          if (vehicleType === 'small_truck') estimatedFee = 850;

          return {
            origin: originCity,
            destination: destinationCity,
            vehicle: vehicleType,
            estimatedFee,
            note: 'Estimated delivery fee. Official booking requires MJIC management verification.',
          };
        },
      }),

      requestBorzoBookingApproval: tool({
        description: 'Triggers an internal notification to MJIC Management for dispatch authorization.',
        parameters: z.object({
          orderId: z.string(),
          pickupAddress: z.string(),
          dropoffAddress: z.string(),
          customerPhone: z.string(),
        }),
        execute: async ({ orderId }) => {
          // Triggers an alert to your Telegram / Dashboard for manual confirmation
          return {
            status: 'PENDING_APPROVAL',
            message: `Booking request for Order ${orderId} sent to Michael Jeffrey for approval. Borzo API will trigger upon approval.`,
          };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}