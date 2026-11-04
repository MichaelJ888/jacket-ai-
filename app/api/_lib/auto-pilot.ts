// Auto-pilot: self-healing catch-up for sub-daily cron jobs.
// Vercel Hobby runs native crons only once/day, so GitHub Actions plays external
// scheduler — but GitHub regularly delays or drops scheduled runs (observed: 7h+).
// Whenever ANY scheduler run fires, /api/cron/auto-pilot re-invokes every route
// whose heartbeat is older than its interval. Safe to call often: each underlying
// route does its own due-work dedup, so a redundant kick finds nothing to do.

export type CatchUpJob = { job: string; path: string; maxAgeMin: number };

// Intervals match .github/workflows/scheduler.yml cadences, with jitter headroom.
export const CATCH_UP_JOBS: CatchUpJob[] = [
  { job: 'embroidery-pickup-alerts', path: '/api/cron/embroidery-pickup-alerts', maxAgeMin: 15 },
  { job: 'swarm-worker', path: '/api/cron/swarm-worker', maxAgeMin: 15 },
  { job: 'improvement-scout', path: '/api/cron/improvement-scout', maxAgeMin: 45 },
  { job: 'staff-reminders', path: '/api/cron/staff-reminders?type=watch', maxAgeMin: 60 },
  { job: 'retry-queue', path: '/api/cron/retry-queue', maxAgeMin: 60 },
  { job: 'sales-followups', path: '/api/cron/sales-followups', maxAgeMin: 60 },
  { job: 'content-publisher', path: '/api/cron/content-publisher', maxAgeMin: 60 },
  { job: 'watchdog', path: '/api/cron/watchdog', maxAgeMin: 60 },
];

export type HeartbeatRow = { job: string; last_run_at: string | null; last_status: string | null };

// "1-push Auto-Pilot / Stabilize" state for the admin badge.
export const AUTO_PILOT_JOB = 'auto-pilot';
// The GitHub scheduler fires at */5 and */45 cadences; 120 min tolerates heavy schedule delays without hiding a real outage.
export const AUTO_PILOT_FRESH_MS = 120 * 60_000;

export type AutoPilotState = {
  on: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  due: string[];
};

// ON = auto-pilot's own heartbeat is fresh + healthy AND no sub-daily job is stale. OFF (amber) otherwise.
export function autoPilotState(beats: HeartbeatRow[], now = Date.now()): AutoPilotState {
  const self = beats.find((row) => row.job === AUTO_PILOT_JOB);
  const lastRunMs = Date.parse(self?.last_run_at ?? '');
  const fresh = Number.isFinite(lastRunMs) && now - lastRunMs <= AUTO_PILOT_FRESH_MS;
  const due = dueCatchUpJobs(beats, now).map((job) => job.job);
  return {
    on: Boolean(fresh && self?.last_status === 'ok' && due.length === 0),
    lastRunAt: self?.last_run_at ?? null,
    lastStatus: self?.last_status ?? null,
    due,
  };
}

// Returns due jobs most-stale first, so the per-pass kick cap can never starve a job.
export function dueCatchUpJobs(beats: HeartbeatRow[], now = Date.now(), jobs: CatchUpJob[] = CATCH_UP_JOBS): CatchUpJob[] {
  const seen = new Map(beats.map((row) => [row.job, row]));
  // Never ran (or clock garbage) maps to epoch 0, i.e. due and first in line.
  const lastRunMs = (job: string) => {
    const parsed = Date.parse(seen.get(job)?.last_run_at ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return jobs
    .filter(({ job, maxAgeMin }) => now - lastRunMs(job) > maxAgeMin * 60_000)
    .sort((a, b) => lastRunMs(a.job) - lastRunMs(b.job));
}

export type KickResult = { job: string; path: string; status: number | 'error' };

type HeartbeatSource = {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{ data: HeartbeatRow[] | null; error: { message: string } | null }>;
  };
};

export type AutoPilotSummary = {
  checked: number;
  due: string[];
  kicked: KickResult[];
  skipped: string[];
  heartbeatError?: string;
};

// Kicks at most `maxKicks` stale jobs per pass (sequential, 25s timeout each) so a
// pass always fits inside the 60s Hobby function budget; the next pass handles the rest.
export async function runAutoPilot(options: {
  origin: string;
  token: string;
  supabase: HeartbeatSource;
  fetchFn?: typeof fetch;
  now?: number;
  maxKicks?: number;
}): Promise<AutoPilotSummary> {
  const { origin, token, supabase, fetchFn = fetch, now = Date.now(), maxKicks = 2 } = options;
  const { data, error } = await supabase.from('job_heartbeats').select('job,last_run_at,last_status');
  if (error || !data) {
    return { checked: 0, due: [], kicked: [], skipped: [], heartbeatError: error?.message || 'no data' };
  }
  const due = dueCatchUpJobs(data, now);
  const kicked: KickResult[] = [];
  for (const job of due.slice(0, Math.max(1, maxKicks))) {
    try {
      const response = await fetchFn(`${origin}${job.path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(25_000),
      });
      kicked.push({ job: job.job, path: job.path, status: response.status });
    } catch {
      kicked.push({ job: job.job, path: job.path, status: 'error' });
    }
  }
  return {
    checked: data.length,
    due: due.map((job) => job.job),
    kicked,
    skipped: due.slice(Math.max(1, maxKicks)).map((job) => job.job),
  };
}
