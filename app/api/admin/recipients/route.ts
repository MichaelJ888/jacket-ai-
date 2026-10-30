import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { getAnneChatId, isValidTelegramChatId, saveAnneChatId, getSupabaseAdmin } from '../../_lib/integrations';

// GET: current recipient status for Ms. Anne Manalo (admin only).
// POST: save a numeric Telegram chat ID, or clear it with an empty value. The owner group stays the fallback.
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!getSupabaseAdmin()) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const anne = await getAnneChatId();
  return NextResponse.json({
    success: true,
    anne: { chatId: anne.chatId, source: anne.source, envOverride: anne.source === 'env' },
    fallback: process.env.TELEGRAM_CHAT_ID ? 'owner-group' : 'none',
  });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!getSupabaseAdmin()) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const body = await req.json().catch(() => null);
  const raw = typeof body?.anneChatId === 'string' ? body.anneChatId.trim() : '';
  if (raw && !isValidTelegramChatId(raw)) {
    return NextResponse.json({ error: 'Chat ID must be numeric (e.g. 123456789 or -1001234567890).' }, { status: 400 });
  }
  try {
    await saveAnneChatId(raw || null);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Save failed' }, { status: 500 });
  }
  const anne = await getAnneChatId();
  return NextResponse.json({ success: true, anne: { chatId: anne.chatId, source: anne.source, envOverride: anne.source === 'env' } });
}
