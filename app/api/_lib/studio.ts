import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { publishApprovedStudioImage } from './content';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage, sendTelegramPhoto, type TelegramInlineKeyboard } from './integrations';
import { REPLICATE_BILLING_MESSAGE, ReplicateBillingError, createReplicatePrediction, downloadImage, isReplicateBillingFailure, replicateOutputUrl, type ReplicatePrediction } from './replicate';
import {
  STUDIO_OUTPUT_BUCKET,
  buildEnhanceInput,
  buildFaceSwapInput,
  logoPlacementLeftChest,
  studioJobPath,
} from './studio-logic';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
export type StudioStage = 'swap' | 'enhance';
export type StudioDecision = 'approve' | 'reject';

export const STUDIO_JOB_COLUMNS = 'id, source_url, face_url, logo_url, output_url, status, error, enhance_scale, created_at, updated_at, decided_at';

export type StudioJob = {
  id: string;
  source_url: string;
  face_url: string | null;
  logo_url: string | null;
  enhance_scale: number;
  status: string;
  stage_prediction_id: string | null;
  webhook_token: string;
  swap_url: string | null;
  output_url: string | null;
  error: string | null;
};

export async function createStudioJob(supabase: Supabase, input: { sourceUrl: string; faceUrl: string | null; logoUrl: string | null; enhanceScale: number }) {
  const { data, error } = await supabase
    .from('studio_jobs')
    .insert({
      source_url: input.sourceUrl,
      face_url: input.faceUrl,
      logo_url: input.logoUrl,
      enhance_scale: input.enhanceScale,
      status: 'queued',
      webhook_token: randomUUID(),
    })
    .select()
    .single();
  if (error || !data) throw new Error('Could not create studio job');
  return data as StudioJob;
}

// Starts the next Replicate stage for a job. The prediction reports back to the webhook when it completes.
export async function startStage(supabase: Supabase, job: StudioJob, stage: StudioStage, origin: string) {
  const webhookUrl = new URL('/api/admin/studio/webhook', origin);
  webhookUrl.searchParams.set('job', job.id);
  webhookUrl.searchParams.set('token', job.webhook_token);
  webhookUrl.searchParams.set('stage', stage);

  const prediction = stage === 'swap'
    ? await createReplicatePrediction('codeplugtech/face-swap', buildFaceSwapInput(job.source_url, job.face_url ?? ''), webhookUrl.toString())
    : await createReplicatePrediction('nightmareai/real-esrgan', buildEnhanceInput(job.swap_url ?? job.source_url, job.enhance_scale), webhookUrl.toString());

  await supabase
    .from('studio_jobs')
    .update({ status: stage === 'swap' ? 'swapping' : 'enhancing', stage_prediction_id: prediction.id, updated_at: new Date().toISOString() })
    .eq('id', job.id);
  return prediction;
}

// Handles a completed Replicate prediction. Idempotent: stale or duplicate callbacks are ignored.
export async function handleStageCompleted(supabase: Supabase, job: StudioJob, stage: StudioStage, prediction: ReplicatePrediction, origin: string) {
  if (job.stage_prediction_id !== prediction.id) return { ignored: true };
  if (prediction.status !== 'succeeded') {
    await failStage(supabase, job.id, new Error(`${stage} ${prediction.status}: ${prediction.error ?? 'no detail'}`), `${stage} ${prediction.status}`, prediction.error);
    return { failed: true };
  }

  const outputUrl = replicateOutputUrl(prediction);
  if (stage === 'swap') {
    await supabase.from('studio_jobs').update({ swap_url: outputUrl, stage_prediction_id: null }).eq('id', job.id);
    const next = { ...job, swap_url: outputUrl };
    try {
      await startStage(supabase, next, 'enhance', origin);
    } catch (error) {
      await failStage(supabase, job.id, error, 'Could not start enhance stage');
      return { failed: true };
    }
    return { advanced: 'enhance' };
  }

  await finalizeJob(supabase, { ...job, output_url: outputUrl }, outputUrl);
  return { finalized: true };
}

