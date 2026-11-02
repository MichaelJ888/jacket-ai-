export const MOQ_PIECES = 20;
export const FREE_ADD_ONS = ['metro-manila-delivery', 'digital-mockup', 'first-logo-embroidery'] as const;

// Volume curve applied to the market unit price of a style. The MOQ run pays the full market rate; each
// larger tier takes a bigger share off it so the margin narrows as volume grows (MOQ 20 = ₱1,250/pc, 100 = ₱850/pc).
export const VOLUME_TIERS: ReadonlyArray<{ minQty: number; discountPct: number }> = [
  { minQty: 20, discountPct: 0 },
  { minQty: 50, discountPct: 24 },
  { minQty: 100, discountPct: 32 },
  { minQty: 200, discountPct: 35 },
  { minQty: 500, discountPct: 40 },
  { minQty: 1000, discountPct: 45 },
];

// Break-even guard, not a margin target: no unit price is quoted below cost x this multiple.
export const MIN_COST_COVER_MULTIPLE = 1.2;

export function volumeDiscountPct(quantity: number) {
  let discount = 0;
  for (const tier of VOLUME_TIERS) if (quantity >= tier.minQty) discount = tier.discountPct;
  return discount;
}

export function costFloorPrice(costPerPiece: number) {
  return costPerPiece > 0 ? Math.ceil(costPerPiece * MIN_COST_COVER_MULTIPLE) : 0;
}

// Whole-peso unit price for a run: market rate less the volume discount, never below the cost floor.
export function tierUnitPrice(marketUnitPrice: number, quantity: number, costPerPiece = 0) {
  const discounted = (marketUnitPrice * (100 - volumeDiscountPct(quantity))) / 100;
  return Math.ceil(Math.max(discounted, costFloorPrice(costPerPiece)));
}

// Every tier's unit price for one style, for showing the customer or the admin the full curve.
export function volumeLadder(marketUnitPrice: number, costPerPiece = 0) {
  return VOLUME_TIERS.map((tier) => ({ minQty: tier.minQty, discountPct: tier.discountPct, unitPrice: tierUnitPrice(marketUnitPrice, tier.minQty, costPerPiece) }));
}

// Market unit price (the MOQ rate) x quantity at the volume tier's price, no hidden fees.
// Free add-ons are listed for the customer, never charged.
export function quoteBulkOrder(marketUnitPrice: number, quantity: number, costPerPiece = 0) {
  const pieces = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
  const market = Number.isFinite(marketUnitPrice) && marketUnitPrice >= 0 ? marketUnitPrice : 0;
  const moqMet = pieces >= MOQ_PIECES;
  const unitPrice = moqMet ? tierUnitPrice(market, pieces, costPerPiece) : market;
  const subtotal = Math.round(unitPrice * pieces * 100) / 100;
  return {
    pieces,
    moqMet,
    piecesShort: Math.max(0, MOQ_PIECES - pieces),
    discountPct: moqMet ? volumeDiscountPct(pieces) : 0,
    unitPrice,
    subtotal,
    total: subtotal,
    freeAddOns: FREE_ADD_ONS,
  };
}

// Market-driven check, no target margin: a selling price that has fallen under the cost floor should be raised.
export function recommendPrice(costPerPiece: number, currentPrice: number) {
  const floor = costFloorPrice(costPerPiece);
  const suggested = currentPrice < floor ? Math.ceil(floor / 5) * 5 : currentPrice; // round up to the nearest 5 pesos
  const costCoverPct = costPerPiece > 0 && currentPrice > 0 ? Number(((currentPrice / costPerPiece) * 100).toFixed(1)) : 0;
  const changePct = currentPrice > 0 ? Number((((suggested - currentPrice) / currentPrice) * 100).toFixed(1)) : 0;
  return { floor, suggested, costCoverPct, changePct, action: suggested > currentPrice ? 'RAISE' : 'HOLD' } as const;
}
