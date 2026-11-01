import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramPhoto } from './integrations';
import { createReplicatePrediction, downloadImage, replicateOutputUrl, type ReplicatePrediction } from './replicate';
import {
  STUDIO_OUTPUT_BUCKET,
  buildEnhanceInput,
  buildFaceSwapInput,
  logoPlacementLeftChest,
  studioJobPath,
} from './studio-logic';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
export type StudioStage = 'swap' | 'enhance';

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
    await failJob(supabase, job.id, `${stage} ${prediction.status}: ${prediction.error ?? 'no detail'}`);
    return { failed: true };
  }

  const outputUrl = replicateOutputUrl(prediction);
  if (stage === 'swap') {
    await supabase.from('studio_jobs').update({ swap_url: outputUrl, stage_prediction_id: null }).eq('id', job.id);
    const next = { ...job, swap_url: outputUrl };
    await startStage(supabase, next, 'enhance', origin);
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

    await sendTelegramPhoto(
      outputUrl,
      `Boss, handa na ang studio image para sa approval (job <code>${escapeTelegramHtml(job.id.slice(0, 8))}</code>). I-review sa /admin/studio bago i-post sa social media.`,
    );
  } catch (error) {
    await failJob(supabase, job.id, error instanceof Error ? error.message : 'Finalize failed');
  }
}

export async function failJob(supabase: Supabase, id: string, message: string) {
  await supabase.from('studio_jobs').update({ status: 'failed', error: message.slice(0, 500), stage_prediction_id: null, updated_at: new Date().toISOString() }).eq('id', id);
}
