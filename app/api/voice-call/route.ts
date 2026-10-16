import { NextResponse } from 'next/server';
import { escapeTelegramHtml, getSupabaseAdmin, reportCriticalError, sendTelegramMessage } from '../_lib/integrations';
import { formatCallAlert, toCallRecord, verifyRetellSignature } from '../_lib/voice-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Retell webhook: call_inbound (tag the caller), call_ended / call_analyzed (log the call, notify the CEO once).
export async function POST(req: Request) {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Voice AI is not configured' }, { status: 503 });
  const raw = await req.text();
  if (!verifyRetellSignature(raw, apiKey, req.headers.get('x-retell-signature'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let payload: { event?: string; call?: Record<string, unknown>; call_inbound?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }

  try {
    if (payload.event === 'call_inbound') {
      // Pass the business context through; the agent itself is configured in Retell.
      return NextResponse.json({ call_inbound: { dynamic_variables: { business: 'MJIC' } } });
    }
    if (payload.event !== 'call_ended' && payload.event !== 'call_analyzed') return NextResponse.json({ ok: true });

    const record = toCallRecord(payload.call || {});
    const supabase = getSupabaseAdmin();
    if (!record || !supabase) return NextResponse.json({ ok: true });

    const { error } = await supabase.from('voice_calls').upsert(record, { onConflict: 'call_id' });
    if (error) throw new Error(error.message);

    // Claim the notification atomically so retries and the two events never double-alert.
    const analyzed = payload.event === 'call_analyzed' || Boolean(record.summary);
    if (analyzed) {
      const { data: claimed } = await supabase.from('voice_calls').update({ notified_at: new Date().toISOString() }).eq('call_id', record.call_id).is('notified_at', null).select('call_id');
      if (claimed?.length) await sendTelegramMessage(escapeTelegramHtml(formatCallAlert(record)).slice(0, 3800));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    await reportCriticalError('voice-call-webhook', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
