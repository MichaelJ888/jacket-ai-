import { computeBom, loadPrices, type PriceRow } from './bom';
import { getSupabaseAdmin } from './integrations';
import { recommendPrice } from './pricing-logic';

// Prices as they were `days` ago, rebuilt from price history (falls back to the current price).
async function pricesAsOf(current: PriceRow[], days: number): Promise<PriceRow[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return current;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase.from('material_price_history').select('key, old_cost, new_cost, changed_at').gt('changed_at', cutoff).order('changed_at', { ascending: true });
  const earliest = new Map<string, number>();
  for (const row of data || []) if (!earliest.has(row.key) && row.old_cost !== null) earliest.set(row.key, Number(row.old_cost));
  return current.map((row) => (earliest.has(row.key) ? { ...row, unit_cost: earliest.get(row.key)! } : row));
}

// Recommendations only. Nothing here edits the prices the chat bot quotes.
export async function pricingAdvice() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const prices = await loadPrices();
  const past = await pricesAsOf(prices, 30);
  const { data: book } = await supabase.from('price_book').select('*').gt('selling_price', 0);
  const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const since28 = new Date(Date.now() - 28 * 86400000).toISOString();
  const { data: recent } = await supabase.from('project_costings').select('style, created_at').gt('created_at', since28);

  return (book || []).map((row) => {
    const now = computeBom({ style: row.style, quantity: 1, isSample: true }, prices).costing?.totalCost ?? 0;
    const then = computeBom({ style: row.style, quantity: 1, isSample: true }, past).costing?.totalCost ?? 0;
    const costPerPiece = now + Number(row.labor_cost || 0);
    const advice = recommendPrice(costPerPiece, Number(row.target_margin_pct), Number(row.selling_price));
    const last14 = (recent || []).filter((item) => item.style === row.style && item.created_at >= since14).length;
    const prev14 = (recent || []).filter((item) => item.style === row.style && item.created_at < since14).length;
    return {
      style: row.style as string,
      sellingPrice: Number(row.selling_price),
      materialCostNow: now,
      materialCostChange30dPct: then > 0 ? Number((((now - then) / then) * 100).toFixed(1)) : 0,
      costPerPiece,
      ...advice,
      demandSignal: prev14 > 0 && last14 >= prev14 * 1.5 ? 'SURGE (consider a rush/peak surcharge)' : last14 === 0 && prev14 > 0 ? 'SLOWING (consider a promo)' : 'NORMAL',
      materialsWithNoPrice: computeBom({ style: row.style, quantity: 1, isSample: true }, prices).costing?.missingPrices ?? [],
    };
  });
}

type CostedMaterial = { material: string; quantity: number };

// Weekly usage from the last 90 days of costings vs. stock on hand.
export async function demandForecast() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: costings } = await supabase.from('project_costings').select('costing').gt('created_at', since).eq('is_sample', false).neq('status', 'REJECTED');
  const used = new Map<string, number>();
  for (const row of costings || []) {
    for (const item of ((row.costing as { materials?: CostedMaterial[] } | null)?.materials || [])) {
      used.set(item.material, (used.get(item.material) || 0) + Number(item.quantity || 0));
    }
  }
  const { data: stock } = await supabase.from('material_inventory').select('material_name, quantity_available, unit, supplier_name, reorder_level');
  const weeks = 90 / 7;
  const rows = [...used.entries()].map(([material, total]) => {
    const match = (stock || []).find((item) => item.material_name.toLowerCase().includes(material.toLowerCase()) || material.toLowerCase().includes(item.material_name.toLowerCase()));
    const weekly = Number((total / weeks).toFixed(1));
    const onHand = match ? Number(match.quantity_available) : null;
    const weeksOfCover = onHand !== null && weekly > 0 ? Number((onHand / weekly).toFixed(1)) : null;
    return { material, weeklyUsage: weekly, onHand, unit: match?.unit || null, weeksOfCover, supplier: match?.supplier_name || null, reorder: weeksOfCover !== null && weeksOfCover < 3, suggestedOrderQty: weeksOfCover !== null && weeksOfCover < 3 ? Math.ceil(weekly * 4 - (onHand || 0)) : 0 };
  });
  return rows.sort((a, b) => (a.weeksOfCover ?? 999) - (b.weeksOfCover ?? 999));
}
