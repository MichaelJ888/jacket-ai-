import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { autoPilotState } from '../../_lib/auto-pilot';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Live state for the "1-push Auto-Pilot / Stabilize" badge on /admin.
// ON means: the auto-pilot heartbeat is fresh and healthy and no sub-daily cron job is stale.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { data, error } = await supabase.from('job_heartbeats').select('job,last_run_at,last_status');
  if (error || !data) return NextResponse.json({ error: error?.message || 'Heartbeat query failed' }, { status: 503 });

  const state = autoPilotState(data);
  return NextResponse.json({ ok: true, ...state, checkedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
