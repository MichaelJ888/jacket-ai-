import { NextResponse } from 'next/server';
import { editorOrAdminAuthorized, writeSiteKey } from '../../../_lib/site-content';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { externalizeDataImages } from '../../../_lib/site-media';
import { OVERLAY_STORAGE_KEY, sanitizeOverlay } from '../../../_lib/site-overlay-logic';

export const dynamic = 'force-dynamic';

// Publishes the Visual Editor's state so "Save All Changes" reaches the server and every visitor.
export async function POST(request: Request) {
  if (!editorOrAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const externalized = await externalizeDataImages(supabase, await request.json().catch(() => null));
  if (!externalized.ok) return NextResponse.json({ error: externalized.error }, { status: 400 });
  const parsed = sanitizeOverlay(externalized.body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const error = await writeSiteKey(supabase, OVERLAY_STORAGE_KEY, { ...parsed.doc, updatedAt });
  if (error) return NextResponse.json({ error: 'Publish failed. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, updatedAt });
}
