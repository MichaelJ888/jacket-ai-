import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import {
  alertMetrics,
  countByDay,
  countByWeek,
  dayRange,
  heartbeatViews,
  manilaDay,
  rangeStartIso,
  severityByDay,
  summarizeQuotes,
  summarizeSamples,
  weekRange,
  type HeartbeatRow,
  type LogRow,
  type QuoteRow,
  type SampleRow,
} from '../../_lib/analytics-logic';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;
const QUOTE_WEEKS = 12;

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const now = new Date();
  const days = dayRange(now, WINDOW_DAYS);
  const since = rangeStartIso(now, WINDOW_DAYS);
  const quoteSince = rangeStartIso(now, QUOTE_WEEKS * 7);
  const weeks = weekRange(now, QUOTE_WEEKS);
  const dayStart = new Date(now.getTime() - 86_400_000).toISOString();

  const [leads, orders, samples, logs, heartbeats, queuePending, queueFailed, quotes] = await Promise.all([
    supabase.from('leads').select('created_at').gte('created_at', since).limit(5000),
    supabase.from('orders').select('created_at').gte('created_at', since).limit(5000),
    supabase.from('sample_items').select('status, expected_return_at').in('status', ['OUT', 'RETURNED', 'LOST', 'DAMAGED']).limit(5000),
    supabase.from('system_logs').select('severity, created_at').gte('created_at', since).in('severity', ['warning', 'error', 'critical']).limit(5000),
    supabase.from('job_heartbeats').select('job, last_run_at, last_status, last_alert_at').limit(200),
    supabase.from('outbound_request_queue').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
    supabase.from('outbound_request_queue').select('id', { count: 'exact', head: true }).eq('status', 'FAILED').gte('created_at', dayStart),
    supabase.from('formal_quotes').select('total, created_at, crm_contact_id').gte('created_at', quoteSince).limit(5000),
  ]);

  const failed = [leads, orders, samples, logs, heartbeats, quotes].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const quoteRows = (quotes.data || []) as Array<{ total: number | string; created_at: string; crm_contact_id: string | null }>;
  const contactIds = [...new Set(quoteRows.map((q) => q.crm_contact_id).filter((id): id is string => Boolean(id)))];
  const contacts = contactIds.length
    ? await supabase.from('crm_contacts').select('id, stage').in('id', contactIds).limit(5000)
    : { data: [], error: null };
  if (contacts.error) return NextResponse.json({ error: contacts.error.message }, { status: 500 });
  const stageById = new Map((contacts.data || []).map((c) => [c.id as string, c.stage as string]));
  const quoteSummaryRows: QuoteRow[] = quoteRows.map((q) => ({
    total: q.total,
    created_at: q.created_at,
    stage: q.crm_contact_id ? stageById.get(q.crm_contact_id) ?? null : null,
  }));

  const logRows = (logs.data || []) as LogRow[];
  const heartbeatRows = (heartbeats.data || []) as HeartbeatRow[];

  return NextResponse.json({
    generatedAt: now.toISOString(),
    days,
    enquiries: countByDay((leads.data || []).map((r) => r.created_at as string), days),
    orders: countByDay((orders.data || []).map((r) => r.created_at as string), days),
    quotes: {
      daily: countByDay(quoteRows.map((q) => q.created_at), days),
      weeks,
      weekly: countByWeek(quoteRows.map((q) => q.created_at), weeks),
      ...summarizeQuotes(quoteSummaryRows),
    },
    samples: summarizeSamples((samples.data || []) as SampleRow[], manilaDay(now)),
    severity: severityByDay(logRows, days),
    heartbeats: heartbeatViews(heartbeatRows, now),
    alerts: alertMetrics(logRows, heartbeatRows, now, { pending: queuePending.count ?? 0, failed: queueFailed.count ?? 0 }),
  });
}