async function finalizeJob(supabase: Supabase, job: StudioJob, enhancedUrl: string) {
  try {
    const enhanced = await downloadImage(enhancedUrl);
    let composed: Buffer;
    if (job.logo_url) {
      const logo = await downloadImage(job.logo_url);
      const base = await sharp(enhanced).metadata();
      const logoMeta = await sharp(logo).metadata();
      const place = logoPlacementLeftChest(base.width ?? 1, base.height ?? 1, logoMeta.width ?? 1, logoMeta.height ?? 1);
      const logoPng = await sharp(logo).resize({ width: place.width }).png().toBuffer();
      composed = await sharp(enhanced).composite([{ input: logoPng, left: place.left, top: place.top }]).jpeg({ quality: 92 }).toBuffer();
    } else {
      composed = await sharp(enhanced).jpeg({ quality: 92 }).toBuffer();
    }

    await supabase.storage.createBucket(STUDIO_OUTPUT_BUCKET, { public: true });
    const path = studioJobPath('outputs', 'jpg', job.id);
    const { error } = await supabase.storage.from(STUDIO_OUTPUT_BUCKET).upload(path, composed, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    const outputUrl = supabase.storage.from(STUDIO_OUTPUT_BUCKET).getPublicUrl(path).data.publicUrl;

    await supabase
      .from('studio_jobs')
      .update({ status: 'pending_approval', output_url: outputUrl, stage_prediction_id: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [[
        { text: '✅ Approve & post', callback_data: `studio:approve:${job.id}` },
        { text: '❌ Reject', callback_data: `studio:reject:${job.id}` },
      ]],
    };
    await sendTelegramPhoto(
      outputUrl,
      `Boss, handa na ang studio image (job <code>${escapeTelegramHtml(job.id.slice(0, 8))}</code>). I-tap ang <b>Approve</b> para i-post agad sa Facebook at Instagram, o <b>Reject</b> para i-discard.`,
      keyboard,
    );
  } catch (error) {
    await failJob(supabase, job.id, error instanceof Error ? error.message : 'Finalize failed');
  }
}

export async function failJob(supabase: Supabase, id: string, message: string) {
  await supabase.from('studio_jobs').update({ status: 'failed', error: message.slice(0, 500), stage_prediction_id: null, updated_at: new Date().toISOString() }).eq('id', id);
}

// Records a stage failure. Out-of-credit Replicate errors get a plain top-up message and a Telegram nudge,
// so the admin sees an actionable note instead of a raw API error. Returns true when the failure was billing.
export async function failStage(supabase: Supabase, id: string, error: unknown, fallback: string, providerDetail?: string | null): Promise<boolean> {
  const billing = error instanceof ReplicateBillingError || isReplicateBillingFailure(null, providerDetail);
  if (billing) {
    await failJob(supabase, id, REPLICATE_BILLING_MESSAGE);
    await sendTelegramMessage(`<b>Replicate kulang ang credit</b>. Mag-top up muna sa replicate.com/account/billing, saka i-retry ang studio job <code>${escapeTelegramHtml(id.slice(0, 8))}</code>.`);
    return true;
  }
  await failJob(supabase, id, error instanceof Error ? error.message : fallback);
  return false;
}

// Moves a job out of pending_approval. The conditional update means a double tap, or a Telegram + web race, decides only once.
export async function decideStudioJob(supabase: Supabase, id: string, decision: StudioDecision) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('studio_jobs')
    .update({ status: decision === 'approve' ? 'approved' : 'rejected', decided_at: now, updated_at: now })
    .eq('id', id)
    .eq('status', 'pending_approval')
    .select(STUDIO_JOB_COLUMNS)
    .maybeSingle();
  return { data, error: error?.message ?? null };
}

// Publishes an approved job to Facebook + Instagram. Outcome is recorded on the job and reported to the CEO.
// Missing Meta credentials leave the job 'approved' with a note, and the posts are parked (NEEDS_CREDENTIALS) for a later retry.
export async function postApprovedStudioJob(supabase: Supabase, id: string) {
  const { data: job } = await supabase.from('studio_jobs').select('id, output_url, status').eq('id', id).maybeSingle();
  if (!job?.output_url || job.status !== 'approved') return;
  const now = () => new Date().toISOString();
  try {
    const summary = await publishApprovedStudioImage(job.output_url);
    const waiting = summary.needsCredentials.length > 0;
    const note = waiting ? `Waiting for Meta credentials: ${summary.needsCredentials.join(', ')}` : null;
    await supabase
      .from('studio_jobs')
      .update({ status: summary.published > 0 ? 'posted' : 'approved', error: note ?? (summary.published > 0 ? null : 'No platform accepted the post'), updated_at: now() })
      .eq('id', id);
    await sendTelegramMessage(
      summary.published > 0
        ? `<b>Studio post done</b>: ${summary.published} na post ang na-publish${waiting ? `. Naka-pending pa: ${escapeTelegramHtml(summary.needsCredentials.join(', '))}` : ''}.`
        : `<b>Studio post hindi natuloy</b>${note ? `: ${escapeTelegramHtml(note)}` : ''}. Ang job ay nasa /admin/studio.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Posting failed';
    await supabase.from('studio_jobs').update({ error: message.slice(0, 500), updated_at: now() }).eq('id', id);
    await sendTelegramMessage(`<b>Studio post error</b>: ${escapeTelegramHtml(message.slice(0, 300))}`);
  }
}
