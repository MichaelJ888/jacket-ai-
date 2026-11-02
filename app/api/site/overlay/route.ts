import { NextResponse } from 'next/server';
import { readSiteKeys } from '../../_lib/site-content';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { OVERLAY_STORAGE_KEY, PUBLIC_OVERLAY_KEYS, SEO_OVERRIDE_KEY, buildSeoOverride, publicOverlay, type SeoOverride } from '../../_lib/site-overlay-logic';

export const dynamic = 'force-dynamic';

// Public, read-only: published homepage state plus the SEO override. Internal CRM/staff data is never returned.
export async function GET() {
  const supabase = getSupabaseAdmin();
  const rows: Record<string, unknown> = supabase ? await readSiteKeys(supabase, [OVERLAY_STORAGE_KEY, SEO_OVERRIDE_KEY]).catch(() => ({})) : {};
  const overlay = publicOverlay(rows[OVERLAY_STORAGE_KEY] as Record<string, unknown> | undefined);
  // Always derive the SEO block from current code so the latest JSON-LD ships without an editor re-save.
  const seo = buildSeoOverride(rows[SEO_OVERRIDE_KEY] as Partial<SeoOverride> | undefined, new Date().toISOString());
  return NextResponse.json({ overlay, seo, publicKeys: PUBLIC_OVERLAY_KEYS }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
