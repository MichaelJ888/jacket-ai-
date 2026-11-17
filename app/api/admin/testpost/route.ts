import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin, sendTelegramMessage, escapeTelegramHtml } from '../../_lib/integrations';
import { generateCommercialAd, getNextCategory, type CommercialAdConfig } from '../../_lib/mjic-commercial-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

type TestResult = {
  success: boolean;
  timestamp: string;
  category?: string;
  caption?: string;
  hashtags?: string[];
  antibanOk?: boolean;
  errors?: string[];
};

export async function GET(request: Request) {
  // Check authorization: either standard cron auth or ?key= query param
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key');
  const isQueryAuthorized = queryKey && (
    queryKey === process.env.CRON_SECRET ||
    queryKey === process.env.ADMIN_TOKEN
  );

  if (!isCronAuthorized(request) && !isQueryAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result: TestResult = {
    success: false,
    timestamp: new Date().toISOString(),
    errors: [],
  };

  try {
    // Step 1: Select a product category
    const category = getNextCategory();
    result.category = category;

    // Step 2: Generate a commercial ad
    const config: CommercialAdConfig = {
      category,
      slotKind: 'picture',
    };
    const adContent = await generateCommercialAd(config);
    result.caption = adContent.caption;

    // Step 3: Generate SEO hashtags (use the ones from the ad engine)
    const hashtags = adContent.hashtags;
    result.hashtags = hashtags;

    // Step 4: Validate against Meta constraints
    const metaValid = result.caption.length <= 2048 && hashtags.length >= 1 && hashtags.length <= 30;
    result.antibanOk = metaValid;

    // Step 5: Check post count against 4-per-24h cap (dry-run)
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
      const { count } = await supabase
        .from('content_calendar')
        .select('id', { count: 'exact', head: true })
        .eq('platform', 'facebook')
        .eq('status', 'published')
        .gte('updated_at', twentyFourHoursAgo);

      if (typeof count === 'number') {
        result.antibanOk = result.antibanOk && count < 4;
      }
    }

    result.success = true;

    // Step 6: Notify Telegram of test completion
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const summary = `✅ <b>TEST-AD-PIPELINE</b>\n` +
        `📦 Category: ${escapeTelegramHtml(result.category || 'unknown')}\n` +
        `📝 Caption: ${result.caption?.length || 0} chars\n` +
        `🏷️ Hashtags: ${result.hashtags?.length || 0}\n` +
        `✅ Meta OK: ${result.antibanOk ? 'Yes' : 'No'}`;
      
      void sendTelegramMessage(summary).catch((e) => console.error('Telegram notify failed:', e));
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    result.errors?.push(message);
    result.success = false;

    console.error('[TEST-AD-PIPELINE] Error:', message);

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      void sendTelegramMessage(
        `❌ <b>TEST-AD-PIPELINE Failed</b>\n${escapeTelegramHtml(message.slice(0, 300))}`
      ).catch((e) => console.error('Telegram notify failed:', e));
    }

    return NextResponse.json(result, { status: 503 });
  }
}

