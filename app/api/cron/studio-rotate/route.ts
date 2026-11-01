import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Weekly rotation: the catalog is ordered by featured_at, so bumping the least-recently featured item moves it to the front.
// Round-robins every catalog photo over time without changing its title, category, fabric or description.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const { data: next, error: pickError } = await supabase
    .from('studio_jobs')
    .select('id')
    .eq('in_catalog', true)
    .in('status', ['approved', 'posted'])
    .not('output_url', 'is', null)
    .order('featured_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (pickError) return NextResponse.json({ error: 'Could not pick a catalog item.' }, { status: 500 });
  if (!next) return NextResponse.json({ ok: true, rotated: null });

  const now = new Date().toISOString();
  const { error } = await supabase.from('studio_jobs').update({ featured_at: now, updated_at: now }).eq('id', next.id);
  if (error) return NextResponse.json({ error: 'Could not rotate the catalog.' }, { status: 500 });
  return NextResponse.json({ ok: true, rotated: next.id, featuredAt: now });
}
