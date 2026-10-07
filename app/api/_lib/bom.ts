import { createPurchaseOrder, getSupabaseAdmin } from './integrations';

export const STYLE_RULES = {
  windbreaker: { shellYards: 2, liningYards: 1.5, zipperPieces: 1, snapSets: 0, ribbingSets: 0 },
  varsity: { shellYards: 2, liningYards: 1.5, zipperPieces: 1, snapSets: 0, ribbingSets: 0 },
  corporate: { shellYards: 2, liningYards: 1.5, zipperPieces: 1, snapSets: 0, ribbingSets: 0 },
  bomber: { shellYards: 1.6, liningYards: 1.25, zipperPieces: 0, snapSets: 8, ribbingSets: 1 },
} as const;

export type Style = keyof typeof STYLE_RULES;

// Keys the BOM engine reads; the admin panel edits their unit costs.
export const CORE_MATERIALS = [
  { key: 'shell_fabric', name: 'Shell fabric', category: 'fabric', unit: 'yards' },
  { key: 'lining', name: 'Lining', category: 'fabric', unit: 'yards' },
  { key: 'zipper', name: 'Center zipper', category: 'accessory', unit: 'pieces' },
  { key: 'continuous_zipper', name: 'Continuous zipper', category: 'accessory', unit: 'yards' },
  { key: 'snap_set', name: 'Snap buttons', category: 'accessory', unit: 'sets' },
  { key: 'ribbing_set', name: 'Ribbing', category: 'trim', unit: 'sets' },
  { key: 'thread', name: 'Sewing thread', category: 'trim', unit: 'cones' },
  { key: 'embroidery_thread', name: 'Embroidery thread', category: 'trim', unit: 'cones' },
  { key: 'woven_label', name: 'Woven label', category: 'trim', unit: 'pieces' },
];

export type PriceRow = { key: string; name: string; category: string; unit: string; unit_cost: number; supplier_name: string | null; notes: string | null; updated_at: string };

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadPrices(): Promise<PriceRow[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data: existing } = await supabase.from('material_prices').select('*').order('category').order('name');
  const have = new Set((existing || []).map((row) => row.key));
  const missing = CORE_MATERIALS.filter((item) => !have.has(item.key));
  if (missing.length) {
    await supabase.from('material_prices').upsert(missing.map((item) => ({ ...item, unit_cost: 0 })), { onConflict: 'key', ignoreDuplicates: true });
    const { data } = await supabase.from('material_prices').select('*').order('category').order('name');
    return (data || []) as PriceRow[];
  }
  return (existing || []) as PriceRow[];
}

