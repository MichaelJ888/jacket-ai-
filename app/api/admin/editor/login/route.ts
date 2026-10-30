import { NextResponse } from 'next/server';
import { getSupabaseAdmin, sendTelegramDirectMessage } from '../../../_lib/integrations';
import { checkEditorPassword, generateOtp, hashOtp, isEditorChatAllowed, OTP_TTL_MS } from '../../../_lib/site-content-logic';
import { writeOtpRow } from '../../../_lib/site-content';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: unknown; chatId?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  const envPassword = process.env.EDITOR_PASSWORD;

  if (!checkEditorPassword(password, envPassword)) return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  if (!isEditorChatAllowed(chatId, process.env.TELEGRAM_CEO_USER_ID)) return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const code = generateOtp();
  await writeOtpRow(supabase, chatId, { hash: hashOtp(code, chatId, envPassword as string), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  const sent = await sendTelegramDirectMessage(chatId, `MJIC editor login code: ${code}\nExpires in 5 minutes. If you did not request this, ignore it.`);
  if (!sent) return NextResponse.json({ error: 'Could not send the code. Make sure this Telegram account has started the MJIC bot.' }, { status: 502 });

  return NextResponse.json({ ok: true });
}
