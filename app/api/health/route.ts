import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../_lib/integrations';

export const dynamic = 'force-dynamic';

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'GEMINI_API_KEY',
  'AI_GATEWAY_API_KEY',
  'CRON_SECRET',
  'SCHEDULER_TOKEN',
  'ADMIN_TOKEN',
  'MEMORY_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'PAYMENT_WEBHOOK_SECRET',
  'MANYCHAT_WEBHOOK_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'META_APP_SECRET',
  'META_APP_ID',
];

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

// Jobs expected to check in, with the max age (minutes) before they count as stale.
const JOB_MAX_AGE_MIN: Record<string, number> = {
  // GitHub Actions schedules routinely drift 3-4h, so thresholds must tolerate that.
  'sales-followups': 360,
  'content-publisher': 360,
};

type Check = { ok: boolean; detail?: string };

// Public by design: returns only booleans, counts and timings, never secrets or row data.
export async function GET() {
  const checks: Record<string, Check> = {};
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
      checks.criticalErrors24h = { ok: (critical.count ?? 0) === 0, detail: String(critical.count ?? 'unknown') };
      checks.retryQueueBacklog = { ok: (queue.count ?? 0) < 25, detail: String(queue.count ?? 'unknown') };

      const stale: string[] = [];
      const seen = new Map((heartbeats.data || []).map((row) => [row.job as string, row]));
      for (const [job, maxAge] of Object.entries(JOB_MAX_AGE_MIN)) {
        const row = seen.get(job);
        const ageMin = row ? (Date.now() - new Date(row.last_run_at as string).getTime()) / 60000 : Infinity;
        if (ageMin > maxAge) stale.push(job);
      }
      checks.scheduledJobs = { ok: stale.length === 0, detail: stale.length ? `stale or never run: ${stale.join(', ')}` : undefined };
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
