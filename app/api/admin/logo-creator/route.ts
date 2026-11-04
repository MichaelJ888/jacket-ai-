import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { rateLimitResponse } from '../../_lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STABILITY_URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT = 600;

const STYLES = new Set(['modern-minimal', 'corporate-premium', 'bold-badge', 'lettermark']);

const STYLE_PROMPTS: Record<string, string> = {
  'modern-minimal': 'redesigned as a modern minimalist logo, clean geometry, generous whitespace, flat vector style',
  'corporate-premium': 'redesigned as a premium corporate logo, refined serif or geometric sans letterforms, executive palette, flat vector style',
  'bold-badge': 'redesigned as a bold emblem badge logo, strong silhouette, high contrast, flat vector style',
  lettermark: 'redesigned as a sleek lettermark monogram logo, typography-focused, flat vector style',
};

type ParsedImage = { bytes: Buffer; mime: string };

function parseDataUrl(value: unknown): ParsedImage | null {
  if (typeof value !== 'string') return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return { bytes, mime: `image/${match[1]}` };
}

// AI logo modernization: old logo image + description + brand prefs -> high-res PNG concept drafts.
// Concepts are raster drafts for review; final vectorization (AI/EPS/SVG) stays with the design team.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limited = await rateLimitResponse(req, 'logo-creator', 6, 300);
  if (limited) return limited;

  const key = process.env.STABILITY_API_KEY;
  if (!key) return NextResponse.json({ error: 'Logo creator is not configured (STABILITY_API_KEY missing).' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const image = parseDataUrl(body.image);
  if (!image) return NextResponse.json({ error: 'Attach the old logo as a PNG, JPEG, or WebP image up to 4 MB.' }, { status: 400 });

  const description = String(body.description ?? '').trim().slice(0, MAX_PROMPT);
  if (description.length < 10) return NextResponse.json({ error: 'Describe the business and the redesign direction (at least 10 characters).' }, { status: 400 });

  const style = STYLES.has(String(body.style)) ? String(body.style) : 'modern-minimal';
  const colors = String(body.colors ?? '').trim().slice(0, 120);
  const count = Math.min(3, Math.max(1, Math.floor(Number(body.count) || 1)));

  const prompt = [
    'Redesign the attached company logo:',
    description,
    STYLE_PROMPTS[style],
    colors ? `Preferred colors: ${colors}.` : '',
    'Keep the brand recognizable, crisp edges, centered on a plain white background, no watermark, no mockup, no photo background.',
  ].filter(Boolean).join(' ');

  const images: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('image', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `logo.${image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg'}`);
    form.append('mode', 'image-to-image');
    form.append('strength', '0.6');
    form.append('model', 'sd3.5-large');
    form.append('output_format', 'png');

    let response: Response;
    try {
      response = await fetch(STABILITY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        body: form,
        signal: AbortSignal.timeout(55_000),
      });
    } catch {
      return NextResponse.json({ error: 'Image model request timed out or failed. Try again.' }, { status: 502 });
    }
    const data = (await response.json().catch(() => ({}))) as { image?: string; errors?: string[]; finish_reason?: string };
    if (!response.ok || !data.image) {
      const reason = data.errors?.join('; ') || `HTTP ${response.status}`;
      return NextResponse.json({ error: `Image generation failed: ${reason}`.slice(0, 300), images: images.length ? images : undefined }, { status: 502 });
    }
    images.push(`data:image/png;base64,${data.image}`);
  }

  return NextResponse.json({ ok: true, provider: 'stability-sd3.5', style, images });
}
