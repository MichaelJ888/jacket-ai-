import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../_lib/integrations';
import { loadClientLogos } from '../_lib/client-logos';

export const dynamic = 'force-dynamic';

// Public trust-roster data: only client names and their logo URLs, read with the service role.
export async function GET() {
  const supabase = getSupabaseAdmin();
  const logos = supabase ? await loadClientLogos(supabase) : [];
  return NextResponse.json(logos, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
}
