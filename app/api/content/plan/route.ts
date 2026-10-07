import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { planContent } from '../../_lib/content';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const { data, error } = await supabase.from('content_calendar').select('id, platform, media_type, status, scheduled_at, caption, post_url, error').order('scheduled_at', { ascending: false }).limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, items: data });
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { days?: number };
  const result = await planContent(Math.min(Math.max(Number(body.days) || 7, 1), 14));
  return NextResponse.json({ success: !result.error, ...result });
}
