export type HealthCheck = { ok: boolean; detail?: string };

type QueryError = { message: string } | null;
type CountResult = { count: number | null; error: QueryError };
type Heartbeat = { job: string; last_run_at: string | null; last_status: string | null };
type HeartbeatResult = { data: Heartbeat[] | null; error: QueryError };

// Allow for GitHub Actions scheduling delays, not just the nominal 5/45-minute cadence.
const JOB_MAX_AGE_MIN: Record<string, number> = {
  'sales-followups': 360,
  'content-publisher': 360,
  'retry-queue': 360,
  'swarm-worker': 360,
};

function countCheck(result: CountResult, limit: number): HealthCheck {
  if (result.error) return { ok: false, detail: 'query failed' };
  if (result.count === null || !Number.isFinite(result.count) || result.count < 0) {
    return { ok: false, detail: 'count unavailable' };
  }
  return { ok: result.count < limit, detail: String(result.count) };
}

export function evaluateOperationalHealth(
  critical: CountResult,
  queue: CountResult,
  heartbeats: HeartbeatResult,
  now = Date.now(),
): Record<string, HealthCheck> {
  const checks: Record<string, HealthCheck> = {
    criticalErrors24h: countCheck(critical, 1),
    retryQueueBacklog: countCheck(queue, 25),
  };

  if (heartbeats.error || !heartbeats.data) {
    checks.scheduledJobs = { ok: false, detail: 'heartbeat query failed' };
    return checks;
  }

  const seen = new Map(heartbeats.data.map((row) => [row.job, row]));
  const stale: string[] = [];
  const failed: string[] = [];
  for (const [job, maxAge] of Object.entries(JOB_MAX_AGE_MIN)) {
    const row = seen.get(job);
    const timestamp = row?.last_run_at ? Date.parse(row.last_run_at) : NaN;
    const ageMin = (now - timestamp) / 60_000;
    if (!Number.isFinite(ageMin) || ageMin < -5 || ageMin > maxAge) stale.push(job);
    if (row && row.last_status !== 'ok') failed.push(job);
  }
  const details = [
    stale.length ? `stale or invalid heartbeat: ${stale.join(', ')}` : '',
    failed.length ? `unsuccessful last run: ${failed.join(', ')}` : '',
  ].filter(Boolean);
  checks.scheduledJobs = { ok: details.length === 0, detail: details.join('; ') || undefined };
  return checks;
}
