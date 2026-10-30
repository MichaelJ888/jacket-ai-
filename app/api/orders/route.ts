import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { getSupabaseAdmin, reportCriticalError } from '../_lib/integrations';
import { advanceOrder, confirmDeposit, createOrder } from '../_lib/order-lifecycle';

export const dynamic = 'force-dynamic';

// GET ?id=<uuid> -> one order with its POs and event timeline; otherwise the 50 latest orders.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const [order, events, purchaseOrders] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('order_events').select('*').eq('order_id', id).order('created_at'),
      supabase.from('purchase_orders').select('po_number, supplier_name, material_type, total_cost, status').eq('order_id', id),
    ]);
    if (!order.data) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    return NextResponse.json({ order: order.data, events: events.data || [], purchaseOrders: purchaseOrders.data || [] });
  }
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ orders: data || [] });
}

// POST { action: 'create', costingId?, contactId?, clientName?, projectName?, contactPhone?, deliveryAddress?, quantity?, totalAmount, depositAmount?, spec? | flat spec fields }
// POST { action: 'confirm_deposit', orderId, verificationId? }   (manual override of the payment webhook)
// POST { action: 'advance', orderId, stage, note? }
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action === 'create') {
      // Spec fields may arrive nested under `spec` or flat on the body (organizationName, targetDeadline, ...).
      const result = await createOrder({ ...body, spec: body.spec ?? body });
      if (!result.order) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ success: true, order: result.order });
    }
    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    if (body.action === 'confirm_deposit') {
      const result = await confirmDeposit(orderId, typeof body.verificationId === 'string' ? body.verificationId : null);
      return NextResponse.json(result, { status: result.ok ? 200 : 404 });
    }
    if (body.action === 'advance') {
      const result = await advanceOrder(orderId, String(body.stage || ''), typeof body.note === 'string' ? body.note.slice(0, 300) : '');
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    await reportCriticalError('orders', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Order request failed' }, { status: 400 });
  }
}
