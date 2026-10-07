import { NextResponse } from 'next/server';
import { deductInventoryForOrder, escapeTelegramHtml, getSupabaseAdmin, reportCriticalError, sendTelegramMessage } from '../_lib/integrations';

export async function POST(req: Request) {
  try {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (secret && req.headers.get('x-payment-webhook-secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const verificationId = typeof body.verificationId === 'string' ? body.verificationId : '';
    const status = body.status === 'VERIFIED' ? 'VERIFIED' : 'REJECTED';
    if (!verificationId) return NextResponse.json({ error: 'verificationId is required' }, { status: 400 });
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
    const { data, error } = await supabase.from('payment_verifications').update({ verified: status === 'VERIFIED', notes: body.notes || null }).eq('id', verificationId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    const orderStatus = status === 'VERIFIED' ? 'READY_FOR_PURCHASE_ORDER' : 'ON_HOLD';
    const messageLines = ['💳 <b>PAYMENT STATUS UPDATED</b>', `Verification: <code>${verificationId}</code>`, `Status: <b>${status}</b>`, `Order status: <b>${orderStatus}</b>`];
    let inventory: Array<{ material: string; deducted: number; remaining: number; shortage: boolean }> | null = null;
    if (status === 'VERIFIED' && Array.isArray(body.materials) && body.materials.length) {
      const deduction = await deductInventoryForOrder(body.materials, `verification:${verificationId}`);
      if (deduction.error) {
        await reportCriticalError('order-status:inventory-deduction', new Error(deduction.error), { verificationId });
        messageLines.push('Inventory deduction: <b>FAILED — check system logs</b>');
      } else {
        inventory = deduction.data;
        for (const item of deduction.data || []) {
          messageLines.push(`Stock: ${escapeTelegramHtml(item.material)} −${item.deducted} → ${item.remaining} left${item.shortage ? ' ⚠️ SHORTAGE' : ''}`);
        }
      }
    }
    await sendTelegramMessage(messageLines.join('\n'));
    return NextResponse.json({ success: true, verification: data, orderStatus, inventory });
  } catch (error) {
    await reportCriticalError('order-status', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Order status update failed' }, { status: 400 });
  }
}
