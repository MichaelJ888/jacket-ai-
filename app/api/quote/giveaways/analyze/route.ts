import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../../../_lib/rate-limit';
import { loadGiveawayCatalog } from '../../../_lib/giveaway-catalog.ts';
import {
  buildGiveawayVisionPrompt,
  isValidGiveawayPhoto,
  NO_PROVIDER_VERDICT,
  parseGiveawayVerdict,
  type GiveawayVerdict,
} from '../../../_lib/giveaway-vision.ts';

export const dynamic = 'force-dynamic';

const VISION_TIMEOUT_MS = 20_000;

// Suggests a giveaway category from a photo. Never returns a price: unmatched or unavailable analysis
// becomes a needs_sales_confirmation verdict.
export async function POST(req: Request) {
  const limited = await rateLimitResponse(req, 'public-quote-giveaways-analyze', 6, 60);
  if (limited) return limited;

  let body: { photo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!isValidGiveawayPhoto(body.photo)) {
    return NextResponse.json({ error: 'Upload a PNG, JPG, or WEBP photo under 300 KB.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const verdict: GiveawayVerdict = NO_PROVIDER_VERDICT;
    return NextResponse.json({ ok: true, provider: null, verdict });
  }

  try {
    const catalog = await loadGiveawayCatalog();
    const google = createGoogleGenerativeAI({ apiKey });
    const result = await generateText({
      model: google('gemini-3.6-flash'),
      system: 'You classify promotional giveaway products. Return only valid JSON.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildGiveawayVisionPrompt(catalog) },
          { type: 'image', image: body.photo },
        ],
      }],
      abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });
    const verdict = parseGiveawayVerdict(result.text, catalog);
    return NextResponse.json({ ok: true, provider: 'gemini', verdict });
  } catch {
    const verdict: GiveawayVerdict = {
      status: 'needs_sales_confirmation',
      reason: 'Photo analysis was unavailable. A sales representative will confirm pricing.',
    };
    return NextResponse.json({ ok: true, provider: 'gemini', verdict });
  }
}
