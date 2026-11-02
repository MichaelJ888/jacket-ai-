import { NextResponse } from 'next/server';
import { editorChatFromRequest, readSiteKeys, writeSiteKey } from '../../_lib/site-content';
import { SEO_SITE_ORIGIN, auditSeoHtml } from '../../_lib/seo-audit';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { SEO_OVERRIDE_KEY, buildSeoOverride, type SeoOverride } from '../../_lib/site-overlay-logic';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  try {
    const stored = (await readSiteKeys(supabase, [SEO_OVERRIDE_KEY]))[SEO_OVERRIDE_KEY] as Partial<SeoOverride> | undefined;
    const override = buildSeoOverride(stored, new Date().toISOString());
    const error = await writeSiteKey(supabase, SEO_OVERRIDE_KEY, override);
    if (error) return NextResponse.json({ error: 'Could not save the SEO override.' }, { status: 500 });
    return NextResponse.json({ ok: true, override });
  } catch {
    return NextResponse.json({ error: 'Could not save the SEO override.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const res = await fetch(`${SEO_SITE_ORIGIN}/index.html`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return NextResponse.json({ error: `Homepage returned HTTP ${res.status}.` }, { status: 502 });
    const html = await res.text();
    return NextResponse.json({ url: `${SEO_SITE_ORIGIN}/`, fetchedAt: new Date().toISOString(), audit: auditSeoHtml(html) });
  } catch {
    return NextResponse.json({ error: 'Could not fetch the live homepage.' }, { status: 502 });
  }
}
