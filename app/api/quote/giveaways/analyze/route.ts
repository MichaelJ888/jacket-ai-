import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, type ToolSet } from 'ai';
import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../../../_lib/rate-limit';
import { loadGiveawayCatalog } from '../../../_lib/giveaway-catalog.ts';
import { MARKET_MIN_QUANTITY, MAX_GIVEAWAY_QUANTITY } from '../../../_lib/giveaway-quote.ts';
import {
  buildGiveawayVisionPrompt,
  isValidGiveawayPhoto,
  NO_PROVIDER_VERDICT,
  parseGiveawayVerdict,
  type GiveawayVerdict,
} from '../../../_lib/giveaway-vision.ts';
import {
  buildMarketPricePrompt,
  buildMarketVerdict,
  marketQuoteSecret,
  parseMarketReply,
} from '../../../_lib/giveaway-market.ts';

export const dynamic = 'force-dynamic';

const VISION_TIMEOUT_MS = 20_000;
// Grounded search takes longer than plain classification.
const MARKET_TIMEOUT_MS = 30_000;

// Suggests a giveaway category from a photo. With a quantity, also returns a market-priced verdict
// (median of web-found prices x 1.20) and a signed quote token. The bounds are never returned.
// Unmatched or unavailable analysis becomes a needs_sales_confirmation verdict.
export async function POST(req: Request) {
  const limited = await rateLimitResponse(req, 'public-quote-giveaways-analyze', 6, 60);
  if (limited) return limited;

  let body: { photo?: unknown; quantity?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!isValidGiveawayPhoto(body.photo)) {
    return NextResponse.json({ error: 'Upload a PNG, JPG, or WEBP photo under 300 KB.' }, { status: 400 });
  }

  const marketRequested = body.quantity !== undefined && body.quantity !== null;
  const quantity = marketRequested ? Math.floor(Number(body.quantity)) : 0;
  if (marketRequested && (!Number.isFinite(quantity) || quantity < MARKET_MIN_QUANTITY || quantity > MAX_GIVEAWAY_QUANTITY)) {
    return NextResponse.json(
      { error: `Photo pricing covers ${MARKET_MIN_QUANTITY} to ${MAX_GIVEAWAY_QUANTITY.toLocaleString('en-US')} pieces.` },
      { status: 400 },
    );
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
      system: 'You classify promotional giveaway products and find public market prices. Return only valid JSON.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: marketRequested ? buildMarketPricePrompt(catalog) : buildGiveawayVisionPrompt(catalog) },
          { type: 'image', image: body.photo },
        ],
      }],
      // Provider-executed Google Search; its type is not assignable to ToolSet in this SDK version.
      ...(marketRequested ? { tools: { google_search: google.tools.googleSearch({}) } as unknown as ToolSet } : {}),
      abortSignal: AbortSignal.timeout(marketRequested ? MARKET_TIMEOUT_MS : VISION_TIMEOUT_MS),
    });
    const verdict = marketRequested
      ? buildMarketVerdict(parseMarketReply(result.text), catalog, quantity, marketQuoteSecret())
      : parseGiveawayVerdict(result.text, catalog);
    return NextResponse.json({ ok: true, provider: 'gemini', verdict });
  } catch {
    const verdict: GiveawayVerdict = {
      status: 'needs_sales_confirmation',
      reason: 'Photo analysis was unavailable. A sales representative will confirm pricing.',
    };
    return NextResponse.json({ ok: true, provider: 'gemini', verdict });
  }
}
