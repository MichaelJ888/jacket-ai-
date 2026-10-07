import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { experimental_startVideo, generateText } from 'ai';

import { graphPost, GRAPH, publicBaseUrl } from './channels';
import {
  createMediaAdGeneration,
  escapeTelegramHtml,
  getMediaAdGeneration,
  getMediaAdVideoUrl,
  getSupabaseAdmin,
  sendTelegramMessage,
} from './integrations';
import { SAMPLE_JACKET_IMAGES } from './mjic-prompt';

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const VIDEO_MODEL = 'google/veo-3.1-fast-generate-001';
type Platform = 'facebook' | 'instagram' | 'youtube' | 'tiktok';

type CalendarRow = {
  id: string;
  platform: Platform;
  media_type: 'video' | 'image' | 'text';
  caption: string;
  hashtags: string[];
  video_prompt: string | null;
  media_generation_id: string | null;
  media_url: string | null;
  scheduled_at: string;
  status: string;
  attempts: number;
};

type IdeaPost = { theme: string; caption: string; hashtags: string[]; video: boolean; videoPrompt: string };

const FALLBACK_IDEAS: IdeaPost[] = [
  { theme: 'quality', caption: 'Executive-quality custom jackets for your whole team. High-density Tajima embroidery, heavy-duty zippers, tailor-fit. Message us for a free quotation!', hashtags: ['#MJIC', '#CustomJackets', '#CorporateWear'], video: false, videoPrompt: '' },
  { theme: 'sample', caption: 'Gusto mong makita muna ang quality? 1-pc sample available, at fully deductible sa final order. Zero risk! Message us today.', hashtags: ['#MJIC', '#UniformSupplier', '#MadeInPH'], video: false, videoPrompt: '' },
  { theme: 'factory', caption: 'Behind the scenes sa MJIC: cutting, embroidery, at precision stitching. 25+ years ng experience sa bawat tahi.', hashtags: ['#MJIC', '#FactoryStyle', '#CustomApparel'], video: true, videoPrompt: 'Cinematic vertical video inside a Philippine garment factory: cutting table, embroidery machine stitching a logo, seamstresses assembling navy corporate jackets, close-up of zipper and stitching, premium lighting, no text overlays.' },
  { theme: 'team', caption: 'Ang suot ng team ninyo ang mukha ng inyong brand. Custom company jackets at uniforms, delivered nationwide. Request a quote!', hashtags: ['#MJIC', '#CompanyUniform', '#BrandWear'], video: false, videoPrompt: '' },
];

// Manila is UTC+8 with no DST.
function manilaSlot(daysFromToday: number, hourManila: number) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday, hourManila - 8, 0, 0));
}

async function generateIdeas(count: number): Promise<IdeaPost[]> {
  if (!process.env.GEMINI_API_KEY) return [];
  try {
    const supabase = getSupabaseAdmin();
    const recent = supabase ? (await supabase.from('content_calendar').select('caption').order('created_at', { ascending: false }).limit(8)).data || [] : [];
    const result = await generateText({
      model: google('gemini-3.6-flash'),
      system: 'You are the social media manager of MJIC, a Philippine direct manufacturer (25+ years) of custom corporate jackets, uniforms and embroidery. Write engaging Taglish posts. NEVER state prices, discounts, or delivery promises. Never mention being an AI. Return ONLY a JSON array.',
      prompt: `Create ${count} distinct post ideas as JSON: [{"theme":"...","caption":"max 280 chars, ends with a call to action to message us","hashtags":["#MJIC", "..."],"video":true|false,"videoPrompt":"only if video: a vivid 8-second vertical cinematic scene description, no text overlays"}]. About 1 in 4 should be video. Avoid repeating these recent captions:\n${recent.map((row) => `- ${row.caption}`).join('\n') || '(none yet)'}`,
      abortSignal: AbortSignal.timeout(40000),
    });
    const text = result.text;
    const parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as IdeaPost[];
    return parsed
      .filter((idea) => typeof idea.caption === 'string' && idea.caption.length > 10)
      .map((idea) => ({ theme: String(idea.theme || ''), caption: idea.caption.slice(0, 600), hashtags: Array.isArray(idea.hashtags) ? idea.hashtags.map(String).slice(0, 8) : [], video: Boolean(idea.video && idea.videoPrompt), videoPrompt: String(idea.videoPrompt || '') }));
  } catch (error) {
    console.error('content idea generation failed:', error);
    return [];
  }
}

