import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BOOST_BUDGET_PESOS = 350;

type Candidate = {
  platform: string;
  media_type: string;
  caption: string;
  status: string;
  scheduled_at: string;
  post_url: string | null;
};

// Manila day boundaries (UTC+8, no DST), returned as UTC ISO strings.
function manilaDayRange() {
  const manila = new Date(Date.now() + 8 * 3600 * 1000);
  const start = new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate(), -8, 0, 0));
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

// Prefers video (stronger reach), then Facebook (boostable from the Page), then the earliest slot.
function pickBestPost(rows: Candidate[]) {
  const rank = (row: Candidate) => (row.media_type === 'video' ? 0 : 2) + (row.platform === 'facebook' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.scheduled_at.localeCompare(b.scheduled_at))[0];
}

// Sends the CEO the best post of the day with a P350/day boost recommendation. Spending stays manual in Meta Ads Manager.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const { start, end } = manilaDayRange();
  const { data, error } = await supabase
    .from('content_calendar')
    .select('platform, media_type, caption, status, scheduled_at, post_url')
    .in('status', ['READY', 'PUBLISHED'])
    .gte('scheduled_at', start)
    .lt('scheduled_at', end)
    .order('scheduled_at');
  if (error) {
    await recordHeartbeat('boost-advisor', 'error', { error: error.message });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const rows = (data || []) as Candidate[];
  if (!rows.length) {
    await sendTelegramMessage(`<b>BOOST ADVISOR</b>\nWalang naka-schedule na post ngayong araw. Mag-boost muna kapag may post na.`);
    await recordHeartbeat('boost-advisor', 'ok', { candidates: 0 });
    return NextResponse.json({ success: true, candidates: 0 });
  }

  const best = pickBestPost(rows);
  const when = new Date(best.scheduled_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
  const lines = [
    `<b>BOOST ADVISOR (9:30 AM)</b>`,
    `Pinakamagandang post ngayon: <b>${escapeTelegramHtml(best.platform.toUpperCase())}</b> (${escapeTelegramHtml(best.media_type)}, ${escapeTelegramHtml(when)})`,
    escapeTelegramHtml(best.caption.slice(0, 300)),
    best.post_url ? escapeTelegramHtml(best.post_url) : '',
    '',
    `<b>Rekomendasyon:</b> I-boost ng <b>P${BOOST_BUDGET_PESOS}/araw</b> sa Meta Ads Manager.`,
    `Ang gastos ay manual na approval mo; walang awtomatikong gastos.`,
  ].filter(Boolean);

  await sendTelegramMessage(lines.join('\n'));
  await recordHeartbeat('boost-advisor', 'ok', { candidates: rows.length, platform: best.platform });
  return NextResponse.json({ success: true, candidates: rows.length, platform: best.platform });
}
