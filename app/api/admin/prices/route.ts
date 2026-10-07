import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { loadPrices, savePrice } from '../../_lib/bom';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ prices: await loadPrices() });
}

// Body: { name, key?, category?, unit?, unitCost, supplierName?, notes? } — creates or updates a price and logs history.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const result = await savePrice({ key: body.key, name: String(body.name || ''), category: body.category, unit: body.unit, unitCost: Number(body.unitCost), supplierName: body.supplierName, notes: body.notes });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, key: result.key });
}

export async function DELETE(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const key = new URL(request.url).searchParams.get('key');
  if (!supabase || !key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  const { error } = await supabase.from('material_prices').delete().eq('key', key);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ success: true });
}
