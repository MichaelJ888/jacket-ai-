import sharp from 'sharp';
import { publishApprovedStudioImage } from './content';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage, sendTelegramPhoto, type TelegramInlineKeyboard } from './integrations';
import { downloadImage } from './replicate';
import { STUDIO_OUTPUT_BUCKET, type StudioDecision } from './studio-logic';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

const AD_WIDTH = 1080;
const AD_HEIGHT = 1350;
const AD_CTA = 'MOQ 20 pcs  ·  Libreng pre-production sample';
const AD_BRAND = 'Michael Jeffrey International Corp.';

export function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] ?? ch);
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

// Picture ad: the enhanced product photo cover-cropped to 4:5, with a dark bottom band carrying the title, category, policy facts and brand.
export function adOverlaySvg(title: string, category: string) {
  return `<svg width="${AD_WIDTH}" height="${AD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.82"/>
    </linearGradient>
  </defs>
  <rect x="0" y="880" width="${AD_WIDTH}" height="${AD_HEIGHT - 880}" fill="url(#fade)"/>
  <text x="70" y="1090" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700">${escapeXml(clip(title, 34))}</text>
  <text x="70" y="1160" fill="#e5e7eb" font-family="Arial, Helvetica, sans-serif" font-size="38">${escapeXml(clip(category, 48))}</text>
  <text x="70" y="1240" fill="#fbbf24" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700">${escapeXml(AD_CTA)}</text>
  <text x="70" y="1300" fill="#d1d5db" font-family="Arial, Helvetica, sans-serif" font-size="30">${escapeXml(AD_BRAND)}</text>
</svg>`;
}

export async function buildStudioAdImage(sourceImage: Buffer, title: string, category: string) {
  const overlay = Buffer.from(adOverlaySvg(title, category));
  return sharp(sourceImage)
    .resize(AD_WIDTH, AD_HEIGHT, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export function adButtons(jobId: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '✅ Approve & post', callback_data: `studioad:approve:${jobId}` },
      { text: '❌ Reject', callback_data: `studioad:reject:${jobId}` },
    ]],
  };
}

// Builds the ad for one catalog job and sends it to the CEO. Nothing is posted until the CEO taps Approve.
export async function generateStudioAd(supabase: Supabase, jobId: string) {
  const { data: job } = await supabase
    .from('studio_jobs')
    .select('id, output_url, product_title, category, status, ad_status')
    .eq('id', jobId)
    .maybeSingle();
  if (!job?.output_url || !job.product_title || !job.category) return { skipped: true as const };
  if (job.ad_status) return { skipped: true as const };

  try {
    const source = await downloadImage(job.output_url);
    const ad = await buildStudioAdImage(source, job.product_title, job.category);
    await supabase.storage.createBucket(STUDIO_OUTPUT_BUCKET, { public: true });
    const path = `ads/${job.id}.jpg`;
    const { error } = await supabase.storage.from(STUDIO_OUTPUT_BUCKET).upload(path, ad, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Ad upload failed: ${error.message}`);
    const adUrl = supabase.storage.from(STUDIO_OUTPUT_BUCKET).getPublicUrl(path).data.publicUrl;

    await supabase
      .from('studio_jobs')
      .update({ ad_status: 'pending_approval', ad_url: adUrl, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .is('ad_status', null);

    await sendTelegramPhoto(
      adUrl,
      `Boss, ad ready (job <code>${escapeTelegramHtml(job.id.slice(0, 8))}</code>): <b>${escapeTelegramHtml(job.product_title)}</b>. I-tap ang <b>Approve</b> para i-post sa social media, o <b>Reject</b> para i-discard.`,
      adButtons(job.id),
    );
    return { generated: true as const, adUrl };
  } catch (error) {
    await supabase.from('studio_jobs').update({ ad_status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id).is('ad_status', null);
    return { failed: true as const, message: error instanceof Error ? error.message : 'Ad generation failed' };
  }
}

// Daily: up to `limit` catalog items without an ad yet. Failed ones are marked 'failed' so they are not retried every day.
export async function runDailyStudioAds(supabase: Supabase, limit = 3) {
  const { data: candidates } = await supabase
    .from('studio_jobs')
    .select('id')
    .eq('in_catalog', true)
    .in('status', ['approved', 'posted'])
    .is('ad_status', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  const results: Array<Record<string, unknown>> = [];
  for (const row of candidates ?? []) results.push({ id: row.id, ...(await generateStudioAd(supabase, row.id)) });
  return { processed: results.length, results };
}

// Moves an ad out of pending_approval. The conditional update means a double tap decides only once.
export async function decideStudioAd(supabase: Supabase, id: string, decision: StudioDecision) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('studio_jobs')
    .update({ ad_status: decision === 'approve' ? 'approved' : 'rejected', updated_at: now })
    .eq('id', id)
    .eq('ad_status', 'pending_approval')
    .select('id, ad_url')
    .maybeSingle();
  return { data, error: error?.message ?? null };
}

export async function postApprovedStudioAd(supabase: Supabase, id: string) {
  const { data: job } = await supabase.from('studio_jobs').select('id, ad_url, ad_status').eq('id', id).maybeSingle();
  if (!job?.ad_url || job.ad_status !== 'approved') return;
  try {
    const summary = await publishApprovedStudioImage(job.ad_url);
    const waiting = summary.needsCredentials.length > 0;
    await supabase
      .from('studio_jobs')
      .update({ ad_status: summary.published > 0 ? 'posted' : 'approved', updated_at: new Date().toISOString() })
      .eq('id', id);
    await sendTelegramMessage(
      summary.published > 0
        ? `<b>Ad na-post</b>: ${summary.published} platform${waiting ? `. Naka-pending pa: ${escapeTelegramHtml(summary.needsCredentials.join(', '))}` : ''}.`
        : `<b>Ad hindi natuloy</b>. Kailangan ng Meta credentials sa /admin/studio.`,
    );
  } catch (error) {
    await supabase.from('studio_jobs').update({ ad_status: 'approved', updated_at: new Date().toISOString() }).eq('id', id);
    await sendTelegramMessage(`<b>Ad posting error</b>: ${escapeTelegramHtml(error instanceof Error ? error.message : 'unknown error')}`);
  }
}
