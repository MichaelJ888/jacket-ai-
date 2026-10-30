import { evaluateFundLockAlert } from './fund-lock-alert-logic';
import { runStaleSampleRetrieval } from './sample-retrieval';
import { sendTelegramMessage, getSupabaseAdmin } from './integrations';
import { getCashBalance } from './ceo-finance';
import { selectStaleSamplesToAlert, type StaleSampleRow } from './sample-return-logic';
import { evaluateJobs, JOBS } from './coo-logic';

type SupabaseLike = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
export type HealthLevel = 'ok' | 'warn' | 'red';
export type HealthCheck = { feature: string; level: HealthLevel; detail: string; selfHeal?: string };

// Each feature reports one check. Red means the feature needs attention; warn means it is incomplete but not broken.
export async function runSystemHealthAudit(supabase: SupabaseLike, today: string): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  const [samplesResult, quotasResult, subconsResult, locksResult, heartbeatsResult, cashBalance] = await Promise.all([
    supabase.from('sample_items').select('id, item, quantity, client_name, contact_phone, status, sent_at, last_client_activity_at, stale_alert_on').eq('status', 'OUT'),
    supabase.from('production_quotas').select('period_kind, target_pcs'),
    supabase.from('subcon_directory').select('name, messenger_handle, active'),
    supabase.from('material_fund_locks').select('amount').eq('status', 'LOCKED'),
    supabase.from('job_heartbeats').select('job, last_run_at, last_status'),
    getCashBalance(),
  ]);

  const stale = selectStaleSamplesToAlert((samplesResult.data || []) as StaleSampleRow[], today);
  const outCount = (samplesResult.data || []).length;
  checks.push({
    feature: 'Sample return tracker',
    level: samplesResult.error ? 'red' : stale.length ? 'warn' : 'ok',
    detail: samplesResult.error ? samplesResult.error.message : `${outCount} na nasa kliyente; ${stale.length} ang lampas 30 araw at kailangang i-retrieve.`,
    selfHeal: stale.length ? 'Ipadala ang retrieval alert kay Ms. Anne (o owner group).' : undefined,
  });

  const quotaCount = (quotasResult.data || []).filter((row) => row.target_pcs !== null).length;
  checks.push({
    feature: 'Production quota engine',
    level: quotasResult.error ? 'red' : quotaCount ? 'ok' : 'warn',
    detail: quotasResult.error ? quotasResult.error.message : quotaCount ? `${quotaCount} quota target ang naka-set.` : 'Walang quota target na naka-set.',
  });

  const subcons = subconsResult.data || [];
  const activeSubcons = subcons.filter((row) => row.active !== false);
  const withoutLink = activeSubcons.filter((row) => !row.messenger_handle).length;
  checks.push({
    feature: 'Subcon directory',
    level: subconsResult.error ? 'red' : activeSubcons.length === 0 ? 'warn' : 'ok',
    detail: subconsResult.error ? subconsResult.error.message : `${activeSubcons.length} aktibong subcon; ${withoutLink} walang m.me handle.`,
  });

  const lockedTotal = (locksResult.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const fund = evaluateFundLockAlert({ cashBalance, lockedTotal });
  checks.push({
    feature: 'Down payment fund lock',
    level: fund.level === 'red' ? 'red' : fund.level === 'unknown' ? 'warn' : 'ok',
    detail: fund.message,
    selfHeal: fund.level === 'red' ? 'Ipadala ulit ang Red Alert sa owner group (isang beses kada araw).' : undefined,
  });

  // Each job is judged against its own cadence (weekly/monthly jobs are not stale after 36h).
  const heartbeats = heartbeatsResult.data || [];
  const jobReports = evaluateJobs(
    heartbeats.map((row) => ({ job: String(row.job), last_run_at: String(row.last_run_at), last_status: String(row.last_status) })),
    Date.now(),
    JOBS,
  );
  const staleJobs = jobReports.filter((row) => row.state === 'stale');
  const failedJobs = heartbeats.filter((row) => row.last_status && String(row.last_status).toLowerCase() === 'error');
  checks.push({
    feature: 'Background jobs (cron)',
    level: heartbeatsResult.error ? 'red' : failedJobs.length ? 'red' : staleJobs.length ? 'warn' : 'ok',
    detail: heartbeatsResult.error
      ? heartbeatsResult.error.message
      : `${heartbeats.length} job ang naitala; ${failedJobs.length} may error; ${staleJobs.length} ang lampas sa inaasahang iskedyul.`,
  });

  // ANNE_MANALO_TELEGRAM_CHAT_ID is optional: retrieval alerts fall back to the owner group.
  const envChecks = [
    { name: 'TELEGRAM_BOT_TOKEN', ok: Boolean(process.env.TELEGRAM_BOT_TOKEN), required: true },
    { name: 'CRON_SECRET', ok: Boolean(process.env.CRON_SECRET), required: true },
  ];
  const missing = envChecks.filter((row) => !row.ok).map((row) => row.name);
  const missingRequired = envChecks.filter((row) => row.required && !row.ok);
  checks.push({
    feature: 'Environment config',
    level: missingRequired.length ? 'red' : missing.length ? 'warn' : 'ok',
    detail: missing.length ? `Kulang: ${missing.join(', ')}` : 'Kumpleto ang kailangang env variables.',
  });

  return checks;
}

// Safe, idempotent self-heal only: re-send alerts. No money, stock, or order data is changed.
export async function runSelfHeal(supabase: SupabaseLike, today: string, checks: HealthCheck[]) {
  const actions: string[] = [];

  if (checks.some((row) => row.feature === 'Sample return tracker' && row.selfHeal)) {
    const result = await runStaleSampleRetrieval(supabase, today);
    actions.push(`Sample retrieval: ${result.alerted} alert (${result.recipient})`);
  }

  const fundRed = checks.some((row) => row.feature === 'Down payment fund lock' && row.level === 'red');
  if (fundRed) {
    const { data } = await supabase.from('job_heartbeats').select('last_run_at').eq('job', 'system-health:fund-lock').maybeSingle();
    const sentToday = data?.last_run_at ? String(data.last_run_at).slice(0, 10) === today : false;
    if (!sentToday) {
      const detail = checks.find((row) => row.feature === 'Down payment fund lock')?.detail || '';
      await sendTelegramMessage(`🚨 <b>RED ALERT: FUND LOCK</b>\n${detail}`);
      await supabase.from('job_heartbeats').upsert(
        { job: 'system-health:fund-lock', last_run_at: new Date().toISOString(), last_status: 'ok', details: { detail } },
        { onConflict: 'job' },
      );
      actions.push('Fund lock Red Alert ipinadala sa owner group');
    } else {
      actions.push('Fund lock Red Alert: naipadala na ngayong araw');
    }
  }

  return actions;
}

export async function recordSystemHealth(supabase: SupabaseLike, checks: HealthCheck[], actions: string[]) {
  const red = checks.filter((row) => row.level === 'red').length;
  await supabase.from('job_heartbeats').upsert(
    {
      job: 'system-health',
      last_run_at: new Date().toISOString(),
      last_status: red ? 'error' : 'ok',
      details: { checks: checks.map((row) => ({ feature: row.feature, level: row.level })), actions },
    },
    { onConflict: 'job' },
  );
}
