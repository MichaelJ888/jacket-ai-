import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { runAutoPilot } from '../../_lib/auto-pilot';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Self-healing catch-up pass: the GitHub Actions scheduler calls this on EVERY
// run (any schedule line), so one delayed run can never starve the sub-daily
// jobs — the next run of anything re-invokes whatever went stale.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const token = process.env.CRON_SECRET || process.env.SCHEDULER_TOKEN || '';
  const summary = await runAutoPilot({ origin: new URL(request.url).origin, token, supabase });
  const failed = summary.kicked.filter((kick) => kick.status !== 200);
  await recordHeartbeat('auto-pilot', summary.heartbeatError ? 'error' : failed.length ? 'degraded' : 'ok', summary);
  return NextResponse.json({ success: !summary.heartbeatError, ...summary });
}
