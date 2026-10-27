import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { planContent, POSTING_SLOTS_MANILA } from '../../_lib/content';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Tops the calendar up to ~7 days ahead; safe to call repeatedly.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const horizon = new Date(Date.now() + 5 * 86400000).toISOString();
  const upcoming = supabase
    ? await supabase.from('content_calendar').select('id', { count: 'exact', head: true }).gte('scheduled_at', new Date().toISOString()).lte('scheduled_at', horizon)
    : null;
  // Each slot yields at least 2 rows (FB + IG), so 5 days of slots needs this many rows.
  if ((upcoming?.count || 0) >= POSTING_SLOTS_MANILA.length * 2 * 5) return NextResponse.json({ success: true, skipped: 'calendar already full', upcoming: upcoming?.count });
  const result = await planContent(7);
  await recordHeartbeat('content-plan', result.error ? 'error' : 'ok', result);
  return NextResponse.json({ success: !result.error, ...result });
}
