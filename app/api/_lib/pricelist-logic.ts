// Pure pricelist rules shared by the server, the public /quote page, and the admin editor. No I/O here.
import { OFFICIAL_PRICE_TABLES, QUOTE_CATEGORIES, type PriceTier } from './mjic-pricelist.ts';
import { MOQ_PIECES } from './pricing-logic.ts';

export type PricelistCategory = { key: string; label: string; active: boolean; tiers: PriceTier[] };
export type Pricelist = { categories: PricelistCategory[] };

export const MAX_TIERS_PER_CATEGORY = 30;
export const MAX_TIER_PRICE = 1_000_000;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

// Core apparel (corporate jackets, company/school uniforms, medical wear) never quotes below this many pieces,
// even when a category's own tier floor is lower.
export const CORE_APPAREL_MOQ = 20;
export const CORE_APPAREL_CATEGORIES: ReadonlySet<string> = new Set(['jacket', 'company-uniform', 'school-uniform', 'scrub-suit']);

// Per-piece add-on fees (PHP). Pricing is additive to the garment tier price.
export const MODULAR_ADD_ONS = {
  embroidery: { label: 'Embroidery', perPiece: 50 },
  'vinyl-print': { label: 'Vinyl print', perPiece: 40 },
  'screen-print': { label: 'Screen print', perPiece: 30 },
  'reflective-tape': { label: 'Reflectorized safety tape', perPiece: 35 },
  'inner-lining': { label: 'Custom inner lining', perPiece: 60 },
} as const;
export type ModularAddOnKey = keyof typeof MODULAR_ADD_ONS;

// Volume brackets are labels only. The unit price always comes from the official tier that covers the exact quantity.
export const VOLUME_BRACKETS = [
  { min: 20, max: 49, label: '20–49 pcs' },
  { min: 50, max: 99, label: '50–99 pcs' },
  { min: 100, max: 249, label: '100–249 pcs' },
  { min: 250, max: Infinity, label: '250+ pcs' },
] as const;

export class QuoteValidationError extends Error {}

export function volumeBracket(quantity: number): string | null {
  const qty = Math.floor(Number(quantity));
  const bracket = VOLUME_BRACKETS.find((b) => qty >= b.min && qty <= b.max);
  return bracket ? bracket.label : null;
}

export function categoryMinQuantity(category: Pick<PricelistCategory, 'key' | 'tiers'>): number {
  if (CORE_APPAREL_CATEGORIES.has(category.key)) return CORE_APPAREL_MOQ;
  return category.tiers.length ? Math.min(...category.tiers.map((tier) => tier.min)) : MOQ_PIECES;
}

// Standardized quote validation: enforces the category MOQ, checks the add-on list, and returns the official unit price.
export function calculateQuote(input: { category: PricelistCategory; quantity: unknown; addOns?: unknown }) {
  const minQuantity = categoryMinQuantity(input.category);
  const quantity = Math.floor(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity < minQuantity) {
    throw new QuoteValidationError(`Minimum order for ${input.category.label} is ${minQuantity} pieces.`);
  }

  const requested = Array.isArray(input.addOns) ? input.addOns.map(String) : [];
  for (const key of requested) {
    if (!Object.prototype.hasOwnProperty.call(MODULAR_ADD_ONS, key)) throw new QuoteValidationError(`Unknown add-on: ${key}.`);
  }
  const addOns = [...new Set(requested)] as ModularAddOnKey[];
  const addOnPerPiece = addOns.reduce((sum, key) => sum + MODULAR_ADD_ONS[key].perPiece, 0);

  return {
    minQuantity,
    quantity,
    bracket: volumeBracket(quantity),
    unitPrice: tierPrice(input.category.tiers, quantity),
    addOns,
    addOnPerPiece,
  };
}

// The built-in official 2026 tables. Used when the database has no override for a category.
export function seedPricelist(): Pricelist {
  return {
    categories: Object.entries(QUOTE_CATEGORIES).map(([key, meta]) => ({
      key,
      label: meta.label,
      active: true,
      tiers: meta.table ? [...(OFFICIAL_PRICE_TABLES[meta.table] as readonly PriceTier[])] : [],
    })),
  };
}

// Per-piece price for a quantity, or null when no tier covers it.
export function tierPrice(tiers: readonly PriceTier[], quantity: number): number | null {
  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty)) return null;
  const tier = tiers.find((t) => qty >= t.min && qty <= t.max);
  return tier ? tier.price : null;
}

// Validates and normalizes an admin-submitted category. Throws an Error with a user-facing message.
export function normalizeCategoryInput(input: unknown): PricelistCategory {
  if (!input || typeof input !== 'object') throw new Error('Invalid category.');
  const o = input as Record<string, unknown>;
  const key = String(o.key ?? '').trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) throw new Error('Category key must be 2-40 characters: lowercase letters, numbers, and hyphens.');
  const label = String(o.label ?? '').trim();
  if (label.length < 2 || label.length > 60) throw new Error('Label must be 2-60 characters.');
  if (!Array.isArray(o.tiers)) throw new Error('Tiers must be a list.');
  if (o.tiers.length > MAX_TIERS_PER_CATEGORY) throw new Error(`A category can have at most ${MAX_TIERS_PER_CATEGORY} tiers.`);

  const tiers: PriceTier[] = o.tiers.map((row, index) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const min = Number(r.min);
    const max = Number(r.max);
    const price = Number(r.price);
    const n = index + 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
      throw new Error(`Tier ${n}: quantities must be whole numbers, min at least 1 and max at least min.`);
    }
    if (!Number.isFinite(price) || price <= 0 || price > MAX_TIER_PRICE) {
      throw new Error(`Tier ${n}: price must be greater than 0 and at most ${MAX_TIER_PRICE}.`);
    }
    return { min, max, price };
  }).sort((a, b) => a.min - b.min);

  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].min <= tiers[i - 1].max) throw new Error('Quantity tiers must not overlap.');
  }
  return { key, label, active: o.active !== false, tiers };
}
