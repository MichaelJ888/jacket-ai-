import { NextResponse } from 'next/server';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../_lib/integrations';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || '');
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

    if (action === 'check_stock') {
      const materials = Array.isArray(body.materials) ? body.materials : [];
      if (!materials.length) return NextResponse.json({ error: 'materials array is required' }, { status: 400 });
      const names = materials.map((item) => String(item.material || '').trim()).filter(Boolean);
      const { data: stock, error } = await supabase.from('material_inventory').select('*').in('material_name', names);
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      const byName = new Map((stock || []).map((item) => [item.material_name, item]));
      const result = materials.map((item) => { const row = byName.get(String(item.material)); const required = Number(item.quantity || 0); const available = Number(row?.quantity_available || 0); return { ...item, available, shortage: Math.max(0, required - available), supplier: row?.supplier_name || null, status: available >= required ? 'READY' : 'SHORTAGE' }; });
      const shortages = result.filter((item) => item.status === 'SHORTAGE');
      if (shortages.length) void sendTelegramMessage(`<b>CUTTER MATERIAL SHORTAGE ALERT</b>\n${shortages.map((item) => `${escapeTelegramHtml(item.material)}: need ${item.quantity}, available ${item.available}, shortage ${item.shortage}`).join('\n')}\nStatus: <b>HOLD PROJECT</b>`);
      return NextResponse.json({ success: true, ready: shortages.length === 0, materials: result });
    }

    if (action === 'request_dispatch') {
      const { projectName, pickupAddress, deliveryAddress, contactName, contactPhone, packageDescription } = body;
      if (!pickupAddress || !deliveryAddress || !contactName || !contactPhone) return NextResponse.json({ error: 'pickupAddress, deliveryAddress, contactName, and contactPhone are required' }, { status: 400 });
      const { data, error } = await supabase.from('dispatch_requests').insert({ project_name: projectName || null, pickup_address: pickupAddress, delivery_address: deliveryAddress, contact_name: contactName, contact_phone: contactPhone, package_description: packageDescription || null, status: 'PENDING_APPROVAL' }).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      void sendTelegramMessage(`<b>LALAMOVE DISPATCH REQUEST</b>\nProject: ${escapeTelegramHtml(String(projectName || 'Not provided'))}\nPickup: ${escapeTelegramHtml(pickupAddress)}\nDelivery: ${escapeTelegramHtml(deliveryAddress)}\nStatus: <b>PENDING APPROVAL</b>\nDispatch ID: <code>${data.id}</code>`);
      return NextResponse.json({ success: true, dispatch: data, requiresApproval: true });
    }

    if (action === 'approve_dispatch') {
      const dispatchId = String(body.dispatchId || '');
      if (!dispatchId) return NextResponse.json({ error: 'dispatchId is required' }, { status: 400 });
      const { data: dispatch, error: fetchError } = await supabase.from('dispatch_requests').select('*').eq('id', dispatchId).single();
      if (fetchError || !dispatch) return NextResponse.json({ error: fetchError?.message || 'Dispatch not found' }, { status: 404 });
      if (dispatch.status !== 'PENDING_APPROVAL') return NextResponse.json({ error: `Dispatch is already ${dispatch.status}` }, { status: 409 });
      const apiUrl = process.env.LALAMOVE_API_URL;
      const apiToken = process.env.LALAMOVE_API_TOKEN;
      let providerResponse: unknown = null;
      let status = 'APPROVED_PENDING_BOOKING';
      if (apiUrl && apiToken) {
        const response = await fetch(apiUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ pickup_address: dispatch.pickup_address, delivery_address: dispatch.delivery_address, contact_name: dispatch.contact_name, contact_phone: dispatch.contact_phone, package_description: dispatch.package_description }) });
        providerResponse = await response.json().catch(() => null);
        if (!response.ok) return NextResponse.json({ error: 'Lalamove API rejected the dispatch', providerResponse }, { status: 502 });
        status = 'BOOKED';
      }
      const { data: updated, error } = await supabase.from('dispatch_requests').update({ status, provider_response: providerResponse, approved_at: new Date().toISOString() }).eq('id', dispatchId).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      void sendTelegramMessage(`<b>DISPATCH ${status}</b>\nDispatch ID: <code>${dispatchId}</code>\n${apiUrl ? 'Lalamove booking submitted.' : 'Lalamove credentials not configured; ready for manual booking.'}`);
      return NextResponse.json({ success: true, dispatch: updated, liveApiUsed: Boolean(apiUrl && apiToken) });
    }

    return NextResponse.json({ error: 'Invalid logistics action' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Logistics request failed' }, { status: 400 }); }
}
