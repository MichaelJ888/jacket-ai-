import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const [styles, costings, pos, quotes, receipts] = await Promise.all([
    supabase.from('price_book').select('*').order('style'),
    supabase.from('project_costings').select('id, client_name, project_name, style, quantity, total_cost, status, created_at').order('created_at', { ascending: false }).limit(15),
    supabase.from('purchase_orders').select('po_number, supplier_name, material_type, total_cost, status, created_at').order('created_at', { ascending: false }).limit(15),
    supabase.from('pdf_quotes').select('quote_number, client_name, project_name, total, created_at').order('created_at', { ascending: false }).limit(15),
    supabase.from('payment_verifications').select('reference, detected_amount, verified, fraud_score, fraud_flags, created_at').order('created_at', { ascending: false }).limit(15),
  ]);
  return NextResponse.json({ priceBook: styles.data || [], costings: costings.data || [], purchaseOrders: pos.data || [], quotes: quotes.data || [], receipts: receipts.data || [] });
}
