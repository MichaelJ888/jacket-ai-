// Official CG Venezuela Enterprises 2026 price list (per piece, PHP). Mirrors public/index.html priceTables.
export type PriceTier = { min: number; max: number; price: number };

export const OFFICIAL_PRICE_TABLES = {
  jacket: [{ min: 20, max: 29, price: 1200 }, { min: 30, max: 39, price: 999 }, { min: 40, max: 49, price: 950 }, { min: 50, max: 99, price: 920 }, { min: 100, max: 199, price: 850 }, { min: 200, max: 299, price: 800 }, { min: 300, max: 399, price: 750 }, { min: 400, max: 599, price: 720 }, { min: 600, max: 999, price: 680 }, { min: 1000, max: 9999, price: 650 }, { min: 10000, max: 999999, price: 650 }],
  poloShirt: [{ min: 5, max: 20, price: 800 }, { min: 21, max: 50, price: 650 }, { min: 51, max: 200, price: 550 }, { min: 201, max: 500, price: 480 }, { min: 501, max: 999999, price: 420 }],
  schoolUniform: [{ min: 20, max: 50, price: 900 }, { min: 51, max: 200, price: 800 }, { min: 201, max: 500, price: 750 }, { min: 501, max: 999999, price: 700 }],
  poloJacket: [{ min: 5, max: 20, price: 1000 }, { min: 21, max: 50, price: 950 }, { min: 51, max: 200, price: 880 }, { min: 201, max: 500, price: 800 }, { min: 501, max: 999999, price: 750 }],
  coverall: [{ min: 5, max: 20, price: 2500 }, { min: 21, max: 50, price: 2000 }, { min: 51, max: 200, price: 1600 }, { min: 201, max: 500, price: 1400 }, { min: 501, max: 999999, price: 1000 }],
  scrubSet: [{ min: 5, max: 20, price: 1200 }, { min: 21, max: 50, price: 950 }, { min: 51, max: 200, price: 900 }, { min: 201, max: 500, price: 850 }, { min: 501, max: 999999, price: 780 }],
  peUniform: [{ min: 20, max: 50, price: 800 }, { min: 51, max: 200, price: 750 }, { min: 201, max: 500, price: 700 }, { min: 501, max: 999999, price: 650 }],
  chefUniform: [{ min: 5, max: 20, price: 1300 }, { min: 21, max: 50, price: 1200 }, { min: 51, max: 200, price: 950 }, { min: 201, max: 999999, price: 850 }],
  securityUniform: [{ min: 5, max: 20, price: 1800 }, { min: 21, max: 50, price: 1600 }, { min: 51, max: 200, price: 1400 }, { min: 201, max: 999999, price: 1150 }],
  enamelPin: [{ min: 10, max: 49, price: 220 }, { min: 50, max: 99, price: 150 }, { min: 100, max: 199, price: 110 }, { min: 200, max: 299, price: 90 }, { min: 300, max: 499, price: 75 }, { min: 500, max: 999, price: 60 }, { min: 1000, max: 2999, price: 48 }, { min: 3000, max: 4999, price: 42 }, { min: 5000, max: 9999, price: 38 }, { min: 10000, max: 999999, price: 32 }],
  lanyard: [{ min: 10, max: 49, price: 95 }, { min: 50, max: 99, price: 75 }, { min: 100, max: 199, price: 58 }, { min: 200, max: 499, price: 45 }, { min: 500, max: 999, price: 40 }, { min: 1000, max: 2999, price: 35 }, { min: 3000, max: 4999, price: 32 }, { min: 5000, max: 9999, price: 30 }, { min: 10000, max: 999999, price: 28 }],
  // Giveaways: the site charges the published base price at every quantity (public/index.html basePrices fallback).
  // Single official tier per item until sales publishes volume tiers.
  giveawayToteBag: [{ min: 50, max: 999999, price: 250 }],
  giveawayMug: [{ min: 50, max: 999999, price: 180 }],
} as const satisfies Record<string, readonly PriceTier[]>;

