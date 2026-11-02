import { getSupabaseAdmin } from './integrations';
import { AWAITING_SLIP, formatPaymentStatus, isPaymentStatusQuery, paymentQueryRef, type PaymentOrder, type PaymentSlip } from './payment-status-logic';

// Returns the reply for a payment question, or null when the message is not about payments (caller continues normally).
export async function answerPaymentStatus(text: string): Promise<string | null> {
  if (!isPaymentStatusQuery(text)) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return `Hindi ma-check ang payment records ngayon. ${AWAITING_SLIP}`;

  const ref = paymentQueryRef(text);
  if (!ref) return 'Sabihin ang client o ORD-number, hal. "DP status Panasonic".';
  const safe = ref.replace(/[%_,()*"'\\]/g, '').trim();
  if (!safe) return 'Sabihin ang client o ORD-number, hal. "DP status Panasonic".';

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, client_name, deposit_amount, deposit_verification_id')
    .or(`order_number.ilike.%${safe}%,client_name.ilike.%${safe}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return `Hindi ma-check ang payment records ngayon. ${AWAITING_SLIP}`;
  if (!orders?.length) return `Walang order na tumutugma sa "${safe}". ${AWAITING_SLIP}`;

  const verificationIds = orders.map((o) => o.deposit_verification_id).filter((id): id is string => Boolean(id));
  const { data: slips } = verificationIds.length
    ? await supabase
        .from('payment_verifications')
        .select('id, expected_amount, detected_amount, reference, transaction_date, recipient, verified')
        .in('id', verificationIds)
    : { data: [] as Array<{ id: string } & PaymentSlip> };
  const slipById = new Map((slips ?? []).map((s) => [s.id, s]));

  const ledgerRefs = orders.map((o) => `dp:${o.id}`);
  const { data: ledger } = await supabase.from('ledger_entries').select('reference').in('reference', ledgerRefs);
  const ledgerSet = new Set((ledger ?? []).map((row) => row.reference));

  const blocks = orders.map((order) => {
    const slip = order.deposit_verification_id ? slipById.get(order.deposit_verification_id) ?? null : null;
    return formatPaymentStatus(order as PaymentOrder, slip, ledgerSet.has(`dp:${order.id}`));
  });
  const header = orders.length > 1 ? `Maraming match para sa "${safe}" (${orders.length}):\n\n` : '';
  return `${header}${blocks.join('\n\n')}`;
}
