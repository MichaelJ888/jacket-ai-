import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import {
  alertMetrics,
  countByDay,
  dayRange,
  heartbeatViews,
  manilaDay,
  rangeStartIso,
  severityByDay,
  summarizeSamples,
  type HeartbeatRow,
  type LogRow,
  type SampleRow,
} from '../../_lib/analytics-logic';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const now = new Date();
  const days = dayRange(now, WINDOW_DAYS);
  const since = rangeStartIso(now, WINDOW_DAYS);
  const dayStart = new Date(now.getTime() - 86_400_000).toISOString();

  const [leads, orders, samples, logs, heartbeats, queuePending, queueFailed] = await Promise.all([
    supabase.from('leads').select('created_at').gte('created_at', since).limit(5000),
    supabase.from('orders').select('created_at').gte('created_at', since).limit(5000),
    supabase.from('sample_items').select('status, expected_return_at').in('status', ['OUT', 'RETURNED', 'LOST', 'DAMAGED']).limit(5000),
    supabase.from('system_logs').select('severity, created_at').gte('created_at', since).in('severity', ['warning', 'error', 'critical']).limit(5000),
    supabase.from('job_heartbeats').select('job, last_run_at, last_status, last_alert_at').limit(200),
    supabase.from('outbound_request_queue').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
    supabase.from('outbound_request_queue').select('id', { count: 'exact', head: true }).eq('status', 'FAILED').gte('created_at', dayStart),
  ]);

  const failed = [leads, orders, samples, logs, heartbeats].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const logRows = (logs.data || []) as LogRow[];
  const heartbeatRows = (heartbeats.data || []) as HeartbeatRow[];

  return NextResponse.json({
    generatedAt: now.toISOString(),
    days,
    enquiries: countByDay((leads.data || []).map((r) => r.created_at as string), days),
    orders: countByDay((orders.data || []).map((r) => r.created_at as string), days),
    samples: summarizeSamples((samples.data || []) as SampleRow[], manilaDay(now)),
    severity: severityByDay(logRows, days),
    heartbeats: heartbeatViews(heartbeatRows, now),
    alerts: alertMetrics(logRows, heartbeatRows, now, { pending: queuePending.count ?? 0, failed: queueFailed.count ?? 0 }),
  });
}
