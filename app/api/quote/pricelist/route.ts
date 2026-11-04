import { NextResponse } from 'next/server';
import { loadPricelist } from '../../_lib/pricelist.ts';

export const dynamic = 'force-dynamic';

// Public read-only catalog of active categories and their official tiers, used by /quote.
export async function GET() {
  const catalog = await loadPricelist();
  const categories = catalog.categories.filter((c) => c.active).map(({ key, label, tiers }) => ({ key, label, tiers }));
  return NextResponse.json({ ok: true, categories }, { headers: { 'Cache-Control': 'no-store' } });
}