// Creates `days` of calendar rows: one idea per day, expanded across platforms.
export async function planContent(days = 7) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { created: 0, error: 'Supabase is not configured' };

  const last = await supabase.from('content_calendar').select('scheduled_at').order('scheduled_at', { ascending: false }).limit(1).maybeSingle();
  const startOffset = last.data ? Math.max(1, Math.ceil((new Date(last.data.scheduled_at).getTime() - Date.now()) / 86400000) + 1) : 1;

  let ideas = await generateIdeas(days);
  if (!ideas.length) ideas = FALLBACK_IDEAS;
  const maxVideosPerWeek = Number(process.env.CONTENT_VIDEOS_PER_WEEK || 2);
  let videosLeft = maxVideosPerWeek;

  const rows: Array<Record<string, unknown>> = [];
  for (let day = 0; day < days; day += 1) {
    const idea = ideas[day % ideas.length];
    const isVideo = idea.video && videosLeft > 0;
    if (isVideo) videosLeft -= 1;
    const imageUrl = `${publicBaseUrl()}${SAMPLE_JACKET_IMAGES[(startOffset + day) % SAMPLE_JACKET_IMAGES.length]}`;
    const videoPrompt = isVideo ? `${idea.videoPrompt} [${manilaSlot(startOffset + day, 0).toISOString().slice(0, 10)}]` : null;

    const targets: Array<{ platform: Platform; hour: number }> = isVideo
      ? [{ platform: 'facebook', hour: 19 }, { platform: 'instagram', hour: 19 }, { platform: 'youtube', hour: 18 }, { platform: 'tiktok', hour: 20 }]
      : [{ platform: 'facebook', hour: 11 }, { platform: 'instagram', hour: 12 }];

    for (const target of targets) {
      rows.push({
        platform: target.platform,
        media_type: isVideo ? 'video' : 'image',
        caption: idea.caption,
        hashtags: idea.hashtags,
        video_prompt: videoPrompt,
        media_url: isVideo ? null : imageUrl,
        scheduled_at: manilaSlot(startOffset + day, target.hour).toISOString(),
        status: isVideo ? 'AWAITING_VIDEO' : 'READY',
      });
    }
  }

  const { error } = await supabase.from('content_calendar').insert(rows);
  return { created: error ? 0 : rows.length, error: error?.message || null };
}

async function startVideos(limit: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !process.env.AI_GATEWAY_API_KEY) return 0;
  const { data } = await supabase.from('content_calendar').select('id, video_prompt, scheduled_at').eq('status', 'AWAITING_VIDEO').is('media_generation_id', null).lte('scheduled_at', new Date(Date.now() + 3 * 86400000).toISOString()).order('scheduled_at');
  const byPrompt = new Map<string, string[]>();
  for (const row of data || []) {
    if (!row.video_prompt) continue;
    byPrompt.set(row.video_prompt, [...(byPrompt.get(row.video_prompt) || []), row.id]);
  }
  let started = 0;
  for (const [prompt, ids] of byPrompt) {
    if (started >= limit) break;
    try {
      const job = await experimental_startVideo({ model: VIDEO_MODEL, prompt, duration: 8, aspectRatio: '9:16', generateAudio: false });
      const generation = await createMediaAdGeneration({ campaignName: `Auto content ${new Date().toISOString().slice(0, 10)}`, modelId: VIDEO_MODEL, operation: job.operation });
      if (generation.data) {
        await supabase.from('content_calendar').update({ media_generation_id: generation.data.id }).in('id', ids);
        started += 1;
      }
    } catch (error) {
      console.error('auto video start failed:', error);
    }
  }
  return started;
}

// Polls the existing generate-ad route, which downloads/stores the video and asks the CEO YES/NO on Telegram.
async function advanceVideos(origin: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { data } = await supabase.from('content_calendar').select('id, media_generation_id, status').in('status', ['AWAITING_VIDEO', 'AWAITING_APPROVAL']).not('media_generation_id', 'is', null);
  const generations = [...new Set((data || []).map((row) => row.media_generation_id as string))];

  for (const generationId of generations) {
    const ids = (data || []).filter((row) => row.media_generation_id === generationId).map((row) => row.id as string);
    const generation = await getMediaAdGeneration(generationId);
    if (generation.error || !generation.data) continue;
    const record = generation.data as { status: string; approval_id: string | null };

    if (record.status !== 'COMPLETED') {
      try {
        const response = await fetch(`${origin}/api/media/generate-ad?generationId=${generationId}`, { signal: AbortSignal.timeout(50000) });
        const body = (await response.json().catch(() => ({}))) as { status?: string };
        if (body.status === 'failed') await supabase.from('content_calendar').update({ status: 'FAILED', error: 'video generation failed' }).in('id', ids);
        else if (body.status === 'ready') await supabase.from('content_calendar').update({ status: 'AWAITING_APPROVAL' }).in('id', ids).eq('status', 'AWAITING_VIDEO');
      } catch (error) {
        console.error('video poll failed:', error);
      }
      continue;
    }

    const refreshed = (await getMediaAdGeneration(generationId)).data as { approval_id: string | null } | null;
    const approvalId = refreshed?.approval_id || record.approval_id;
    if (!approvalId) {
      await supabase.from('content_calendar').update({ status: 'AWAITING_APPROVAL' }).in('id', ids).eq('status', 'AWAITING_VIDEO');
      continue;
    }
    if (process.env.CONTENT_AUTO_APPROVE === '1') {
      await supabase.from('media_ad_approvals').update({ status: 'APPROVED', decided_at: new Date().toISOString() }).eq('id', approvalId).eq('status', 'PENDING_APPROVAL');
    }
    const approval = await supabase.from('media_ad_approvals').select('status').eq('id', approvalId).maybeSingle();
    if (approval.data?.status === 'APPROVED') await supabase.from('content_calendar').update({ status: 'READY' }).in('id', ids);
    else if (approval.data?.status === 'DECLINED') await supabase.from('content_calendar').update({ status: 'SKIPPED', error: 'declined by CEO' }).in('id', ids);
    else await supabase.from('content_calendar').update({ status: 'AWAITING_APPROVAL' }).in('id', ids).eq('status', 'AWAITING_VIDEO');
  }
}

