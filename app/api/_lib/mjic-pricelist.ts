// Official CG Venezuela Enterprises 2026 price list (per piece, PHP). Mirrors public/index.html priceTables.
export type PriceTier = { min: number; max: number; price: number };

export const OFFICIAL_PRICE_TABLES = {
  jacket: [{ min: 20, max: 29, price: 1200 }, { min: 30, max: 39, price: 999 }, { min: 40, max: 49, price: 950 }, { min: 50, max: 99, price: 920 }, { min: 100, max: 199, price: 850 }, { min: 200, max: 299, price: 800 }, { min: 300, max: 399, price: 750 }, { min: 400, max: 599, price: 720 }, { min: 600, max: 999, price: 680 }, { min: 1000, max: 9999, price: 650 }, { min: 10000, max: 999999, price: 650 }],
  poloShirt: [{ min: 5, max: 20, price: 800 }, { min: 21, max: 50, price: 650 }, { min: 51, max: 200, price: 550 }, { min: 201, max: 500, price: 480 }, { min: 501, max: 999999, price: 420 }],
  schoolUniform: [{ min: 20, max: 50, price: 900 }, { min: 51, max: 200, price: 800 }, { min: 201, max: 500, price: 750 }, { min: 501, max: 999999, price: 700 }],
} as const satisfies Record<string, readonly PriceTier[]>;

export type OfficialPriceKey = keyof typeof OFFICIAL_PRICE_TABLES;

// Website product categories and the official table each one prices from.
// Categories absent here have no official price (T-Shirt, Company Uniform): sales must quote them.
export const QUOTE_CATEGORIES = {
  jacket: { label: 'Jacket', table: 'jacket' },
  'polo-shirt': { label: 'Polo Shirt', table: 'poloShirt' },
  't-shirt': { label: 'T-Shirt', table: null },
  'company-uniform': { label: 'Company Uniform', table: null },
  'school-uniform': { label: 'School Uniform', table: 'schoolUniform' },
} as const satisfies Record<string, { label: string; table: OfficialPriceKey | null }>;

export type QuoteCategoryKey = keyof typeof QUOTE_CATEGORIES;

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
