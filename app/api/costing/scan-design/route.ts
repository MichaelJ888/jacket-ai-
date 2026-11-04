import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { withModelFallback } from '../../_lib/llm-pool.ts';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const SCAN_PROMPT = `You are reviewing a garment design mockup for a Philippine uniform embroidery shop (MJIC).
Count and classify the decoration. Return ONLY valid JSON, no markdown:
{"frontLogos":0,"backLogos":0,"reversible":false,"hood":false,"threeTone":false,"isTshirt":false,"isFullSublimation":false,"notes":"one short line"}
- frontLogos: number of logos/embroidered motifs on the front (0 if none)
- backLogos: number of logos/motifs on the back
- reversible: true only if the garment is shown as reversible
- hood: true only if the garment has a hood
- threeTone: true only if the design uses three distinct thread colors
- isTshirt: true if the garment is a T-shirt
- isFullSublimation: true if the whole garment is a full-sublimation print
If unsure about a count, choose the most likely value and say so in notes.`;

// Design scanner: AI vision counts the logos and features; the admin then confirms them in the quote form.
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get('image');
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: 'Expected multipart form with an "image" file' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'image is required' }, { status: 400 });
  const image: File = file;
  if (!ALLOWED_TYPES.includes(image.type)) return NextResponse.json({ error: 'Image must be PNG, JPEG, or WEBP' }, { status: 415 });
  if (image.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be 5 MB or smaller' }, { status: 413 });

  const data = new Uint8Array(await image.arrayBuffer());
  try {
    const result = await withModelFallback({ tier: 'cheap', tools: false, budgetMs: 25_000, attemptMs: 15_000 }, (model, attemptMs) =>
      generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SCAN_PROMPT },
              { type: 'file', mediaType: image.type, data },
            ],
          },
        ],
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(attemptMs),
      }),
    );
    const text = result.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(20, Math.max(0, Math.floor(v))) : 0);
    return NextResponse.json({
      ok: true,
      detected: {
        frontLogos: count(parsed.frontLogos),
        backLogos: count(parsed.backLogos),
        reversible: parsed.reversible === true,
        hood: parsed.hood === true,
        threeTone: parsed.threeTone === true,
        isTshirt: parsed.isTshirt === true,
        isFullSublimation: parsed.isFullSublimation === true,
        notes: String(parsed.notes || '').slice(0, 300),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Design scan failed' }, { status: 502 });
  }
}
