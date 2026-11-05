// Giveaway photo analysis rules. Pure logic, no I/O.
// The vision model only suggests a catalog category. It never sets a price: prices come from the official tiers.
import type { GiveawayCatalogCategory } from './giveaway-quote.ts';

export const GIVEAWAY_PHOTO_MAX_CHARS = 300_000;
export const GIVEAWAY_VISION_MIN_CONFIDENCE = 0.7;

export type GiveawayVerdict =
  | { status: 'suggested'; category: string; label: string; confidence: number }
  | { status: 'market_priced'; category: string; label: string; unitPrice: number; quantity: number; quoteToken: string }
  | { status: 'needs_sales_confirmation'; reason: string };

export function isValidGiveawayPhoto(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= GIVEAWAY_PHOTO_MAX_CHARS
    && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export function buildGiveawayVisionPrompt(catalog: GiveawayCatalogCategory[]): string {
  const options = catalog.map((c) => `- ${c.key}: ${c.label}`).join('\n');
  return [
    'Identify the promotional giveaway product in this photo. Choose exactly one key from the list below, or "none" if it does not match any.',
    options,
    'Return JSON only: {"category": "<key or none>", "confidence": <number 0 to 1>}. Never invent a key that is not in the list.',
  ].join('\n');
}

// Parses the model reply and checks it against the catalog. Anything unexpected becomes a sales-confirmation verdict.
export function parseGiveawayVerdict(text: string, catalog: GiveawayCatalogCategory[]): GiveawayVerdict {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { status: 'needs_sales_confirmation', reason: 'The photo could not be matched to a giveaway category.' };
  let parsed: { category?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return { status: 'needs_sales_confirmation', reason: 'The photo could not be matched to a giveaway category.' };
  }
  const confidence = Number(parsed.confidence);
  const match = typeof parsed.category === 'string' ? catalog.find((c) => c.key === parsed.category) : undefined;
  if (!match || !Number.isFinite(confidence) || confidence < GIVEAWAY_VISION_MIN_CONFIDENCE) {
    return { status: 'needs_sales_confirmation', reason: 'The photo could not be matched to a giveaway category.' };
  }
  return { status: 'suggested', category: match.key, label: match.label, confidence };
}

export const NO_PROVIDER_VERDICT: GiveawayVerdict = {
  status: 'needs_sales_confirmation',
  reason: 'Automatic photo analysis is not configured. A sales representative will confirm pricing.',
};
