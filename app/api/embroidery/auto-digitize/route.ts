import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { digitizeLogo } from '../../_lib/digitize/index.ts';
import {
  createDigitizeJob,
  estimateStitchCount,
  getSupabaseAdmin,
  reportCriticalError,
  sendTelegramMessage,
  sendTelegramPhoto,
} from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const BUCKET = 'embroidery-files';

type RequestBody = {
  image?: unknown;
  widthInches?: unknown;
  widthMm?: unknown;
  heightInches?: unknown;
  heightMm?: unknown;
  projectName?: unknown;
  clientName?: unknown;
  placement?: unknown;
  maxColors?: unknown;
  embroideryJobId?: unknown;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isSupportedImageSource(value: unknown): value is string {
  return typeof value === 'string' && (/^https:\/\//i.test(value) || /^data:image\/(png|jpe?g|svg\+xml);base64,/i.test(value));
}

function toPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function mmFromBody(body: RequestBody) {
  const widthMm = toPositiveNumber(body.widthMm) || toPositiveNumber(body.widthInches) * 25.4;
  const heightMm = toPositiveNumber(body.heightMm) || toPositiveNumber(body.heightInches) * 25.4;
  return { widthMm, heightMm: heightMm || undefined };
}

async function loadImageBuffer(image: string) {
  if (image.startsWith('data:')) {
    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error('Unsupported data URL format.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > MAX_INPUT_BYTES) throw new Error('Image exceeds 8 MB limit.');
    return { buffer, source: image, mimeType: match[1] };
  }
  const response = await fetch(image, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Image fetch failed with status ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_INPUT_BYTES) throw new Error('Remote image exceeds 8 MB limit.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_INPUT_BYTES) throw new Error('Remote image exceeds 8 MB limit.');
  return { buffer, source: image, mimeType: response.headers.get('content-type') || 'application/octet-stream' };
}

async function ensureBucket() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error('Supabase is not configured.');
  const result = await supabase.storage.createBucket(BUCKET, { public: false });
  if (result.error && !/exists|duplicate/i.test(result.error.message)) throw new Error(result.error.message);
  return supabase;
}

async function uploadEmbroideryArtifacts(prefix: string, files: Record<string, { buffer: Buffer; contentType: string }>) {
  const supabase = await ensureBucket();
  const storagePaths: Record<string, string> = {};
  const signedUrls: Record<string, string> = {};
  for (const [name, file] of Object.entries(files)) {
    const path = `${prefix}/${name}`;
    const upload = await supabase.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.contentType, upsert: true });
    if (upload.error) throw new Error(upload.error.message);
    storagePaths[name] = path;
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, SEVEN_DAYS_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || `Failed to sign ${name}.`);
    signedUrls[name] = signed.data.signedUrl;
  }
  return { storagePaths, signedUrls };
}

function buildQaCaption(projectName: string, clientName: string, placement: string, qa: Awaited<ReturnType<typeof digitizeLogo>>['qa']) {
  const warnings = qa.warnings.length ? `Warnings:\n- ${qa.warnings.join('\n- ')}` : 'Warnings: none';
  return [
    qa.needsHumanReview ? '🧵 <b>DIGITIZING READY FOR REVIEW</b>' : '✅ <b>DIGITIZING COMPLETE</b>',
    `Project: <b>${projectName || 'Not provided'}</b>`,
    `Client: <b>${clientName || 'Not provided'}</b>`,
    placement ? `Placement: <b>${placement}</b>` : '',
    `Stitches: <b>${qa.stitchCount.toLocaleString('en-PH')}</b>`,
    `Colors: <b>${qa.threadList.length}</b>`,
    `Size: <b>${qa.designWidthMm} × ${qa.designHeightMm} mm</b>`,
    `Density: <b>${qa.densityPerCm2}/cm²</b>`,
    `Confidence: <b>${qa.confidence.toFixed(2)}</b>`,
    warnings,
  ].filter(Boolean).join('\n');
}

