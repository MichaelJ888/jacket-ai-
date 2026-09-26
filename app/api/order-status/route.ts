import { NextResponse } from 'next/server';
import { getSupabaseAdmin, sendTelegramMessage } from '../_lib/integrations';

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
    await sendTelegramMessage(`💳 <b>PAYMENT STATUS UPDATED</b>\nVerification: <code>${verificationId}</code>\nStatus: <b>${status}</b>\nOrder status: <b>${status === 'VERIFIED' ? 'READY_FOR_PURCHASE_ORDER' : 'ON_HOLD'}</b>`);
    return NextResponse.json({ success: true, verification: data, orderStatus: status === 'VERIFIED' ? 'READY_FOR_PURCHASE_ORDER' : 'ON_HOLD' });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Order status update failed' }, { status: 400 }); }
}
