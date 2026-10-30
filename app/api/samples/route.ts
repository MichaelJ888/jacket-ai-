import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../_lib/integrations';
import { manilaToday } from '../_lib/production-quota-logic';
import { SAMPLE_STATUSES, summarizeSamples, type SampleRow } from '../_lib/sample-logic';
import { isSampleStale, STALE_SAMPLE_DAYS, type StaleSampleRow } from '../_lib/sample-return-logic';

// GET: samples (newest first) plus summary counts, including samples stale for 30+ days with no client movement.
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data, error } = await supabase.from('sample_items').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const today = manilaToday();
  const rows = (data || []) as Array<SampleRow & StaleSampleRow>;
  const staleCount = rows.filter((row) => isSampleStale(row, today)).length;
  return NextResponse.json({
    success: true,
    today,
    staleAfterDays: STALE_SAMPLE_DAYS,
    summary: { ...summarizeSamples(rows, today), staleCount },
    samples: data || [],
  });
}

// POST: log a sample sent out. Body: { item, client_name, quantity?, contact_phone?, order_id?, expected_return_at?, notes? }
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const item = typeof body?.item === 'string' ? body.item.trim().slice(0, 200) : '';
  const clientName = typeof body?.client_name === 'string' ? body.client_name.trim().slice(0, 120) : '';
  if (!item || !clientName) return NextResponse.json({ error: 'item and client_name are required' }, { status: 400 });
  const quantity = body?.quantity === undefined ? 1 : Math.floor(Number(body.quantity));
  if (!(quantity > 0)) return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 });
  const expectedReturn = typeof body?.expected_return_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expected_return_at) ? body.expected_return_at : null;

  const { data, error } = await supabase
    .from('sample_items')
    .insert({
      item,
      quantity,
      client_name: clientName,
      contact_phone: typeof body?.contact_phone === 'string' ? body.contact_phone.slice(0, 40) : null,
      order_id: typeof body?.order_id === 'string' ? body.order_id : null,
      expected_return_at: expectedReturn,
      notes: typeof body?.notes === 'string' ? body.notes.slice(0, 500) : null,
    })
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Could not log sample' }, { status: 500 });

  await sendTelegramMessage(`📦 <b>SAMPLE OUT</b>\n${escapeTelegramHtml(data.item)} × ${data.quantity} → <b>${escapeTelegramHtml(data.client_name)}</b>${expectedReturn ? `\nIbalik bago ang: ${expectedReturn}` : ''}`);
  return NextResponse.json({ success: true, sample: data });
}

// PATCH: record return or loss, or client activity that resets the 30-day stale clock.
// Body: { id, status?: 'OUT' | 'RETURNED' | 'LOST' | 'DAMAGED', client_activity?: true }
export async function PATCH(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown; client_activity?: unknown } | null;
  if (typeof body?.id !== 'string') return NextResponse.json({ error: 'id is required' }, { status: 400 });

  if (body.client_activity === true) {
    const { data, error } = await supabase
      .from('sample_items')
      .update({ last_client_activity_at: new Date().toISOString(), stale_alert_on: null })
      .eq('id', body.id)
      .select()
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || 'Sample not found' }, { status: 404 });
    return NextResponse.json({ success: true, sample: data });
  }

  const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
  if (!(SAMPLE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `status must be one of ${SAMPLE_STATUSES.join(', ')}` }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('sample_items')
    .update({ status, returned_at: status === 'RETURNED' ? new Date().toISOString() : null })
    .eq('id', body.id)
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Sample not found' }, { status: 404 });

  if (status === 'LOST' || status === 'DAMAGED') {
    await sendTelegramMessage(`⚠️ <b>SAMPLE ${status}</b>: ${escapeTelegramHtml(data.item)} · ${escapeTelegramHtml(data.client_name)}`);
  }
  return NextResponse.json({ success: true, sample: data });
}