async function handleExternalProvider(body: RequestBody, image: string, widthMm: number, heightMm: number | undefined, projectName: string, clientName: string, placement: string, stitchEstimate: number) {
  const apiUrl = process.env.EMBROIDERY_DIGITIZE_API_URL;
  const apiKey = process.env.EMBROIDERY_DIGITIZE_API_KEY;
  if (!apiUrl) return null;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      image,
      widthMm,
      heightMm,
      widthInches: widthMm / 25.4,
      heightInches: heightMm ? heightMm / 25.4 : undefined,
      placement,
      maxColors: clamp(toPositiveNumber(body.maxColors) || 0, 0, 12) || undefined,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`Digitize service returned ${response.status}.`);

  const stitchCount = Number(payload.stitchCount) || stitchEstimate;
  const result = await createDigitizeJob({
    embroideryJobId: typeof body.embroideryJobId === 'string' ? body.embroideryJobId : undefined,
    sourceImage: image,
    placement,
    widthInches: widthMm / 25.4,
    heightInches: heightMm ? heightMm / 25.4 : undefined,
    status: 'COMPLETED',
    provider: process.env.EMBROIDERY_DIGITIZE_PROVIDER || 'external',
    dstFileUrl: typeof payload.dstFileUrl === 'string' ? payload.dstFileUrl : undefined,
    dstFileBase64: typeof payload.dstFileBase64 === 'string' ? payload.dstFileBase64 : undefined,
    stitchCount,
    notes: JSON.stringify({
      provider: process.env.EMBROIDERY_DIGITIZE_PROVIDER || 'external',
      stitchCount,
      dstFileUrl: payload.dstFileUrl || null,
      previewUrl: payload.previewUrl || null,
    }),
  });
  if (result.error) throw new Error(result.error);

  if (typeof payload.previewUrl === 'string') {
    void sendTelegramPhoto(payload.previewUrl, [
      '✅ <b>EXTERNAL DIGITIZING COMPLETE</b>',
      `Project: <b>${projectName || 'Not provided'}</b>`,
      `Client: <b>${clientName || 'Not provided'}</b>`,
      placement ? `Placement: <b>${placement}</b>` : '',
      `Stitches: <b>${stitchCount.toLocaleString('en-PH')}</b>`,
    ].filter(Boolean).join('\n'));
  } else {
    void sendTelegramMessage([
      '✅ <b>EXTERNAL DIGITIZING COMPLETE</b>',
      `Project: <b>${projectName || 'Not provided'}</b>`,
      `Client: <b>${clientName || 'Not provided'}</b>`,
      placement ? `Placement: <b>${placement}</b>` : '',
      `Stitches: <b>${stitchCount.toLocaleString('en-PH')}</b>`,
      typeof payload.dstFileUrl === 'string' ? `DST: ${payload.dstFileUrl}` : '',
    ].filter(Boolean).join('\n'));
  }

  return NextResponse.json({ success: true, requiresManualDigitizing: false, provider: 'external', job: result.data });
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as RequestBody;
    if (!isSupportedImageSource(body.image)) {
      return NextResponse.json({ error: 'image must be an https URL or data:image/png/jpeg/svg+xml base64 URL' }, { status: 400 });
    }

    const { widthMm, heightMm } = mmFromBody(body);
    if (!widthMm) return NextResponse.json({ error: 'widthMm or widthInches is required' }, { status: 400 });

    const placement = typeof body.placement === 'string' ? body.placement.trim() : '';
    const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
    const stitchEstimate = estimateStitchCount(widthMm / 25.4, (heightMm || widthMm) / 25.4);

    const providerResponse = await handleExternalProvider(body, body.image, widthMm, heightMm, projectName, clientName, placement, stitchEstimate);
    if (providerResponse) return providerResponse;

    const loaded = await loadImageBuffer(body.image);
    const digitized = await digitizeLogo({
      image: loaded.buffer,
      widthMm,
      heightMm,
      maxColors: clamp(toPositiveNumber(body.maxColors) || 0, 0, 12) || undefined,
      designName: (projectName || clientName || 'mjic-logo').slice(0, 16),
    });

    const prefix = `digitize/${typeof body.embroideryJobId === 'string' ? body.embroideryJobId : randomUUID()}`;
    const uploads = await uploadEmbroideryArtifacts(prefix, {
      'preview.png': { buffer: digitized.previewPng, contentType: 'image/png' },
      'logo.dst': { buffer: digitized.files.dst, contentType: 'application/octet-stream' },
      'logo.exp': { buffer: digitized.files.exp, contentType: 'application/octet-stream' },
      'logo.pes': { buffer: digitized.files.pes, contentType: 'application/octet-stream' },
      'logo.jef': { buffer: digitized.files.jef, contentType: 'application/octet-stream' },
    });

    const status = digitized.qa.needsHumanReview ? 'PENDING_MANUAL_DIGITIZING' : 'COMPLETED';
    const result = await createDigitizeJob({
      embroideryJobId: typeof body.embroideryJobId === 'string' ? body.embroideryJobId : undefined,
      sourceImage: body.image,
      placement,
      widthInches: widthMm / 25.4,
      heightInches: heightMm ? heightMm / 25.4 : undefined,
      status,
      provider: 'built-in-typescript',
      dstFileUrl: uploads.signedUrls['logo.dst'],
      stitchCount: digitized.qa.stitchCount,
      notes: JSON.stringify({
        provider: 'built-in-typescript',
        status,
        qa: digitized.qa,
        storagePaths: uploads.storagePaths,
        signedUrls: uploads.signedUrls,
        sourceMimeType: loaded.mimeType,
      }),
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });

    void sendTelegramPhoto(uploads.signedUrls['preview.png'], buildQaCaption(projectName, clientName, placement, digitized.qa));

    return NextResponse.json({
      success: true,
      requiresManualDigitizing: digitized.qa.needsHumanReview,
      job: result.data,
      qa: digitized.qa,
      files: uploads.signedUrls,
    });
  } catch (error) {
    await reportCriticalError('embroidery:auto-digitize', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Auto-digitize request failed' }, { status: 400 });
  }
}
