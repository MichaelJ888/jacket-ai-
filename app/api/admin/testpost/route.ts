import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { sendTelegramMessage, escapeTelegramHtml } from '../../_lib/integrations';
import { generateCommercialAd, getNextCategory, type CommercialAdConfig } from '../../_lib/mjic-commercial-engine';
import { selectNextImage, recordImageUsage } from '../../_lib/image-rotation';
import { createReplicatePrediction, replicateOutputUrl } from '../../_lib/replicate';
import { uploadFacebookVideo, fetchVideoBytes } from '../../_lib/meta-video-ads';
import { getPageToken } from '../../_lib/meta-pages';
import { GRAPH } from '../../_lib/meta-graph';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for Replicate video generation + Facebook upload

type TestResult = {
  success: boolean;
  mode: 'live' | 'test';
  media: 'image' | 'video';
  timestamp: string;
  category?: string;
  caption?: string;
  imageUrl?: string;
  videoUrl?: string;
  facebookPostId?: string;
  fbError?: string;
  errors?: string[];
};

export async function GET(request: Request) {
  // Check authorization: either standard cron auth or ?key= query param
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key');
  const mediaParam = url.searchParams.get('media') || 'image';
  const media = mediaParam === 'video' ? 'video' : 'image';
  
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
    mode: 'live',
    media,
  };

  try {
    // Step 1: Rotate to next MJIC category
    const category = getNextCategory();
    result.category = category;

    if (media === 'image') {
      // IMAGE PATH: Select next unique image, generate caption, publish immediately to Facebook
      
      // Step 2: Select next unique image using strict round-robin rotation
      const imageAsset = selectNextImage(category);
      if (!imageAsset) {
        throw new Error(`No images found for category: ${category}`);
      }

      result.imageUrl = imageAsset.url;
      recordImageUsage(category, imageAsset.filename);

      // Step 3: Generate commercial ad caption
      const config: CommercialAdConfig = {
        category,
        slotKind: 'picture',
      };
      const adContent = await generateCommercialAd(config);
      result.caption = adContent.caption;

      // Step 4: Publish to Facebook immediately
      const fbPageId = '358075757386300'; // MJIC Facebook Page ID
      let fbPageToken: string | undefined;
      
      try {
        fbPageToken = await getPageToken(fbPageId);
      } catch {
        fbPageToken = process.env.META_PAGE_ACCESS_TOKEN;
      }

      if (!fbPageToken) {
        throw new Error(`Facebook Page ${fbPageId} token not configured`);
      }

      // Build full caption with hashtags
      const fullCaption = result.caption + '\n' + adContent.hashtags.join(' ');

      // POST image to Facebook using Graph API: POST /{page_id}/photos
      const graphUrl = `${GRAPH}/${fbPageId}/photos`;
      const postPayload = {
        url: `${process.env.VERCEL_URL || 'https://jacket-ai.vercel.app'}${imageAsset.url}`,
        caption: fullCaption,
      };

      const fbResponse = await fetch(graphUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${fbPageToken}`,
        },
        body: new URLSearchParams(postPayload).toString(),
        signal: AbortSignal.timeout(30_000),
      });

      const fbResult = await fbResponse.json() as { id?: string; post_id?: string; error?: { message: string } };

      if (!fbResponse.ok || fbResult.error) {
        result.fbError = fbResult.error?.message || `Facebook returned HTTP ${fbResponse.status}`;
        throw new Error(`Facebook publish failed: ${result.fbError}`);
      }

      result.facebookPostId = String(fbResult.post_id || fbResult.id || '');
      
    } else {
      // VIDEO PATH: Generate video via Replicate and publish to Facebook
      
      const replicateToken = process.env.REPLICATE_API_TOKEN;
      const fbPageId = '358075757386300';
      
      let fbPageToken: string | undefined;
      try {
        fbPageToken = await getPageToken(fbPageId);
      } catch {
        fbPageToken = process.env.META_PAGE_ACCESS_TOKEN;
      }

      if (!replicateToken) {
        throw new Error('REPLICATE_API_TOKEN not configured');
      }
      if (!fbPageToken) {
        throw new Error(`Facebook Page ${fbPageId} token not configured`);
      }

      // Step 2: Generate caption for video
      const config: CommercialAdConfig = {
        category,
        slotKind: 'video',
      };
      const adContent = await generateCommercialAd(config);
      result.caption = adContent.caption;

      // Step 3: Create Replicate video generation prediction
      const model = 'ideogram-ai/ideogram-ai-short-form-video';
      const videoPrompt = result.caption.split('\n')[0] || 'MJIC uniform commercial';

      console.log(`[TESTPOST] Starting Replicate video generation for: "${videoPrompt}"`);

      const prediction = await createReplicatePrediction(
        model,
        { prompt: videoPrompt, duration_seconds: 30 },
        `${process.env.VERCEL_URL || 'https://jacket-ai.vercel.app'}/api/webhooks/replicate`
      );

      // Step 4: Poll for video completion
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
        throw new Error(`Replicate video generation timed out (last status: ${lastStatus})`);
      }

      result.videoUrl = videoOutputUrl;

      // Step 5: Upload to Facebook
      console.log(`[TESTPOST] Uploading to Facebook Page ${fbPageId}`);
      
      const videoBytes = await fetchVideoBytes(videoOutputUrl);
      const fbCaption = result.caption + '\n' + adContent.hashtags.join(' ');
      
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

      result.facebookPostId = String(fbResult.data.post_id || fbResult.data.id);
      console.log(`[TESTPOST] Posted to Facebook: ${result.facebookPostId}`);
    }

    result.success = true;

    // Notify Telegram of test completion
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      let summary = `✅ <b>TESTPOST-${media.toUpperCase()}</b>\n` +
        `📦 Category: ${escapeTelegramHtml(result.category || 'unknown')}\n` +
        `📝 Caption: ${result.caption?.length || 0} chars`;
      
      if (result.imageUrl) {
        summary += `\n🖼️ Image: ${escapeTelegramHtml(result.imageUrl)}`;
      }
      if (result.videoUrl) {
        summary += `\n🎬 Video: ${escapeTelegramHtml(result.videoUrl)}`;
      }
      if (result.facebookPostId) {
        summary += `\n📱 FB Post: ${escapeTelegramHtml(result.facebookPostId)}`;
      }
      
      void sendTelegramMessage(summary).catch((e) => console.error('Telegram notify failed:', e));
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    result.errors?.push(message);
    result.success = false;

    console.error('[TESTPOST] Error:', message);

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      void sendTelegramMessage(
        `❌ <b>TESTPOST-${media.toUpperCase()} Failed</b>\n${escapeTelegramHtml(message.slice(0, 300))}`
      ).catch((e) => console.error('Telegram notify failed:', e));
    }

    return NextResponse.json(result, { status: 503 });
  }
}