export async function savePrice(input: { key?: string; name: string; category?: string; unit?: string; unitCost: number; supplierName?: string | null; notes?: string | null }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured' };
  const name = input.name.trim().slice(0, 120);
  if (!name || !Number.isFinite(input.unitCost) || input.unitCost < 0) return { error: 'name and a non-negative unitCost are required' };
  const key = (input.key || name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
  const { data: old } = await supabase.from('material_prices').select('unit_cost').eq('key', key).maybeSingle();
  const { error } = await supabase.from('material_prices').upsert({
    key, name, category: input.category || 'fabric', unit: input.unit || 'yards', unit_cost: input.unitCost,
    supplier_name: input.supplierName || null, notes: input.notes || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) return { error: error.message };
  if (!old || Number(old.unit_cost) !== input.unitCost) {
    await supabase.from('material_price_history').insert({ key, old_cost: old ? Number(old.unit_cost) : null, new_cost: input.unitCost });
  }
  return { error: null, key };
}

export type BomInput = Record<string, unknown>;

// Prices come from the admin price table; any *UnitCost field in the request overrides it.
export function computeBom(body: BomInput, prices: PriceRow[]) {
  const style = String(body.style || 'corporate').toLowerCase() as Style;
  const rule = STYLE_RULES[style];
  const quantity = num(body.quantity);
  if (!rule || quantity <= 0) return { error: 'Valid style and quantity are required.' as const };

  const tones = Math.min(5, Math.max(1, Math.floor(num(body.tones, 1))));
  const isSample = Boolean(body.isSample);
  const priceOf = (key: string, override: unknown) => (override !== undefined && override !== null && override !== '' ? num(override) : num(prices.find((row) => row.key === key)?.unit_cost));
  const supplierOf = (key: string) => prices.find((row) => row.key === key)?.supplier_name || null;

  const shellAllowance = isSample ? 0 : num(body.shellAllowanceYards, 5);
  const liningAllowance = isSample ? 0 : num(body.liningAllowanceYards, 0);
  const zipperAllowance = isSample ? 0 : Math.max(0, Math.floor(num(body.zipperAllowancePieces, 4)));
  const shellYards = quantity * rule.shellYards + shellAllowance;
  const liningYards = quantity * rule.liningYards + liningAllowance;
  const zipperType = String(body.zipperType || 'Center zipper');
  const centerZippers = quantity * rule.zipperPieces + zipperAllowance;
  const continuousZipperYards = (body.hoodOrPocketZippers ? quantity * num(body.continuousZipperYardsPerPiece, 0.25) : 0) + (isSample ? 0 : num(body.continuousZipperAllowanceYards, 0));
  const snapSets = quantity * rule.snapSets;
  const ribbingSets = quantity * rule.ribbingSets;
  const toneYards = Array.from({ length: tones }, (_, index) => ({ tone: index + 1, yards: Number((shellYards * (index === 0 ? 0.5 : 0.5 / (tones - 1 || 1))).toFixed(2)) }));

  const materials = [
    { key: 'shell_fabric', material: 'Shell fabric', quantity: shellYards, unit: 'yards', unitCost: priceOf('shell_fabric', body.shellFabricUnitCost) },
    { key: 'lining', material: 'Lining', quantity: liningYards, unit: 'yards', unitCost: priceOf('lining', body.liningUnitCost) },
    { key: 'zipper', material: zipperType, quantity: centerZippers, unit: 'pieces', unitCost: priceOf('zipper', body.zipperUnitCost) },
    { key: 'continuous_zipper', material: 'Continuous zipper', quantity: continuousZipperYards, unit: 'yards', unitCost: priceOf('continuous_zipper', body.continuousZipperUnitCost) },
    { key: 'snap_set', material: 'Snap buttons', quantity: snapSets, unit: 'sets', unitCost: priceOf('snap_set', body.snapSetUnitCost) },
    { key: 'ribbing_set', material: 'Ribbing', quantity: ribbingSets, unit: 'sets', unitCost: priceOf('ribbing_set', body.ribbingSetUnitCost) },
  ].filter((item) => item.quantity > 0).map((item) => ({
    ...item,
    quantity: Number(item.quantity.toFixed(2)),
    supplier: supplierOf(item.key),
    totalCost: Number((item.quantity * item.unitCost).toFixed(2)),
  }));
  const totalCost = Number(materials.reduce((sum, item) => sum + item.totalCost, 0).toFixed(2));
  const missingPrices = materials.filter((item) => item.unitCost <= 0).map((item) => item.material);

  return {
    error: null,
    costing: {
      style, quantity, tones, isSample,
      assumptions: { shellYardsPerPiece: rule.shellYards, liningYardsPerPiece: rule.liningYards, shellAllowance, liningAllowance, zipperAllowance, toneYards, zipperType },
      materials, totalCost, costPerPiece: Number((totalCost / quantity).toFixed(2)), missingPrices,
    },
  };
}

type CostingMaterial = { key?: string; material: string; quantity: number; unit: string; unitCost: number; supplier?: string | null };

// One draft PO per material line (status PENDING_APPROVAL; the CEO approves before anything is sent to a supplier).
export async function draftPurchaseOrders(materials: CostingMaterial[]) {
  const drafted: Array<{ poNumber: string; material: string; supplier: string; total: number }> = [];
  const skipped: string[] = [];
  for (const item of materials) {
    if (!(item.unitCost > 0) || !(item.quantity > 0)) { skipped.push(`${item.material} (no price set)`); continue; }
    const result = await createPurchaseOrder({ supplierName: item.supplier || 'Unassigned supplier', materialType: item.material, quantity: item.quantity, unitCost: item.unitCost });
    if (result.error || !result.data) { skipped.push(`${item.material} (${result.error || 'failed'})`); continue; }
    await new Promise((resolve) => setTimeout(resolve, 5)); // PO numbers are millisecond-based
    drafted.push({ poNumber: result.data.po_number, material: item.material, supplier: item.supplier || 'Unassigned supplier', total: Number(result.data.total_cost) });
  }
  return { drafted, skipped };
}
