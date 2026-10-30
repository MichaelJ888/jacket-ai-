import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../_lib/integrations';
import { loadSiteDoc } from '../_lib/site-content';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getSupabaseAdmin();
  const doc = supabase ? await loadSiteDoc(supabase).catch(() => null) : null;
  return NextResponse.json(doc ?? { theme: {}, texts: {}, images: {}, catalogOrder: [], updatedAt: null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
