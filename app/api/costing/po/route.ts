import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { draftPurchaseOrders } from '../../_lib/bom';
import { getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Draft supplier POs from a saved costing. Body: { costingId }. POs stay PENDING_APPROVAL.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { costingId } = (await request.json().catch(() => ({}))) as { costingId?: string };
  if (!costingId) return NextResponse.json({ error: 'costingId is required' }, { status: 400 });
  const { data } = await supabase.from('project_costings').select('costing, client_name, project_name').eq('id', costingId).maybeSingle();
  const materials = (data?.costing as { materials?: Array<{ material: string; quantity: number; unit: string; unitCost: number; supplier?: string | null }> } | null)?.materials;
  if (!materials) return NextResponse.json({ error: 'Costing not found' }, { status: 404 });
  const result = await draftPurchaseOrders(materials);
  if (result.drafted.length) void sendTelegramMessage(`<b>SUPPLIER POs DRAFTED</b> (${result.drafted.length}) for ${data?.client_name || data?.project_name || 'an order'}. Review and approve before sending.`);
  return NextResponse.json({ success: true, ...result });
}
