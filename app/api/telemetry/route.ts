import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { getSupabaseAdmin } from '../_lib/integrations';
import { evaluateJobs, JOBS, type Heartbeat } from '../_lib/coo-logic';

export const dynamic = 'force-dynamic';

// Admin-only live snapshot for the System Health page. Returns timings, memory and job states; never row data or secrets.
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  let dbPingMs: number | null = null;
  let dbOk = false;
  let jobs: ReturnType<typeof evaluateJobs> = [];

  if (supabase) {
    const start = Date.now();
    const [ping, beats] = await Promise.all([
      supabase.from('job_heartbeats').select('job', { count: 'exact', head: true }),
      supabase.from('job_heartbeats').select('job, last_run_at, last_status'),
    ]);
    dbPingMs = Date.now() - start;
    dbOk = !ping.error;
    if (!beats.error) {
      jobs = evaluateJobs((beats.data || []).map((row) => ({ job: String(row.job), last_run_at: String(row.last_run_at), last_status: String(row.last_status) })) as Heartbeat[], Date.now(), JOBS);
    }
  }

  const mem = process.memoryUsage();
  const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

  return NextResponse.json(
    {
      time: new Date().toISOString(),
      database: { ok: dbOk, pingMs: dbPingMs },
      runtime: { uptimeSec: Math.round(process.uptime()), rssMb: toMb(mem.rss), heapUsedMb: toMb(mem.heapUsed) },
      jobs: jobs.map((job) => ({ job: job.job, label: job.label, state: job.state, lastRunAt: job.lastRunAt, lastStatus: job.lastStatus })),
      failingJobs: jobs.filter((job) => job.state === 'stale' || job.state === 'degraded').length,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
