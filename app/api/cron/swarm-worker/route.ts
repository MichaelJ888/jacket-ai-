import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { advanceSwarmJob } from '../../_lib/swarm-jobs';

export const maxDuration = 60;

// Advances the oldest RUNNING swarm job by one time-boxed slice (scheduler hits this every 5 min).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { data: jobs } = await supabase.from('swarm_jobs').select('id').eq('status', 'RUNNING').order('created_at').limit(2);
  for (const job of jobs ?? []) {
    const outcome = await advanceSwarmJob(job.id);
    if (outcome !== 'skipped') return NextResponse.json({ job_id: job.id, outcome });
  }
  return NextResponse.json({ outcome: 'idle' });
}