export type OfficialPriceKey = keyof typeof OFFICIAL_PRICE_TABLES;

// Website garment categories and the official table each one prices from.
// T-Shirt and Company Uniform have no official table on file anywhere (not in the site priceTables either):
// they stay in sales-confirmation mode until the owner enters tier matrices in /admin/pricelist
// (quote_pricelist DB rows override these seeds, which flips them to instant quoting automatically).
export const QUOTE_CATEGORIES = {
  jacket: { label: 'Jacket', table: 'jacket' },
  'polo-shirt': { label: 'Polo Shirt', table: 'poloShirt' },
  't-shirt': { label: 'T-Shirt', table: null },
  'company-uniform': { label: 'Company Uniform', table: null },
  'school-uniform': { label: 'School Uniform', table: 'schoolUniform' },
  'polo-jacket': { label: 'Polo Jacket', table: 'poloJacket' },
  coverall: { label: 'Coverall / Heavy-Duty Uniform', table: 'coverall' },
  'scrub-suit': { label: 'Hospital Scrub Suit / Lab Gown', table: 'scrubSet' },
  'pe-uniform': { label: 'School P.E. Uniform', table: 'peUniform' },
  'chef-uniform': { label: 'Chef Uniform', table: 'chefUniform' },
  'security-uniform': { label: 'Security & Military Uniform', table: 'securityUniform' },
} as const satisfies Record<string, { label: string; table: OfficialPriceKey | null }>;

export type QuoteCategoryKey = keyof typeof QUOTE_CATEGORIES;

// Corporate giveaways (non-garment): priced per item with no fabric class, logo program, or add-on fees.
// Served by /api/quote/giveaways and /quote/giveaways, never by the garment flow at /quote.
// MOQ follows each official table's floor (tote/mug 50, lanyard/enamel pin 10).
export const GIVEAWAY_CATEGORIES = {
  'tote-bag': { label: 'Eco Bags, Tote Bags & Backpacks', table: 'giveawayToteBag' },
  mug: { label: 'Customized Mugs', table: 'giveawayMug' },
  lanyard: { label: 'Customized Lanyards', table: 'lanyard' },
  'enamel-pin': { label: 'Enamel Pins', table: 'enamelPin' },
} as const satisfies Record<string, { label: string; table: OfficialPriceKey | null }>;

export type GiveawayCategoryKey = keyof typeof GIVEAWAY_CATEGORIES;

// Official fabric list. Class is never stored here: resolveFabricClass (fabric-class.ts) derives it from the name.
export const FABRIC_OPTIONS: ReadonlyArray<{ name: string }> = [
  { name: 'Microfiber' },
  { name: 'Michael Angelo' },
  { name: 'Diamond Ripstop' },
  { name: 'Twill' },
  { name: 'Canvas / Twill' },
  { name: 'Brush Cotton' },
  { name: 'Marks & Spencer' },
  { name: 'Stellini' },
  { name: 'Vellini' },
  { name: 'Honeycomb / Pique' },
  { name: 'Dri-Fit / Performance Knit' },
  { name: 'Oxford / Broadcloth' },
  { name: 'Softshell' },
  { name: 'Scrub Suit Poly-Cotton' },
  { name: 'Cotton Fleece' },
  { name: 'Taslan' },
  { name: 'Varsity Satin' },
];


export function isQuoteCategory(value: unknown): value is QuoteCategoryKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUOTE_CATEGORIES, value);
}

// Official per-piece price for a quantity, or null when no tier covers it / the category has no table.
export function officialUnitPrice(category: QuoteCategoryKey, quantity: number): number | null {
  const table = QUOTE_CATEGORIES[category].table;
  if (!table) return null;
  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty)) return null;
  const tier = (OFFICIAL_PRICE_TABLES[table] as readonly PriceTier[]).find((t) => qty >= t.min && qty <= t.max);
  return tier ? tier.price : null;
}
