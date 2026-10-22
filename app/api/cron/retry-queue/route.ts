import { recordHeartbeat } from '../../_lib/ceo-finance';
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import {
  escapeTelegramHtml,
  getSupabaseAdmin,
  reportCriticalError,
  sendTelegramMessage,
} from '../../_lib/integrations';

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

const MAX_BATCH = 10;

// Exponential backoff between attempts: 1, 2, 4, 8... minutes, capped at 60.
function nextAttemptDelayMs(attempts: number) {
  return Math.min(2 ** Math.max(0, attempts - 1), 60) * 60 * 1000;
}

async function markQueueItem(supabase: SupabaseAdmin, id: string, status: 'DONE' | 'FAILED', attempts: number, lastError: string | null) {
  await supabase.from('outbound_request_queue').update({
    status,
    attempts,
    last_error: lastError,
    completed_at: new Date().toISOString(),
  }).eq('id', id);
}

async function bookLalamove(dispatch: {
  pickup_address: string;
  delivery_address: string;
  contact_name: string;
  contact_phone: string;
  package_description: string | null;
}): Promise<{ ok: boolean; error?: string; providerResponse?: unknown }> {
  const apiUrl = process.env.LALAMOVE_API_URL;
  const apiToken = process.env.LALAMOVE_API_TOKEN;
  if (!apiUrl || !apiToken) return { ok: false, error: 'Lalamove credentials not configured' };
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: dispatch.pickup_address,
        delivery_address: dispatch.delivery_address,
        contact_name: dispatch.contact_name,
        contact_phone: dispatch.contact_phone,
        package_description: dispatch.package_description,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const providerResponse = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: `Lalamove API rejected the dispatch (HTTP ${response.status})`, providerResponse };
    return { ok: true, providerResponse };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Lalamove request failed' };
  }
}

// Processes due rows in outbound_request_queue. Scheduled every 45 min by the GitHub Actions
// retry-queue job (Vercel Hobby native crons are daily-only). Auth: cron bearer token (fails closed)
// like the other cron routes.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('outbound_request_queue')
    .select('*')
    .eq('status', 'PENDING')
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(MAX_BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  let succeeded = 0;
  let rescheduled = 0;
  let failed = 0;

  for (const item of due || []) {
    const attempts = Number(item.attempts || 0) + 1;
    const maxAttempts = Number(item.max_attempts || 5);

    if (item.kind !== 'lalamove_booking') {
      await markQueueItem(supabase, item.id, 'FAILED', attempts, `Unknown queue kind: ${item.kind}`);
      failed += 1;
      continue;
    }

    const dispatchId = String((item.payload as { dispatchId?: unknown })?.dispatchId || '');
    const { data: dispatch } = await supabase.from('dispatch_requests').select('*').eq('id', dispatchId).maybeSingle();
    if (!dispatch) {
      await markQueueItem(supabase, item.id, 'FAILED', attempts, 'Dispatch request not found');
      failed += 1;
      continue;
    }
    if (dispatch.status === 'BOOKED') {
      await markQueueItem(supabase, item.id, 'DONE', attempts, null);
      succeeded += 1;
      continue;
    }

    const result = await bookLalamove(dispatch);
    if (result.ok) {
      await supabase.from('dispatch_requests').update({ status: 'BOOKED', provider_response: result.providerResponse ?? dispatch.provider_response }).eq('id', dispatchId);
      await markQueueItem(supabase, item.id, 'DONE', attempts, null);
      succeeded += 1;
      void sendTelegramMessage(`✅ <b>DISPATCH BOOKED (retry queue)</b>\nDispatch ID: <code>${escapeTelegramHtml(dispatchId)}</code>\nLalamove booking succeeded on attempt ${attempts}.`);
    } else if (attempts >= maxAttempts) {
      await markQueueItem(supabase, item.id, 'FAILED', attempts, result.error || 'Unknown error');
      await supabase.from('dispatch_requests').update({ status: 'BOOKING_FAILED' }).eq('id', dispatchId);
      failed += 1;
      await reportCriticalError('retry-queue:lalamove_booking', new Error(result.error || 'Lalamove booking failed'), { dispatchId, attempts });
    } else {
      const nextAttemptAt = new Date(Date.now() + nextAttemptDelayMs(attempts)).toISOString();
      await supabase.from('outbound_request_queue').update({ attempts, last_error: result.error || null, next_attempt_at: nextAttemptAt }).eq('id', item.id);
      rescheduled += 1;
    }
  }

  await recordHeartbeat('retry-queue', failed ? 'degraded' : 'ok', { failed }); return NextResponse.json({ success: true, processed: (due || []).length, succeeded, rescheduled, failed });
}
