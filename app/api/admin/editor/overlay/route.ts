import { NextResponse } from 'next/server';
import { editorChatFromRequest, writeSiteKey } from '../../../_lib/site-content';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { OVERLAY_STORAGE_KEY, sanitizeOverlay } from '../../../_lib/site-overlay-logic';

export const dynamic = 'force-dynamic';

// Publishes the Visual Editor's state so "Save All Changes" reaches the server and every visitor.
export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const parsed = sanitizeOverlay(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const error = await writeSiteKey(supabase, OVERLAY_STORAGE_KEY, { ...parsed.doc, updatedAt });
  if (error) return NextResponse.json({ error: 'Publish failed. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, updatedAt });
}
