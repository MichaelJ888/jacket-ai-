// Corporate giveaways quotation engine (non-garment). Pure rules, no I/O.
// Priced per item straight from the official tier tables; no fabric class, logo program, or add-on fees apply.
import { GIVEAWAY_CATEGORIES, OFFICIAL_PRICE_TABLES, type PriceTier } from './mjic-pricelist.ts';
import { tierPrice, type PricelistCategory } from './pricelist-logic.ts';
import { DEPOSIT_PCT } from './formal-quote.ts';

export const MAX_GIVEAWAY_ITEMS = 8;
export const MAX_GIVEAWAY_QUANTITY = 100000;

export type GiveawayCatalogCategory = PricelistCategory & { moq: number; singleTier: boolean };

export class GiveawayQuoteError extends Error {}

// Built-in giveaway catalog from the official tables. DB rows in quote_pricelist with the same
// category key override these tiers (admin can refine them via /admin/pricelist "add category").
export function seedGiveawayCatalog(): GiveawayCatalogCategory[] {
  return Object.entries(GIVEAWAY_CATEGORIES).map(([key, meta]) => {
    const tiers: PriceTier[] = meta.table ? [...(OFFICIAL_PRICE_TABLES[meta.table] as readonly PriceTier[])] : [];
    return {
      key,
      label: meta.label,
      active: true,
      tiers,
      moq: tiers.length ? Math.min(...tiers.map((tier) => tier.min)) : 1,
      singleTier: tiers.length <= 1,
    };
  });
}

// Applies quote_pricelist DB rows (same overlay rules as loadPricelist) on top of the seed catalog.
export function overlayGiveawayCatalog(dbCategories: PricelistCategory[], seed = seedGiveawayCatalog()): GiveawayCatalogCategory[] {
  const byKey = new Map(seed.map((cat) => [cat.key, cat]));
  for (const row of dbCategories) {
    const current = byKey.get(row.key);
    if (!current) continue; // unknown keys are ignored: giveaways never leak into the garment flow
    byKey.set(row.key, {
      ...row,
      moq: row.tiers.length ? Math.min(...row.tiers.map((tier) => tier.min)) : current.moq,
      singleTier: row.tiers.length <= 1,
    });
  }
  return [...byKey.values()];
}

export type GiveawayQuoteLine = {
  key: string;
  label: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  moq: number;
  // true when the only official price is the flat published base price (tote bags, mugs): volume tiers are confirmed by sales.
  flatRate: boolean;
};

export type GiveawayQuote = {
  lines: GiveawayQuoteLine[];
  totalQuantity: number;
  subtotal: number;
  depositPct: number;
  deposit: number;
  balance: number;
};

export type GiveawayItemInput = { key: unknown; quantity: unknown };

// Validates item selections and prices them strictly from the giveaway catalog. Client-sent prices are ignored by design.
export function computeGiveawayQuote(items: unknown, catalog: GiveawayCatalogCategory[] = seedGiveawayCatalog()): GiveawayQuote {
  if (!Array.isArray(items) || items.length === 0) throw new GiveawayQuoteError('Add at least one giveaway item.');
  if (items.length > MAX_GIVEAWAY_ITEMS) throw new GiveawayQuoteError(`At most ${MAX_GIVEAWAY_ITEMS} items per quotation.`);

  const lines: GiveawayQuoteLine[] = [];
  const seen = new Set<string>();
  for (const raw of items as GiveawayItemInput[]) {
    const key = String(raw?.key ?? '');
    if (seen.has(key)) throw new GiveawayQuoteError('Each item can appear only once — set the quantity on its row.');
    seen.add(key);
    const cat = catalog.find((entry) => entry.key === key && entry.active);
    if (!cat) throw new GiveawayQuoteError('Unknown giveaway item.');

    const quantity = Math.floor(Number(raw?.quantity));
    if (!Number.isFinite(quantity) || quantity < cat.moq) throw new GiveawayQuoteError(`${cat.label}: minimum order is ${cat.moq} pieces.`);
    if (quantity > MAX_GIVEAWAY_QUANTITY) throw new GiveawayQuoteError(`For orders above ${MAX_GIVEAWAY_QUANTITY.toLocaleString('en-US')} pieces, contact sales.`);

    const unitPrice = tierPrice(cat.tiers, quantity);
    if (unitPrice === null) throw new GiveawayQuoteError(`${cat.label}: no official tier covers ${quantity} pieces. Send the request and sales will confirm.`);
    lines.push({ key: cat.key, label: cat.label, quantity, unitPrice, subtotal: unitPrice * quantity, moq: cat.moq, flatRate: cat.singleTier });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const deposit = Math.ceil((subtotal * DEPOSIT_PCT) / 100);
  return {
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal,
    depositPct: DEPOSIT_PCT,
    deposit,
    balance: subtotal - deposit,
  };
}
