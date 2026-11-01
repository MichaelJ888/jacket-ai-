import { NextResponse } from 'next/server';
import { editorChatFromRequest } from '../../_lib/site-content';
import { SEO_SITE_ORIGIN, auditSeoHtml } from '../../_lib/seo-audit';

export const dynamic = 'force-dynamic';

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
