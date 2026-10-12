import { draftPurchaseOrders } from './bom';
import { completeSubconJobsForOrder } from './payroll';
import { canTransition, defaultDepositAmount } from './order-stages';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from './integrations';

type OrderRow = {
  id: string;
  order_number: string;
  costing_id: string | null;
  contact_id: string | null;
  client_name: string | null;
  project_name: string | null;
  contact_phone: string | null;
  delivery_address: string | null;
  total_amount: number;
  stage: string;
  po_drafted_at: string | null;
  dispatch_id: string | null;
};

type CostingMaterials = Array<{ material: string; quantity: number; unit: string; unitCost: number; supplier?: string | null }>;

const label = (order: OrderRow) => escapeTelegramHtml(`${order.order_number} Â· ${order.client_name || order.project_name || 'order'}`);

export async function createOrder(input: {
  costingId?: string | null;
  contactId?: string | null;
  clientName?: string | null;
  projectName?: string | null;
  contactPhone?: string | null;
  deliveryAddress?: string | null;
  quantity?: number | null;
  totalAmount?: number;
  depositAmount?: number;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { order: null, error: 'Supabase is not configured' };
  let { clientName, projectName, quantity } = input;
  if (input.costingId) {
    const { data: costing } = await supabase.from('project_costings').select('client_name, project_name, quantity').eq('id', input.costingId).maybeSingle();
    if (!costing) return { order: null, error: 'Costing not found' };
    clientName = clientName || costing.client_name;
    projectName = projectName || costing.project_name;
    quantity = quantity ?? Number(costing.quantity);
  }
  const total = Number(input.totalAmount) > 0 ? Number(input.totalAmount) : 0;
  const deposit = Number(input.depositAmount) > 0 ? Number(input.depositAmount) : defaultDepositAmount(total);
  const { data, error } = await supabase.from('orders').insert({
    order_number: `ORD-${Date.now().toString().slice(-8)}`,
    costing_id: input.costingId || null,
    contact_id: input.contactId || null,
    client_name: clientName || null,
    project_name: projectName || null,
    contact_phone: input.contactPhone || null,
    delivery_address: input.deliveryAddress || null,
    quantity: quantity ?? null,
    total_amount: total,
    deposit_amount: deposit,
  }).select().single();
  if (error || !data) return { order: null, error: error?.message || 'Order insert failed' };
  await supabase.from('order_events').insert({ order_id: data.id, to_stage: 'AWAITING_DEPOSIT', note: 'Order created' });
  void sendTelegramMessage(`ðŸ§¾ <b>ORDER CREATED</b>\n${label(data as OrderRow)}\nDeposit expected: <b>â‚±${deposit.toLocaleString('en-PH')}</b>`);
  return { order: data as OrderRow, error: null };
}

async function setStage(order: OrderRow, to: string, note: string, extra: Record<string, unknown> = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;
  // Compare-and-set on the current stage so concurrent callers can't double-apply a transition.
  const { data } = await supabase.from('orders').update({ stage: to, updated_at: new Date().toISOString(), ...extra }).eq('id', order.id).eq('stage', order.stage).select('id');
  if (!data?.length) return false;
  await supabase.from('order_events').insert({ order_id: order.id, from_stage: order.stage, to_stage: to, note });
  order.stage = to;
  return true;
}

async function loadOrder(orderId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  return (data as OrderRow | null) || null;
}

// Staff-verified deposit: lock the order, then auto-draft supplier POs from its costing (once).
export async function confirmDeposit(orderId: string, verificationId: string | null) {
  const supabase = getSupabaseAdmin();
  const order = await loadOrder(orderId);
  if (!supabase || !order) return { ok: false, error: 'Order not found' };
  if (order.stage === 'AWAITING_DEPOSIT' || order.stage === 'ON_HOLD') {
    await setStage(order, 'DEPOSIT_VERIFIED', 'Deposit verified by staff', verificationId ? { deposit_verification_id: verificationId } : {});
  }

  let drafted: string[] = [];
  let skipped: string[] = [];
  if (order.costing_id && !order.po_drafted_at) {
    const { data: claimed } = await supabase.from('orders').update({ po_drafted_at: new Date().toISOString() }).eq('id', order.id).is('po_drafted_at', null).select('id');
    if (claimed?.length) {
      const { data: costing } = await supabase.from('project_costings').select('costing').eq('id', order.costing_id).maybeSingle();
      const materials = (costing?.costing as { materials?: CostingMaterials } | null)?.materials || [];
      const result = await draftPurchaseOrders(materials);
      drafted = result.drafted.map((po) => po.poNumber);
      skipped = result.skipped;
      if (drafted.length) await supabase.from('purchase_orders').update({ order_id: order.id }).in('po_number', drafted);
      if (order.stage === 'DEPOSIT_VERIFIED') await setStage(order, 'PO_DRAFTED', `${drafted.length} supplier PO(s) drafted`);
      void sendTelegramMessage(`ðŸ“¦ <b>POs DRAFTED</b> for ${label(order)}: ${drafted.length}${skipped.length ? `\nâš ï¸ Skipped: ${escapeTelegramHtml(skipped.join(', '))}` : ''}\nApprove them before sending to suppliers.`);
    }
  }
  return { ok: true, stage: order.stage, drafted, skipped, error: null };
}

export async function holdOrder(orderId: string, note: string) {
  const order = await loadOrder(orderId);
  if (!order || !canTransition(order.stage, 'ON_HOLD')) return false;
  return setStage(order, 'ON_HOLD', note);
}

export async function advanceOrder(orderId: string, to: string, note = '') {
  const supabase = getSupabaseAdmin();
  const order = await loadOrder(orderId);
  if (!supabase || !order) return { ok: false, error: 'Order not found' };
  if (!canTransition(order.stage, to)) return { ok: false, error: `Cannot move ${order.stage} â†’ ${to}` };
  if (['CUTTING', 'EMBROIDERY', 'SEWING', 'QC', 'PACKING', 'READY_FOR_DELIVERY', 'DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(to) && order.stage === 'AWAITING_DEPOSIT') {
    return { ok: false, error: 'Deposit not verified yet â€” production cannot start' };
  }

  const from = order.stage;
  const extra: Record<string, unknown> = {};
  if (to === 'DELIVERED') extra.delivered_at = new Date().toISOString();
  if (!(await setStage(order, to, note || `Moved from ${from}`, extra))) return { ok: false, error: 'Order changed concurrently, retry' };
  const notices: string[] = [];

  if (to === 'READY_FOR_DELIVERY') {
    const pickup = process.env.MJIC_PICKUP_ADDRESS;
    if (order.delivery_address && order.contact_phone && pickup && !order.dispatch_id) {
      const { data: dispatch } = await supabase.from('dispatch_requests').insert({
        project_name: order.project_name || order.order_number,
        pickup_address: pickup,
        delivery_address: order.delivery_address,
        contact_name: order.client_name || 'Customer',
        contact_phone: order.contact_phone,
        package_description: `Order ${order.order_number}`,
        status: 'PENDING_APPROVAL',
        order_id: order.id,
      }).select('id').single();
      if (dispatch) {
        await supabase.from('orders').update({ dispatch_id: dispatch.id }).eq('id', order.id);
        notices.push(`Dispatch drafted (<code>${dispatch.id}</code>) â€” approve to book Lalamove.`);
      }
    } else if (!order.dispatch_id) {
      notices.push('No dispatch drafted (missing delivery address, phone, or MJIC_PICKUP_ADDRESS) â€” arrange delivery manually.');
    }
  }

  if (to === 'DELIVERED' && order.contact_id) {
    // The sales-followups cron sends the review/reorder message 24h after contact.delivered_at.
    const { data: contact } = await supabase.from('crm_contacts').select('lifetime_value').eq('id', order.contact_id).maybeSingle();
    await supabase.from('crm_contacts').update({ delivered_at: extra.delivered_at, stage: 'won', next_followup_at: null, lifetime_value: Number(contact?.lifetime_value || 0) + Number(order.total_amount || 0) }).eq('id', order.contact_id);
    notices.push('Post-sale review request scheduled in 24h.');
  }

  if (to === 'DELIVERED') {
    const subconPayrolls = await completeSubconJobsForOrder(orderId).catch(() => 0);
    if (subconPayrolls) notices.push(`${subconPayrolls} subcon payroll(s) generated.`);
  }

  void sendTelegramMessage(`ðŸ­ <b>ORDER ${escapeTelegramHtml(to.replaceAll('_', ' '))}</b>\n${label(order)}${notices.length ? `\n${notices.join('\n')}` : ''}`);
  return { ok: true, from, stage: to, error: null };
}
