import { getSupabaseAdmin } from './integrations';
import { digitizeQuote } from './pricing-logic';

export const MACHINE_RATE_KEY = 'embroidery_machine_hour';

type QuoteInput = Parameters<typeof digitizeQuote>[0];
export type DigitizeQuoteResult = ReturnType<typeof digitizeQuote>;

// Reads the machine-hour rate (admin price book, 0 until set) and any linked order's quantity, price, and garment cost.
export async function loadQuoteContext(orderId?: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { machineRatePerHour: 0, quantity: 0, currentUnitPrice: 0, garmentCostPerPiece: 0 };

  const { data: rate } = await supabase.from('material_prices').select('unit_cost').eq('key', MACHINE_RATE_KEY).maybeSingle();
  const machineRatePerHour = Number(rate?.unit_cost) || 0;
  if (!orderId) return { machineRatePerHour, quantity: 0, currentUnitPrice: 0, garmentCostPerPiece: 0 };

  const { data: order } = await supabase.from('orders').select('quantity, total_amount, costing_id').eq('id', orderId).maybeSingle();
  const quantity = Number(order?.quantity) || 0;
  const currentUnitPrice = quantity > 0 ? (Number(order?.total_amount) || 0) / quantity : 0;

  let garmentCostPerPiece = 0;
  if (order?.costing_id) {
    const { data: costing } = await supabase.from('project_costings').select('total_cost, quantity').eq('id', order.costing_id).maybeSingle();
    const costingQty = Number(costing?.quantity) || quantity;
    if (costingQty > 0) garmentCostPerPiece = (Number(costing?.total_cost) || 0) / costingQty;
  }
  return { machineRatePerHour, quantity, currentUnitPrice, garmentCostPerPiece };
}

// Quote for one digitized design, computed from the stitch count and the linked order (if any).
export async function buildDigitizeQuote(stitchCount: number, orderId?: string, quantityOverride?: number) {
  const context = await loadQuoteContext(orderId);
  const input: QuoteInput = {
    stitchCount,
    machineRatePerHour: context.machineRatePerHour,
    quantity: quantityOverride || context.quantity,
    garmentCostPerPiece: context.garmentCostPerPiece,
    currentUnitPrice: context.currentUnitPrice,
  };
  return digitizeQuote(input);
}

// Persists the quote breakdown on the linked order (no-op without an orderId).
export async function storeDigitizeQuote(orderId: string | undefined, quote: DigitizeQuoteResult) {
  if (!orderId) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('orders').update({ digitize_quote: { ...quote, updatedAt: now }, updated_at: now }).eq('id', orderId);
  if (error) throw new Error(`Failed to store digitize quote: ${error.message}`);
}
