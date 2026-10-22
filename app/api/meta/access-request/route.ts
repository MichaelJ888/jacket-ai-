import { NextResponse } from 'next/server';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { rolesLink } from '../../_lib/meta-setup';
import { rateLimitResponse } from '../../_lib/rate-limit';

export const dynamic = 'force-dynamic';

// Public: "I can't log in yet" (Meta app still in Development Mode). Saves the request and pings the CEO with a one-tap Tester link.
export async function POST(request: Request) {
  const limited = await rateLimitResponse(request, 'meta-access-request', 5, 3600);
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { name?: string; contact?: string; note?: string };
  const name = String(body.name || '').trim().slice(0, 120);
  const contact = String(body.contact || '').trim().slice(0, 200);
  const note = String(body.note || '').trim().slice(0, 500) || null;
  if (!name || !contact) return NextResponse.json({ error: 'Please enter your name and your Facebook email or profile link.' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Temporarily unavailable' }, { status: 503 });
  const { error } = await supabase.from('access_requests').insert({ name, contact, note });
  if (error) return NextResponse.json({ error: 'Could not save your request. Please try again.' }, { status: 500 });

  await sendTelegramMessage(`🆕 <b>Facebook connect access request</b>\n${escapeTelegramHtml(name)}\n${escapeTelegramHtml(contact)}${note ? `\n${escapeTelegramHtml(note)}` : ''}\nAdd as Tester: ${rolesLink(process.env.META_APP_ID)}`).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
