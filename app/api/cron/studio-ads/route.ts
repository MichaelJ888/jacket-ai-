import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { runDailyStudioAds } from '../../_lib/studio-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily: builds up to 3 picture ads from catalog photos and sends each to Telegram for CEO approval. Nothing posts without approval.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const summary = await runDailyStudioAds(supabase, 3);
  return NextResponse.json({ ok: true, ...summary });
}