function fullCaption(row: CalendarRow) {
  return `${row.caption}\n\n${(row.hashtags || []).join(' ')}`.trim();
}

class MissingCredentials extends Error {}

async function resolveMedia(row: CalendarRow): Promise<{ url: string | null; storagePath: string | null }> {
  if (row.media_type !== 'video') return { url: row.media_url, storagePath: null };
  if (!row.media_generation_id) return { url: null, storagePath: null };
  const generation = await getMediaAdGeneration(row.media_generation_id);
  const path = (generation.data as { video_storage_path?: string } | null)?.video_storage_path || null;
  if (!path) return { url: null, storagePath: null };
  const signed = await getMediaAdVideoUrl(path);
  return { url: signed.url, storagePath: path };
}

async function publishFacebook(row: CalendarRow, mediaUrl: string | null) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  if (!token || !pageId) throw new MissingCredentials('META_PAGE_ACCESS_TOKEN / META_PAGE_ID');
  const caption = fullCaption(row);
  const result = row.media_type === 'video' && mediaUrl
    ? await graphPost(`/${pageId}/videos`, { file_url: mediaUrl, description: caption }, token)
    : row.media_type === 'image' && mediaUrl
      ? await graphPost(`/${pageId}/photos`, { url: mediaUrl, caption }, token)
      : await graphPost(`/${pageId}/feed`, { message: caption }, token);
  if (!result.ok) throw new Error(result.reason);
  const id = String(result.data.post_id || result.data.id || '');
  return { id, url: id ? `https://www.facebook.com/${id}` : null };
}

async function publishInstagram(row: CalendarRow, mediaUrl: string | null) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igId = process.env.META_IG_USER_ID;
  if (!token || !igId) throw new MissingCredentials('META_PAGE_ACCESS_TOKEN / META_IG_USER_ID');
  if (!mediaUrl) throw new Error('Instagram needs an image or video URL');
  const container = await graphPost(`/${igId}/media`, row.media_type === 'video'
    ? { media_type: 'REELS', video_url: mediaUrl, caption: fullCaption(row) }
    : { image_url: mediaUrl, caption: fullCaption(row) }, token);
  if (!container.ok) throw new Error(container.reason);
  const creationId = String(container.data.id);

  if (row.media_type === 'video') {
    let finished = false;
    for (let attempt = 0; attempt < 12 && !finished; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const status = await fetch(`${GRAPH}/${creationId}?fields=status_code`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }).then((response) => response.json()).catch(() => ({}));
      if (status.status_code === 'FINISHED') finished = true;
      if (status.status_code === 'ERROR') throw new Error('Instagram rejected the video');
    }
    if (!finished) throw new Error('Instagram is still processing the video; will retry');
  }
  const published = await graphPost(`/${igId}/media_publish`, { creation_id: creationId }, token);
  if (!published.ok) throw new Error(published.reason);
  return { id: String(published.data.id), url: null as string | null };
}

