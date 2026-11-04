import { getSupabaseAdmin } from './integrations.ts';
import { normalizeCategoryInput, seedPricelist, type Pricelist, type PricelistCategory } from './pricelist-logic.ts';

// Database overrides win over seed defaults. Seed categories with no row keep their official tiers.
// Any read failure (missing table, network) falls back to the seed so public quoting never breaks.
export async function loadPricelist(): Promise<Pricelist> {
  const seed = seedPricelist();
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return seed;
    const { data, error } = await supabase
      .from('quote_pricelist')
      .select('category_key, label, active, tiers')
      .order('category_key');
    if (error || !data) return seed;

    const byKey = new Map(seed.categories.map((c) => [c.key, c]));
    for (const row of data) {
      try {
        const cat = normalizeCategoryInput({
          key: row.category_key,
          label: row.label,
          active: row.active,
          tiers: row.tiers,
        });
        byKey.set(cat.key, cat);
      } catch {
        // A malformed stored row is ignored; the seed category stays in effect.
      }
    }
    return { categories: [...byKey.values()] };
  } catch {
    return seed;
  }
}

export async function savePricelistCategory(input: unknown, updatedBy: string): Promise<PricelistCategory> {
  const cat = normalizeCategoryInput(input);
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase
    .from('quote_pricelist')
    .upsert(
      {
        category_key: cat.key,
        label: cat.label,
        active: cat.active,
        tiers: cat.tiers,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      { onConflict: 'category_key' },
    );
  if (error) throw new Error(`Could not save the pricelist: ${error.message}`);
  return cat;
}
