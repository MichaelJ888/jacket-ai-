// Server-only: market median pricing for photo-matched giveaway items and signed quote tokens.
// Uses node:crypto, so it must never be imported from client code.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GiveawayCatalogCategory } from './giveaway-quote.ts';
import { MARKET_MIN_QUANTITY, MAX_GIVEAWAY_QUANTITY } from './giveaway-quote.ts';
import { GIVEAWAY_VISION_MIN_CONFIDENCE, type GiveawayVerdict } from './giveaway-vision.ts';

export const MARKET_MARKUP = 1.2;
export const MARKET_MIN_OBSERVATIONS = 3;
export const MARKET_QUOTE_TTL_MS = 30 * 60 * 1000;
const MAX_PLAUSIBLE_PHP = 500_000;

export type MarketQuotePayload = { label: string; unitPrice: number; quantity: number; issuedAt: number };

export function marketMedian(prices: number[]): number | null {
  const valid = prices
    .filter((p) => Number.isFinite(p) && p > 0 && p <= MAX_PLAUSIBLE_PHP)
    .sort((a, b) => a - b);
  if (valid.length < MARKET_MIN_OBSERVATIONS) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

// Rounds to the cent before the ceiling so float error (e.g. 100 * 1.2) cannot add a peso.
export function marketUnitPrice(median: number): number {
  return Math.ceil(Math.round(median * MARKET_MARKUP * 100) / 100);
}

export function buildMarketPricePrompt(catalog: GiveawayCatalogCategory[]): string {
  const options = catalog.map((c) => `- ${c.key}: ${c.label}`).join('\n');
  return [
    'Identify the promotional giveaway product in this photo, then search the web for current Philippine bulk or wholesale unit prices in PHP for that product.',
    'Choose exactly one key from the list below, or "none" if it does not match any.',
    options,
    'Use only prices you found through search. Never invent a price or a source.',
    'Return JSON only: {"category": "<key or none>", "confidence": <number 0 to 1>, "observations": [{"price_php": <number>, "source": "<site name>"}]}.',
  ].join('\n');
}

export type MarketReply = { category: string | null; confidence: number; prices: number[] };

export function parseMarketReply(text: string): MarketReply | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const observations = Array.isArray(parsed.observations) ? parsed.observations : [];
  const prices = observations
    .map((o) => Number((o as { price_php?: unknown } | null)?.price_php))
    .filter((p) => Number.isFinite(p));
  return {
    category: typeof parsed.category === 'string' ? parsed.category : null,
    confidence: Number(parsed.confidence),
    prices,
  };
}

// Secret for signing quote tokens. Returns null when neither is set, which disables market pricing.
export function marketQuoteSecret(): string | null {
  return process.env.GIVEAWAY_QUOTE_SECRET || process.env.CRON_SECRET || null;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signMarketQuote(payload: MarketQuotePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyMarketQuote(token: unknown, secret: string, now = Date.now()): MarketQuotePayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let payload: Partial<MarketQuotePayload>;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const { label, unitPrice, quantity, issuedAt } = payload;
  if (typeof label !== 'string' || label.length === 0 || label.length > 120) return null;
  if (!Number.isFinite(unitPrice) || (unitPrice as number) <= 0) return null;
  if (!Number.isInteger(quantity) || (quantity as number) < MARKET_MIN_QUANTITY || (quantity as number) > MAX_GIVEAWAY_QUANTITY) return null;
  if (!Number.isFinite(issuedAt)) return null;
  const age = now - (issuedAt as number);
  if (age < -60_000 || age > MARKET_QUOTE_TTL_MS) return null;
  return { label, unitPrice: unitPrice as number, quantity: quantity as number, issuedAt: issuedAt as number };
}

// Turns the grounded model reply into a verdict. The label always comes from the catalog, never from model text.
export function buildMarketVerdict(
  reply: MarketReply | null,
  catalog: GiveawayCatalogCategory[],
  quantity: number,
  secret: string | null,
  now = Date.now(),
): GiveawayVerdict {
  const match = reply?.category ? catalog.find((c) => c.key === reply.category && c.active) : undefined;
  if (!reply || !match || !Number.isFinite(reply.confidence) || reply.confidence < GIVEAWAY_VISION_MIN_CONFIDENCE) {
    return { status: 'needs_sales_confirmation', reason: 'The photo could not be matched to a giveaway category.' };
  }

  const median = marketMedian(reply.prices);
  if (median === null || !secret) {
    return { status: 'suggested', category: match.key, label: match.label, confidence: reply.confidence };
  }

  const unitPrice = marketUnitPrice(median);
  const quoteToken = signMarketQuote({ label: match.label, unitPrice, quantity, issuedAt: now }, secret);
  return { status: 'market_priced', category: match.key, label: match.label, unitPrice, quantity, quoteToken };
}
