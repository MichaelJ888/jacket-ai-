import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { MOQ_PIECES, quoteBulkOrder, volumeLadder } from '../../_lib/pricing-logic';

export const dynamic = 'force-dynamic';

// Body: { style, sellingPrice (market rate per pc at MOQ), laborCost? }
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const body = await request.json().catch(() => ({}));
  const style = String(body.style || '').toLowerCase().trim();
  const sellingPrice = Number(body.sellingPrice);
  if (!supabase || !style || !Number.isFinite(sellingPrice) || sellingPrice < 0) return NextResponse.json({ error: 'style and sellingPrice required' }, { status: 400 });
  const laborCost = Number(body.laborCost) || 0;
  const { error } = await supabase.from('price_book').upsert({ style, selling_price: sellingPrice, labor_cost: laborCost, updated_at: new Date().toISOString() }, { onConflict: 'style' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, moq: MOQ_PIECES, minimumOrderQuote: quoteBulkOrder(sellingPrice, MOQ_PIECES, laborCost), volumeLadder: volumeLadder(sellingPrice, laborCost) });
}

