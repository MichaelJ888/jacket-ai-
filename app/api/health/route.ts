import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../_lib/integrations';
import { evaluateOperationalHealth, type HealthCheck } from '../_lib/health-logic';
import { REQUIRED_ENV } from '../../../scripts/lib/env-policy.mjs';

export const dynamic = 'force-dynamic';

const OPTIONAL_ENV = [
  'VERCEL_TOKEN',
  'META_PAGE_ACCESS_TOKEN',
  'META_PAGE_ID',
  'META_IG_USER_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
  'YOUTUBE_REFRESH_TOKEN',
  'LALAMOVE_API_TOKEN',
  'EMBROIDERY_DIGITIZE_API_KEY',
  'RESEND_API_KEY',
];

// Public by design: returns only booleans, counts and timings, never secrets or row data.
export async function GET() {
  const checks: Record<string, HealthCheck> = {};
  const supabase = getSupabaseAdmin();

  checks.env = {
    ok: REQUIRED_ENV.every((name) => Boolean(process.env[name])),
    detail: REQUIRED_ENV.filter((name) => !process.env[name]).join(', ') || undefined,
  };

  let latencyMs: number | null = null;
  if (!supabase) {
    checks.database = { ok: false, detail: 'service-role client not configured' };
  } else {
    try {
      const start = Date.now();
      const result = await supabase.from('leads').select('id', { count: 'exact', head: true });
      latencyMs = Date.now() - start;
      checks.database = result.error ? { ok: false, detail: result.error.message } : { ok: true };
    } catch (error) {
      checks.database = { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
    }

    try {
      const { error } = await supabase.storage.from('media-ad-renders').list('', { limit: 1 });
      checks.storage = error ? { ok: false, detail: error.message } : { ok: true };
    } catch (error) {
      checks.storage = { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
    }

    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [critical, queue, heartbeats] = await Promise.all([
        supabase.from('system_logs').select('id', { count: 'exact', head: true }).eq('severity', 'critical').gte('created_at', since),
        supabase.from('outbound_request_queue').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
        supabase.from('job_heartbeats').select('job, last_run_at, last_status'),
      ]);
      for (const [name, result] of Object.entries({ criticalErrors24h: critical, retryQueueBacklog: queue, scheduledJobs: heartbeats })) {
        if (result.error) console.error(`health ${name} query failed:`, result.error.message);
      }
      Object.assign(checks, evaluateOperationalHealth(critical, queue, heartbeats));
    } catch (error) {
      checks.operations = { ok: false, detail: error instanceof Error ? error.message : 'query failed' };
    }
  }

  // Core = what must be true for the system to be up; stale jobs or alerts only degrade.
  const coreOk = Boolean(checks.database?.ok && checks.env?.ok);
  const allOk = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    {
      status: coreOk ? (allOk ? 'ok' : 'degraded') : 'down',
      time: new Date().toISOString(),
      dbLatencyMs: latencyMs,
      checks,
      optionalIntegrations: Object.fromEntries(OPTIONAL_ENV.map((name) => [name, Boolean(process.env[name])])),
    },
    { status: coreOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
