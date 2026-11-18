import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin, sendTelegramMessage, escapeTelegramHtml } from '../../_lib/integrations';
import { generateCommercialAd, getNextCategory, type CommercialAdConfig } from '../../_lib/mjic-commercial-engine';
import { selectNextImage, recordImageUsage } from '../../_lib/image-rotation';
import { createReplicatePrediction, replicateOutputUrl } from '../../_lib/replicate';
import { uploadFacebookVideo, fetchVideoBytes } from '../../_lib/meta-video-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for Replicate video generation + Facebook upload

type TestResult = {
  success: boolean;
  mode?: string;
  media?: string;
  timestamp: string;
  category?: string;
  caption?: string;
  hashtags?: string[];
  antibanOk?: boolean;
  videoUrl?: string;
  facebookPostId?: string;
  fbError?: string;
  live?: boolean;
  errors?: string[];
};

export async function GET(request: Request) {
  // Check authorization: either standard cron auth or ?key= query param
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key');
  const live = url.searchParams.get('live') === '1';
  const mediaType = url.searchParams.get('media') || 'picture';
  
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
    live,
    mode: live ? 'live' : 'test',
    media: mediaType,
  };

  try {
    // Step 1: Rotate to next MJIC category using getNextCategory()
    const category = getNextCategory();
    result.category = category;

    // Step 2: Generate a commercial ad (category-matched caption)
    const config: CommercialAdConfig = {
      category,
      slotKind: mediaType === 'video' ? 'video' : 'picture',
    };
    const adContent = await generateCommercialAd(config);
    result.caption = adContent.caption;

    // Step 3: Select a category-matched image (dynamic rotation)
    const imageAsset = await selectNextImage(category);
    if (imageAsset) {
      result.caption = `🎯 [${imageAsset.filename}]\n${result.caption}`;
      recordImageUsage(category, imageAsset.filename);
    }

    // Step 4: Generate SEO hashtags
    const hashtags = adContent.hashtags;
    result.hashtags = hashtags;

    // Step 5: Validate against Meta constraints
    const metaValid = result.caption.length <= 2048 && hashtags.length >= 1 && hashtags.length <= 30;
    result.antibanOk = metaValid;

    // Step 6: Check post count against 4-per-24h cap (dry-run)
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

    // Step 7: If live=1 and media=video, generate video via Replicate and post to Facebook
    if (live && mediaType === 'video') {
      const replicateToken = process.env.REPLICATE_API_TOKEN;
      const fbPageId = '358075757386300'; // MJIC Facebook Page ID
      
      // Resolve Facebook token: check META_PAGE_TOKENS map first, then fallback
      let fbPageToken: string | undefined;
      try {
        const { getPageToken } = await import('../../_lib/meta-pages');
        fbPageToken = await getPageToken(fbPageId);
      } catch {
        // Fallback to direct env lookup
        fbPageToken = process.env.META_PAGE_ACCESS_TOKEN;
      }

      if (!replicateToken) {
        throw new Error('REPLICATE_API_TOKEN not configured');
      }
      if (!fbPageToken) {
        throw new Error(`META Page ${fbPageId} token not configured (check META_PAGE_TOKENS, META_SYSTEM_USER_TOKEN, or META_PAGE_ACCESS_TOKEN)`);
      }

      // Generate video via Replicate (use a simple commercial model)
      // Using text-to-video model: ideogram/ideogram-ai (or similar)
      const model = 'ideogram-ai/ideogram-ai-short-form-video'; // Example model
      const videoPrompt = result.caption.split('\n')[0] || 'MJIC uniform commercial';

      console.log(`[TESTPOST] Starting Replicate video generation for: "${videoPrompt}"`);

      // Create prediction (async webhook-based)
      const prediction = await createReplicatePrediction(
        model,
        { prompt: videoPrompt, duration_seconds: 30 },
        `${process.env.VERCEL_URL || 'https://jacket-ai.vercel.app'}/api/webhooks/replicate`
      );

      // Poll for completion (up to 60 seconds) with strict sequential awaits
      let completed = false;
      let videoOutputUrl: string | null = null;
      let lastStatus = '';
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));

        const checkResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { Authorization: `Bearer ${replicateToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        const checkData = (await checkResponse.json()) as { status?: string; output?: string | string[] };

        lastStatus = checkData.status || 'unknown';
        console.log(`[TESTPOST] Replicate status: ${lastStatus} (attempt ${attempt + 1}/15)`);

        if (checkData.status === 'succeeded') {
          videoOutputUrl = replicateOutputUrl(checkData as typeof prediction);
          completed = true;
          console.log(`[TESTPOST] Video generation succeeded`);
          break;
        } else if (checkData.status === 'failed') {
          throw new Error(`Replicate video generation failed: ${JSON.stringify(checkData)}`);
        }
      }

      if (!completed || !videoOutputUrl) {
        throw new Error(`Replicate video generation timed out (last status: ${lastStatus}) or produced no output`);
      }

      result.videoUrl = videoOutputUrl;
      console.log(`[TESTPOST] Video generated: ${videoOutputUrl}`);

      // Upload to Facebook using Graph API directly
      console.log(`[TESTPOST] Uploading to Facebook Page ${fbPageId}`);
      try {
        const fbCaption = result.caption + '\n' + result.hashtags?.join(' ');
        const videoBytes = await fetchVideoBytes(videoOutputUrl);
        console.log(`[TESTPOST] Downloaded video bytes: ${videoBytes.byteLength} bytes`);
        
        const fbResult = await uploadFacebookVideo({
          pageId: fbPageId,
          token: fbPageToken,
          bytes: videoBytes,
          description: fbCaption,
        });

        if (!fbResult.ok) {
          result.fbError = fbResult.reason || 'Facebook upload returned not-ok';
          throw new Error(result.fbError);
        }

        if (!fbResult.data || (!fbResult.data.id && !fbResult.data.post_id)) {
          result.fbError = 'Facebook upload did not return a video ID';
          throw new Error(result.fbError);
        }

        const postId = String(fbResult.data.post_id || fbResult.data.id);
        result.facebookPostId = postId;
        console.log(`[TESTPOST] Posted to Facebook: ${postId}`);
      } catch (fbError) {
        const fbErrorMsg = fbError instanceof Error ? fbError.message : String(fbError);
        result.fbError = fbErrorMsg;
        throw new Error(`Facebook upload failed: ${fbErrorMsg}`);
      }
    }

    result.success = true;

    // Step 8: Notify Telegram of test completion
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      let summary = `✅ <b>TEST-AD-PIPELINE</b>\n` +
        `📦 Category: ${escapeTelegramHtml(result.category || 'unknown')}\n` +
        `📝 Caption: ${result.caption?.length || 0} chars\n` +
        `🏷️ Hashtags: ${result.hashtags?.length || 0}\n` +
        `✅ Meta OK: ${result.antibanOk ? 'Yes' : 'No'}`;
      
      if (result.videoUrl) {
        summary += `\n🎬 Video: ${escapeTelegramHtml(result.videoUrl)}`;
      }
      if (result.facebookPostId) {
        summary += `\n📱 FB Post ID: ${escapeTelegramHtml(result.facebookPostId)}`;
      }
      
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

    return NextResponse.json(result, { status: live ? 503 : 200 });
  }
}

