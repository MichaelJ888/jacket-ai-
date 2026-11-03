import { NextResponse } from 'next/server';

import { generateOtp, hashOtp, otpMatches, otpUsable, OTP_TTL_MS, type OtpRow } from '../../../_lib/admin-otp';
import { isAdminAuthorized } from '../../../_lib/auth';
import { getSupabaseAdmin, sendTelegramDirectMessage } from '../../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Telegram 2FA for the admin panel. The admin token (Authorization header) is
// always required first; the OTP is a second factor on top. FAIL-SAFE: if the
// Telegram bot or CEO chat is not configured, or the send fails, the route
// answers required=false so an integration outage can never lock the CEO out.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { action?: string; code?: string };
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const ceoChat = process.env.TELEGRAM_CHAT_ID?.trim();
  const telegramReady = Boolean(botToken && ceoChat);

  if (body.action === 'request') {
    if (!telegramReady) return NextResponse.json({ ok: true, required: false, reason: 'telegram-not-configured' });
    const code = generateOtp();
    await supabase.from('admin_otp_codes').update({ used_at: new Date().toISOString() }).is('used_at', null);
    const { error } = await supabase.from('admin_otp_codes').insert({ code_hash: hashOtp(code), expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString() });
    if (error) return NextResponse.json({ ok: true, required: false, reason: 'otp-store-unavailable' });
    const sent = await sendTelegramDirectMessage(ceoChat as string, `MJIC Admin login code: ${code}\nValid 10 minutes. If this was not you, change the admin password.`);
    if (!sent) return NextResponse.json({ ok: true, required: false, reason: 'telegram-unreachable' });
    return NextResponse.json({ ok: true, required: true });
  }

  if (body.action === 'verify') {
    if (!telegramReady) return NextResponse.json({ ok: true, required: false, reason: 'telegram-not-configured' });
    const { data, error } = await supabase
      .from('admin_otp_codes')
      .select('id, code_hash, expires_at, used_at, attempts')
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: 'No pending code. Sign in again.' }, { status: 401 });
    const row = data as OtpRow;
    const usable = otpUsable(row);
    if (!usable.ok) return NextResponse.json({ error: `Code ${usable.reason}. Sign in again.` }, { status: 401 });
    if (!otpMatches(String(body.code || ''), row.code_hash)) {
      await supabase.from('admin_otp_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);
      return NextResponse.json({ error: 'Wrong code.' }, { status: 401 });
    }
    await supabase.from('admin_otp_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
