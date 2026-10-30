import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import {
  checkEditorPassword,
  EDITOR_COOKIE,
  EDITOR_SESSION_MS,
  hashOtp,
  isEditorChatAllowed,
  OTP_MAX_ATTEMPTS,
  signEditorSession,
} from '../../../_lib/site-content-logic';
import { readOtpRow, writeOtpRow } from '../../../_lib/site-content';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: unknown; chatId?: unknown; code?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const envPassword = process.env.EDITOR_PASSWORD;

  if (!checkEditorPassword(password, envPassword) || !isEditorChatAllowed(chatId, process.env.TELEGRAM_CEO_USER_ID)) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const row = await readOtpRow(supabase, chatId);
  if (!row || row.expiresAt < Date.now()) return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 401 });
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await writeOtpRow(supabase, chatId, null);
    return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429 });
  }
  if (hashOtp(code, chatId, envPassword as string) !== row.hash) {
    await writeOtpRow(supabase, chatId, { ...row, attempts: row.attempts + 1 });
    return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 });
  }

  await writeOtpRow(supabase, chatId, null);
  const expiresAt = Date.now() + EDITOR_SESSION_MS;
  const response = NextResponse.json({ ok: true, chatId, expiresAt });
  response.cookies.set(EDITOR_COOKIE, signEditorSession(chatId, expiresAt, envPassword as string), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(EDITOR_SESSION_MS / 1000),
  });
  return response;
}
