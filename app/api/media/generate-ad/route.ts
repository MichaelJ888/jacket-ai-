import { NextResponse } from 'next/server';
import { experimental_getVideoStatus, experimental_startVideo } from 'ai';
import {
  completeMediaAdGeneration,
  createMediaAdApproval,
  createMediaAdGeneration,
  escapeTelegramHtml,
  failMediaAdGeneration,
  getMediaAdGeneration,
  getMediaAdVideoUrl,
  markMediaAdApprovalNotificationFailed,
  setMediaAdGenerationApproval,
  sendTelegramMessage,
  storeMediaAdVideo,
} from '../../_lib/integrations';

const VIDEO_MODEL = 'google/veo-3.1-fast-generate-001';
const VIDEO_DURATION_SECONDS = 8;

function toText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function normalizeStyles(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildCreativePrompt(input: {
  clientName: string;
  jacketStyle: string;
  logoUrl?: string;
  colorway?: string;
  audience?: string;
  callToAction?: string;
  jacketStyles?: string[];
}) {
  const styles = input.jacketStyles?.length ? input.jacketStyles.join(', ') : input.jacketStyle || 'corporate jackets, bomber jackets, varsity jackets, windbreakers, and hoodies';
  const base = [
    'Create a cinematic social media ad for MJIC custom jackets and apparel.',
    `Feature multiple premium jacket styles in one campaign: ${styles}.`,
    `Brand/client: ${input.clientName || 'MJIC client'}.`,
    `Colorway: ${input.colorway || 'navy, charcoal, maroon, black, and executive neutral tones'}.`,
    `Audience: ${input.audience || 'corporate teams, schools, uniforms, and brand-focused customers'}.`,
    `Call to action: ${input.callToAction || 'Request a custom proposal today'}.`,
  ].join(' ');

  const socialVideoScene = [
    'Show attractive models wearing each jacket style in a lifestyle shoot with confident poses, natural movement, and premium fashion styling.',
    'Include realistic AI-enhanced visuals that look authentic and polished, not cartoonish.',
    'Show the production area in a realistic factory environment: fabric cutting tables, garment pattern design on computer screens, embroidery station, screen printing station, and seamstresses sewing different jackets and items.',
    'Blend the high-end fashion shots with behind-the-scenes manufacturing footage in a smooth cinematic transition.',
    'Keep the lighting premium and commercial, with shallow depth of field, soft cinematic motion, subtle smoke or studio haze, and highly polished branding.',
    'Use realistic product close-ups on fabrics, stitching details, logo embroidery, zippers, labels, and finishing touches.',
    'Make the visuals feel luxury, trustworthy, and manufacturing-ready for serious business clients.',
  ].join(' ');

  if (input.logoUrl) {
    return `${base} ${socialVideoScene} Add the client logo as a crisp embroidered logo or chest branding mark. Keep the logos clean, high-contrast, and professionally placed on each jacket.`;
  }

  return `${base} ${socialVideoScene} Keep it brand-safe and polished with a premium corporate feel.`;
}

function buildVoiceoverScript(input: {
  clientName: string;
  jacketStyle: string;
  audience?: string;
  callToAction?: string;
  jacketStyles?: string[];
}) {
  const styles = input.jacketStyles?.length ? input.jacketStyles.join(', ') : input.jacketStyle || 'custom jackets and uniforms';
  return [
    'Hi everyone, this is MJIC, your trusted custom apparel and jacket manufacturer.',
    `For businesses, schools, and growing brands who want premium ${styles}, we create garments that look sharp, feel durable, and represent your identity with confidence.`,
    'From design and fabric cutting to embroidery, printing, and final stitching, every step is handled by our experienced team with quality and precision in mind.',
    'Our process blends real craftsmanship with modern digital design, giving clients a reliable production flow from concept to finished product.',
    'Whether you need corporate uniforms, team jackets, promotional apparel, or custom garments for your brand, we build solutions that are stylish, practical, and built to last.',
    `Trust MJIC for your next ${input.audience || 'corporate apparel and custom garment'} project. ${input.callToAction || 'Message us today for a custom proposal and let us help you create your next standout design.'}`,
  ].join(' ');
}

function buildSocialPostingPlan(jacketStyles: string[]) {
  const styles = jacketStyles.length ? jacketStyles : ['Corporate jacket', 'Windbreaker', 'Bomber jacket'];
  return [
    {
      platform: 'Instagram Reels',
      format: '15-30 sec vertical ad',
      caption: `Premium ${styles.slice(0, 2).join(' and ')} styles from MJIC. Custom-built for teams, brands, and corporate identity. DM us for a custom proposal.`,
      hashtags: ['#MJIC', '#CustomJackets', '#CorporateWear', '#MadeInPH'],
    },
    {
      platform: 'Facebook Ads',
      format: 'Story + feed cutdown',
      caption: `Trusted custom garment partner for ${styles.join(', ')}. Quality production, logo branding, and dependable delivery for your next order.`,
      hashtags: ['#MJIC', '#UniformSupplier', '#CorporateFashion', '#CustomApparel'],
    },
    {
      platform: 'TikTok',
      format: '15 sec fast reel',
      caption: `Behind-the-scenes production of ${styles[0]} and other custom apparel. Professional design, embroidery, cutting, and sewing in one place.`,
      hashtags: ['#FactoryStyle', '#CustomGarments', '#BrandWear', '#MJIC'],
    },
  ];
}

export async function POST(req: Request) {
  try {
    if (!process.env.AI_GATEWAY_API_KEY) {
      return NextResponse.json({ success: false, error: 'AI Gateway is not configured.' }, { status: 503 });
    }

    const body = await req.json();
    const mode = toText(body.mode, 'render');
    const clientName = toText(body.clientName, 'MJIC client');
    const campaignName = toText(body.campaignName || body.productName || body.clientName, 'Sublimation Sports Uniforms');
    const jacketStyle = toText(body.jacketStyle, 'Corporate jacket');
    const jacketStyles = normalizeStyles(body.jacketStyles || body.jacketStyle);
    const logoUrl = toText(body.logoUrl, '');
    const colorway = toText(body.colorway, 'navy and charcoal premium finish');
    const audience = toText(body.audience, 'corporate team and executive clients');
    const callToAction = toText(body.callToAction, 'Request a custom proposal today');
    const durationSeconds = Number(body.durationSeconds || 15);
    const includeVoiceover = Boolean(body.includeVoiceover);

    const prompt = buildCreativePrompt({ clientName, jacketStyle, logoUrl, colorway, audience, callToAction, jacketStyles });
    const videoJob = await experimental_startVideo({
      model: VIDEO_MODEL,
      prompt,
      duration: VIDEO_DURATION_SECONDS,
      aspectRatio: '9:16',
      generateAudio: false,
    });

    const generation = await createMediaAdGeneration({
      campaignName,
      modelId: VIDEO_MODEL,
      operation: videoJob.operation,
    });
    if (!generation.data) {
      return NextResponse.json({ success: false, error: generation.error || 'Unable to save video generation job.' }, { status: 503 });
    }

    const activeStyles = jacketStyles.length ? jacketStyles : [jacketStyle];
    const voiceoverScript = buildVoiceoverScript({ clientName, jacketStyle, audience, callToAction, jacketStyles: activeStyles });
    const socialPostingPlan = buildSocialPostingPlan(activeStyles);

    const payload = {
      success: true,
      mode,
      status: 'generating',
      generationId: generation.data.id,
      modelId: VIDEO_MODEL,
      clientName,
      jacketStyle,
      jacketStyles: activeStyles,
      logoUrl: logoUrl || null,
      colorway,
      audience,
      callToAction,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 15,
      includeVoiceover,
      prompt,
      renderUrl: null,
      videoDurationSeconds: VIDEO_DURATION_SECONDS,
      storyboard: [
        {
          id: 'opening',
          seconds: 0,
          label: 'Luxury product intro',
          caption: `Opening shot: attractive models wearing premium ${activeStyles.slice(0, 2).join(' and ').toLowerCase()} styles in a high-end lifestyle setup.`,
        },
        {
          id: 'production',
          seconds: 4,
          label: 'Realistic factory flow',
          caption: 'Cutting table action, computer design work, embroidery station, printing station, and seamstresses assembling different jackets and items.',
        },
        {
          id: 'details',
          seconds: 9,
          label: 'Finishing & quality',
          caption: 'Close-up of logos, stitching, fabric quality, zipper details, and final finishing touches.',
        },
        {
          id: 'cta',
          seconds: 12,
          label: 'Trust and conversion',
          caption: 'End with premium branding and a direct customer conversion CTA for custom garment orders.',
        },
      ],
      voiceoverScript,
      socialPostingPlan,
      voiceoverTone: 'confident, polished, sales-focused, and trust-building',
      platformTargets: ['Facebook', 'Instagram Reels', 'TikTok', 'Meta ads'],
      generatedAt: new Date().toISOString(),
      notes: 'Video generation is running in Vercel AI Gateway. Poll this route with the generationId to retrieve the finished cloud-stored video.',
    };

    return NextResponse.json({
      ...payload,
      approvalId: null,
      approvalLogSaved: false,
      approvalNotificationSent: false,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Media generation failed' },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const generationId = new URL(request.url).searchParams.get('generationId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(generationId)) {
    return NextResponse.json({ success: false, error: 'A valid generationId is required.' }, { status: 400 });
  }

  try {
    const stored = await getMediaAdGeneration(generationId);
    if (stored.error) return NextResponse.json({ success: false, error: stored.error }, { status: 503 });
    if (!stored.data) return NextResponse.json({ success: false, error: 'Video generation job not found.' }, { status: 404 });

    if (stored.data.status === 'FAILED') {
      return NextResponse.json({ success: false, status: 'failed', error: stored.data.error_message }, { status: 502 });
    }

    if (stored.data.status === 'COMPLETED' && stored.data.video_storage_path) {
      const video = await getMediaAdVideoUrl(stored.data.video_storage_path);
      if (video.error || !video.url) return NextResponse.json({ success: false, error: video.error || 'Video URL unavailable.' }, { status: 503 });
      return NextResponse.json({
        success: true,
        status: 'ready',
        generationId,
        videoUrl: video.url,
        renderUrl: video.url,
        approvalId: stored.data.approval_id,
      });
    }

    const operation = stored.data.operation as Parameters<typeof experimental_getVideoStatus>[1]['operation'];
    const status = await experimental_getVideoStatus(stored.data.model_id, { operation });
    if (status.status === 'pending') {
      return NextResponse.json({ success: true, status: 'generating', generationId });
    }
    if (status.status === 'error') {
      await failMediaAdGeneration(generationId, status.error);
      return NextResponse.json({ success: false, status: 'failed', error: status.error }, { status: 502 });
    }

    const generatedVideo = status.videos[0] as unknown as {
      url?: string;
      data?: Uint8Array | string;
      base64?: string;
      uint8Array?: Uint8Array;
    };
    let videoBytes: Uint8Array;
    if (typeof generatedVideo.url === 'string') {
      const response = await fetch(generatedVideo.url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('AI Gateway video download failed.');
      videoBytes = new Uint8Array(await response.arrayBuffer());
    } else if (generatedVideo.data instanceof Uint8Array) {
      videoBytes = generatedVideo.data;
    } else if (typeof generatedVideo.base64 === 'string') {
      videoBytes = Buffer.from(generatedVideo.base64, 'base64');
    } else if (typeof generatedVideo.data === 'string') {
      videoBytes = Buffer.from(generatedVideo.data, 'base64');
    } else if (generatedVideo.uint8Array instanceof Uint8Array) {
      videoBytes = generatedVideo.uint8Array;
    } else {
      throw new Error('AI Gateway returned an unsupported video format.');
    }

    if (videoBytes.byteLength > 100 * 1024 * 1024) throw new Error('Generated video exceeds the 100 MB storage limit.');
    const saved = await storeMediaAdVideo(generationId, videoBytes);
    if (saved.error || !saved.path) throw new Error(saved.error || 'Unable to store generated video.');

    const completed = await completeMediaAdGeneration(generationId, saved.path);
    if (completed.error) throw new Error(completed.error);
    if (completed.data) {
      const approval = await createMediaAdApproval(completed.data.campaign_name);
      if (approval.error) console.error('Media ad approval log insert failed:', approval.error);
      if (approval.data) {
        await setMediaAdGenerationApproval(generationId, approval.data.id);
        const video = await getMediaAdVideoUrl(saved.path);
        const notificationSent = video.url ? await sendTelegramMessage(
          `Boss,\nready na ang AI-generated video ad para sa ${escapeTelegramHtml(completed.data.campaign_name)}. Review it here before boosting: ${escapeTelegramHtml(video.url)}`,
          { inline_keyboard: [[
            { text: 'YES', callback_data: `boost_ad:yes:${approval.data.id}` },
            { text: 'NO', callback_data: `boost_ad:no:${approval.data.id}` },
          ]] },
        ) : false;
        if (!notificationSent) await markMediaAdApprovalNotificationFailed(approval.data.id);
      }
    }

    const finalRecord = await getMediaAdGeneration(generationId);
    const video = finalRecord.data?.video_storage_path ? await getMediaAdVideoUrl(finalRecord.data.video_storage_path) : { url: null, error: null };
    if (video.error || !video.url) return NextResponse.json({ success: false, error: video.error || 'Video URL unavailable.' }, { status: 503 });
    return NextResponse.json({
      success: true,
      status: 'ready',
      generationId,
      videoUrl: video.url,
      renderUrl: video.url,
      approvalId: finalRecord.data?.approval_id || null,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Video status check failed.' },
      { status: 502 },
    );
  }
}
