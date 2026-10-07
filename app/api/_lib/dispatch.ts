import { enqueueOutboundRequest, escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from './integrations';

// Approves a PENDING_APPROVAL dispatch and books it with Lalamove (or queues a durable retry).
// Shared by the logistics API route and the Telegram "Book now" button.
export async function approveDispatch(dispatchId: string): Promise<{ ok: boolean; status?: string; message: string; httpStatus: number; dispatch?: unknown; liveApiUsed?: boolean; retryQueued?: boolean }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, message: 'Supabase is not configured', httpStatus: 503 };
  const { data: dispatch, error: fetchError } = await supabase.from('dispatch_requests').select('*').eq('id', dispatchId).single();
  if (fetchError || !dispatch) return { ok: false, message: fetchError?.message || 'Dispatch not found', httpStatus: 404 };
  if (dispatch.status !== 'PENDING_APPROVAL') return { ok: false, message: `Dispatch is already ${dispatch.status}`, httpStatus: 409 };

  // Claim first so a double tap cannot book two vehicles.
  const { data: claimed } = await supabase.from('dispatch_requests').update({ status: 'APPROVED_PENDING_BOOKING', approved_at: new Date().toISOString() }).eq('id', dispatchId).eq('status', 'PENDING_APPROVAL').select().maybeSingle();
  if (!claimed) return { ok: false, message: 'Dispatch is already being handled', httpStatus: 409 };

  const apiUrl = process.env.LALAMOVE_API_URL;
  const apiToken = process.env.LALAMOVE_API_TOKEN;
  let providerResponse: unknown = null;
  let status = 'APPROVED_PENDING_BOOKING';
  if (apiUrl && apiToken) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup_address: dispatch.pickup_address, delivery_address: dispatch.delivery_address, contact_name: dispatch.contact_name, contact_phone: dispatch.contact_phone, package_description: dispatch.package_description }),
        signal: AbortSignal.timeout(15000),
      });
      providerResponse = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Lalamove API rejected the dispatch (HTTP ${response.status})`);
      status = 'BOOKED';
    } catch (bookingError) {
      const queued = await enqueueOutboundRequest('lalamove_booking', { dispatchId });
      if (queued.error) return { ok: false, message: `Lalamove booking failed and retry queue is unavailable: ${queued.error}`, httpStatus: 502 };
      status = 'BOOKING_RETRY_QUEUED';
      providerResponse = { initialError: bookingError instanceof Error ? bookingError.message : String(bookingError), queueId: queued.data?.id || null };
    }
  }
  const { data: updated, error } = await supabase.from('dispatch_requests').update({ status, provider_response: providerResponse }).eq('id', dispatchId).select().single();
  if (error) return { ok: false, message: error.message, httpStatus: 502 };
  const statusNote = !apiUrl ? 'Lalamove credentials not configured; ready for manual booking.' : status === 'BOOKED' ? 'Lalamove booking submitted.' : 'Lalamove unreachable; retry queued automatically (processed by /api/cron/retry-queue).';
  void sendTelegramMessage(`<b>DISPATCH ${escapeTelegramHtml(status)}</b>\nDispatch ID: <code>${dispatchId}</code>\n${statusNote}`);
  return { ok: true, status, message: statusNote, httpStatus: 200, dispatch: updated, liveApiUsed: Boolean(apiUrl && apiToken), retryQueued: status === 'BOOKING_RETRY_QUEUED' };
}
