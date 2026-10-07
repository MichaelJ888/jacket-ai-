import { NextResponse } from 'next/server';
import { computeBom, draftPurchaseOrders, loadPrices } from '../_lib/bom';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../_lib/integrations';

export const dynamic = 'force-dynamic';

// Per-order BOM + costing. Prices come from the admin price table (request *UnitCost fields override).
// Set draftPurchaseOrders: true to auto-draft supplier POs (PENDING_APPROVAL) from the BOM.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prices = await loadPrices();
    const result = computeBom(body, prices);
    if (result.error || !result.costing) return NextResponse.json({ error: result.error }, { status: 400 });
    const costing = result.costing;

    let costingId: string | null = null;
    if (body.save !== false) {
      const supabase = getSupabaseAdmin();
      if (supabase) {
        const { data, error } = await supabase.from('project_costings').insert({ project_name: body.projectName || null, client_name: body.clientName || null, company_name: body.companyName || null, contact: body.contact || null, style: costing.style, quantity: costing.quantity, is_sample: costing.isSample, costing, total_cost: costing.totalCost, status: 'PENDING_APPROVAL' }).select('id').single();
        if (error) console.error('Project costing save failed:', error.message);
        costingId = data?.id || null;
      }
    }

    const purchaseOrders = body.draftPurchaseOrders ? await draftPurchaseOrders(costing.materials) : null;
    const lines = costing.materials.map((item) => `• ${escapeTelegramHtml(item.material)}: ${item.quantity} ${item.unit}`).join('\n');
    void sendTelegramMessage(`<b>PROJECT COSTING + BOM READY</b>\nClient: ${escapeTelegramHtml(String(body.clientName || 'Not provided'))}\nProject: ${escapeTelegramHtml(String(body.projectName || costing.style))}\nQuantity: ${costing.quantity}\n${lines}\nMaterial estimate: <b>₱${costing.totalCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</b>${costing.missingPrices.length ? `\n⚠️ No price set for: ${escapeTelegramHtml(costing.missingPrices.join(', '))}` : ''}${purchaseOrders ? `\nDraft POs: ${purchaseOrders.drafted.length}` : ''}\nStatus: <b>PENDING APPROVAL</b>`);
    return NextResponse.json({ success: true, costingId, costing, purchaseOrders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Costing failed' }, { status: 400 });
  }
}