async function publishYoutube(row: CalendarRow, storagePath: string | null) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new MissingCredentials('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN');
  if (row.media_type !== 'video' || !storagePath) throw new Error('YouTube needs a video');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15000),
  });
  const accessToken = ((await tokenResponse.json()) as { access_token?: string }).access_token;
  if (!accessToken) throw new Error('YouTube token refresh failed');

  const supabase = getSupabaseAdmin();
  const file = await supabase?.storage.from('media-ad-renders').download(storagePath);
  if (!file?.data) throw new Error('Could not read the video from storage');
  const bytes = new Uint8Array(await file.data.arrayBuffer());

  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify({ snippet: { title: `${row.caption.slice(0, 80)} #Shorts`, description: fullCaption(row), categoryId: '22' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
    signal: AbortSignal.timeout(15000),
  });
  const uploadUrl = init.headers.get('location');
  if (!init.ok || !uploadUrl) throw new Error(`YouTube upload init failed (HTTP ${init.status})`);
  const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes as unknown as BodyInit, signal: AbortSignal.timeout(55000) });
  const body = (await upload.json().catch(() => ({}))) as { id?: string };
  if (!upload.ok || !body.id) throw new Error(`YouTube upload failed (HTTP ${upload.status})`);
  return { id: body.id, url: `https://www.youtube.com/shorts/${body.id}` };
}

async function publishTiktok(row: CalendarRow, mediaUrl: string | null) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) throw new MissingCredentials('TIKTOK_ACCESS_TOKEN (Content Posting API)');
  if (row.media_type !== 'video' || !mediaUrl) throw new Error('TikTok needs a video');
  const response = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: { title: fullCaption(row).slice(0, 2000), privacy_level: process.env.TIKTOK_PRIVACY_LEVEL || 'SELF_ONLY' },
      source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: { publish_id?: string }; error?: { code?: string; message?: string } };
  if (!response.ok || (body.error?.code && body.error.code !== 'ok')) throw new Error(body.error?.message || `TikTok HTTP ${response.status}`);
  return { id: body.data?.publish_id || '', url: null as string | null };
}

export async function runContentPipeline(origin: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured' };

  const videoLimit = Number(process.env.CONTENT_MAX_VIDEOS_PER_RUN || 1);
  const videosStarted = await startVideos(videoLimit);
  await advanceVideos(origin);

  const { data } = await supabase
    .from('content_calendar')
    .select('*')
    .eq('status', 'READY')
    .lte('scheduled_at', new Date().toISOString())
    .lt('attempts', 3)
    .order('scheduled_at')
    .limit(4);

  const summary = { videosStarted, published: 0, failed: 0, needsCredentials: [] as string[] };
  for (const row of (data || []) as CalendarRow[]) {
    try {
      const media = await resolveMedia(row);
      if (row.media_type === 'video' && !media.url) throw new Error('video file not available yet');
      const result = row.platform === 'facebook' ? await publishFacebook(row, media.url)
        : row.platform === 'instagram' ? await publishInstagram(row, media.url)
          : row.platform === 'youtube' ? await publishYoutube(row, media.storagePath)
            : await publishTiktok(row, media.url);
      await supabase.from('content_calendar').update({ status: 'PUBLISHED', external_post_id: result.id, post_url: result.url, published_at: new Date().toISOString(), error: null }).eq('id', row.id);
      summary.published += 1;
      void sendTelegramMessage(`<b>POSTED on ${row.platform.toUpperCase()}</b>\n${escapeTelegramHtml(row.caption.slice(0, 200))}${result.url ? `\n${escapeTelegramHtml(result.url)}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof MissingCredentials) {
        await supabase.from('content_calendar').update({ status: 'NEEDS_CREDENTIALS', error: message }).eq('id', row.id);
        if (!summary.needsCredentials.includes(row.platform)) summary.needsCredentials.push(row.platform);
      } else {
        const attempts = row.attempts + 1;
        await supabase.from('content_calendar').update({ attempts, error: message.slice(0, 500), status: attempts >= 3 ? 'FAILED' : 'READY' }).eq('id', row.id);
        summary.failed += 1;
        if (attempts >= 3) void sendTelegramMessage(`<b>POST FAILED (${row.platform})</b>\n${escapeTelegramHtml(message.slice(0, 300))}`);
      }
    }
  }

  for (const platform of summary.needsCredentials) {
    void sendTelegramMessage(`<b>Auto-posting paused for ${platform.toUpperCase()}</b>\nMissing credentials. Add them in Vercel env and set the queued rows back to READY.`);
  }
  return summary;
}

// Re-queues rows that were parked for missing credentials once the credentials exist.
export async function requeueCredentialBlocked() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const available: Platform[] = [];
  if (process.env.META_PAGE_ACCESS_TOKEN && process.env.META_PAGE_ID) available.push('facebook');
  if (process.env.META_PAGE_ACCESS_TOKEN && process.env.META_IG_USER_ID) available.push('instagram');
  if (process.env.YOUTUBE_REFRESH_TOKEN) available.push('youtube');
  if (process.env.TIKTOK_ACCESS_TOKEN) available.push('tiktok');
  if (!available.length) return 0;
  const { data } = await supabase.from('content_calendar').update({ status: 'READY', error: null }).eq('status', 'NEEDS_CREDENTIALS').in('platform', available).select('id');
  return data?.length || 0;
}
