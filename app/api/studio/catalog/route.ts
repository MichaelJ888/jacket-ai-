import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Public read of catalog studio images. Exposes only display fields; never job ids, errors or sources.
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ items: [] });
  const { data, error } = await supabase
    .from('studio_jobs')
    .select('id, output_url, product_title, category, fabric, description, featured_at')
    .eq('in_catalog', true)
    .in('status', ['approved', 'posted'])
    .not('output_url', 'is', null)
    .order('featured_at', { ascending: false, nullsFirst: false })
    .limit(12);
  if (error) return NextResponse.json({ items: [] }, { status: 500 });
  return NextResponse.json({ items: data ?? [] }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } });
}
