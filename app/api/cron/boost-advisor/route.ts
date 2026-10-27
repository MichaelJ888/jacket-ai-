import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { getPageToken } from '../../_lib/meta-pages';
import { manilaWeekday, preferredCategory, rankBoostCandidates, type BoostCandidate } from '../boost-advisor-logic.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BOOST_BUDGET_PESOS = 350;
const GRAPH = 'https://graph.facebook.com/v26.0';

type Candidate = {
  id: string;
  platform: string;
  media_type: string;
  caption: string;
  status: string;
  scheduled_at: string;
  published_at: string | null;
  external_post_id: string | null;
  post_url: string | null;
};

function manilaDayRange(now = new Date()) {
  const manila = new Date(now.getTime() + 8 * 3600 * 1000);
  const start = new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate(), -8, 0, 0));
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

function metricValue(body: { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> }, name: string) {
  const value = body.data?.find((metric) => metric.name === name)?.values?.[0]?.value;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function graphGet(path: string, token: string) {
  const response = await fetch(`${GRAPH}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Meta insights returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getEngagement(row: Candidate, token: string) {
  const postId = encodeURIComponent(row.external_post_id || '');
  if (!postId) return { reach: null, shares: null };
  if (row.platform === 'facebook') {
    const [insights, post] = await Promise.all([
      graphGet(`${postId}/insights?metric=post_total_media_view_unique&period=lifetime`, token),
      graphGet(`${postId}?fields=shares`, token),
    ]);
    const insightBody = insights as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> };
    const shareCount = (post as { shares?: { count?: unknown } }).shares?.count;
    const shares = typeof shareCount === 'number' ? shareCount : Number(shareCount);
    return {
      reach: metricValue(insightBody, 'post_total_media_view_unique'),
      shares: Number.isFinite(shares) ? shares : null,
    };
  }

  const insights = await graphGet(`${postId}/insights?metric=reach,shares&period=lifetime`, token);
  const insightBody = insights as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> };
  return {
    reach: metricValue(insightBody, 'reach'),
    shares: metricValue(insightBody, 'shares'),
  };
}

// Recommends a post; advertising spend remains manual until Meta Marketing API credentials and a bounded campaign flow exist.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const now = new Date();
  const { start, end } = manilaDayRange(now);
  const since24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [recent, today] = await Promise.all([
    supabase
      .from('content_calendar')
      .select('id, platform, media_type, caption, status, scheduled_at, published_at, external_post_id, post_url')
      .eq('status', 'PUBLISHED')
      .in('platform', ['facebook', 'instagram'])
      .gte('published_at', since24Hours)
      .not('external_post_id', 'is', null)
      .order('published_at', { ascending: false })
      .limit(12),
    supabase
      .from('content_calendar')
      .select('id, platform, media_type, caption, status, scheduled_at, published_at, external_post_id, post_url')
      .in('status', ['READY', 'PUBLISHED'])
      .gte('scheduled_at', start)
      .lt('scheduled_at', end)
      .order('scheduled_at'),
  ]);
  const error = recent.error || today.error;
  if (error) {
    await recordHeartbeat('boost-advisor', 'error', { error: error.message });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const recentRows = (recent.data || []) as Candidate[];
  const candidates = recentRows.length ? recentRows : (today.data || []) as Candidate[];
  if (!candidates.length) {
    await sendTelegramMessage(`<b>BOOST ADVISOR</b>\nWalang published post sa nakaraang 24 oras o naka-schedule ngayong araw.`);
    await recordHeartbeat('boost-advisor', 'ok', { candidates: 0 });
    return NextResponse.json({ success: true, candidates: 0 });
  }

  const pageToken = await getPageToken(process.env.META_PAGE_ID);
  const withMetrics: BoostCandidate[] = await Promise.all(candidates.map(async (row) => {
    let reach: number | null = null;
    let shares: number | null = null;
    if (recentRows.length && pageToken && row.external_post_id) {
      try {
        const metrics = await getEngagement(row, pageToken);
        reach = metrics.reach;
        shares = metrics.shares;
      } catch (error) {
        console.warn(`Boost advisor could not read Meta insights for ${row.id}:`, error instanceof Error ? error.message : 'unknown error');
      }
    }
    return { ...row, reach, shares };
  }));
  const weekday = manilaWeekday(now);
  const best = rankBoostCandidates(withMetrics, weekday)[0];
  const engagementAvailable = best.reach !== null || best.shares !== null;
  const fallbackTheme = preferredCategory(weekday);
  const when = new Date(best.published_at || best.scheduled_at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
  const metricLabel = best.platform === 'facebook' ? 'total media views' : 'reach';
  const strategy = engagementAvailable
    ? `Batay sa Meta engagement ng post sa nakaraang 24 oras (${metricLabel}: ${best.reach ?? 'n/a'}, shares: ${best.shares ?? 'n/a'}).`
    : `Hindi available ang insights ngayon; weekday focus (${fallbackTheme}) ang ginamit bilang fallback.`;
  const organicCaveat = best.platform === 'facebook'
    ? `Note: Facebook API ay nagbibigay ng total unique media views, hindi organic-only unique reach.`
    : '';
  const lines = [
    `<b>BOOST ADVISOR (9:30 AM)</b>`,
    `Pinakamagandang post: <b>${escapeTelegramHtml(best.platform.toUpperCase())}</b> (${escapeTelegramHtml(best.media_type)}, ${escapeTelegramHtml(when)})`,
    escapeTelegramHtml(best.caption.slice(0, 300)),
    best.post_url ? escapeTelegramHtml(best.post_url) : '',
    escapeTelegramHtml(strategy),
    organicCaveat,
    '',
    `<b>Rekomendasyon:</b> I-boost ng <b>P${BOOST_BUDGET_PESOS}/araw</b> sa Meta Ads Manager.`,
    `Ang boost ay manual pa rin; wala pang configured Meta Ads API one-click campaign. Walang automatic spend.`,
  ].filter(Boolean);

  const sent = await sendTelegramMessage(lines.join('\n'));
  if (!sent) {
    await recordHeartbeat('boost-advisor', 'error', { candidates: candidates.length, error: 'Telegram notification failed' });
    return NextResponse.json({ success: false, error: 'Telegram notification failed' }, { status: 502 });
  }
  await recordHeartbeat('boost-advisor', 'ok', { candidates: candidates.length, platform: best.platform, engagementAvailable, weekday });
  return NextResponse.json({ success: true, candidates: candidates.length, platform: best.platform, engagementAvailable, weekday });
}
