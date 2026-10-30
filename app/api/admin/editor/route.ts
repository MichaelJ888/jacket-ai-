import { NextResponse } from 'next/server';
import { EDITOR_COOKIE, sanitizeSiteDoc } from '../../_lib/site-content-logic';
import { editorChatFromRequest, loadSiteDoc, saveSiteDoc } from '../../_lib/site-content';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: Request) {
  const chatId = editorChatFromRequest(request);
  if (!chatId) return unauthorized();
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const doc = await loadSiteDoc(supabase);
  return NextResponse.json({ chatId, doc }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return unauthorized();
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = await request.json().catch(() => null);
  const parsed = sanitizeSiteDoc(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error, updatedAt } = await saveSiteDoc(supabase, parsed.doc);
  if (error) return NextResponse.json({ error: 'Publish failed. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, updatedAt });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(EDITOR_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
