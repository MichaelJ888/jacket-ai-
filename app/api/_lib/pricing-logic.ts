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

// Standard machine speed used by the digitizer QA estimate (stitches per minute).
export const EMBROIDERY_STITCHES_PER_MIN = 700;

function money(value: number) {
  return Math.round(value * 100) / 100;
}

// Machine-time cost comes from the digitizer's stitch count; garment cost from the BOM costing per piece.
// The 1.2x cost floor applies to the combined per-piece cost, and the current price is checked against it.
export function digitizeQuote(input: {
  stitchCount: number;
  machineRatePerHour: number;
  quantity?: number;
  garmentCostPerPiece?: number;
  currentUnitPrice?: number;
}) {
  const stitches = Number.isFinite(input.stitchCount) && input.stitchCount > 0 ? input.stitchCount : 0;
  const rate = Number.isFinite(input.machineRatePerHour) && input.machineRatePerHour >= 0 ? input.machineRatePerHour : 0;
  const pieces = Number.isFinite(input.quantity) && (input.quantity as number) > 0 ? Math.floor(input.quantity as number) : 0;
  const garment = Number.isFinite(input.garmentCostPerPiece) && (input.garmentCostPerPiece as number) > 0 ? (input.garmentCostPerPiece as number) : 0;
  const currentPrice = Number.isFinite(input.currentUnitPrice) && (input.currentUnitPrice as number) > 0 ? (input.currentUnitPrice as number) : 0;

  const machineMinutesPerPiece = money(stitches / EMBROIDERY_STITCHES_PER_MIN);
  const embroideryCostPerPiece = money((machineMinutesPerPiece / 60) * rate);
  const unitCostPerPiece = money(garment + embroideryCostPerPiece);
  const costFloorPerPiece = costFloorPrice(unitCostPerPiece);
  const pricing = currentPrice > 0 ? recommendPrice(unitCostPerPiece, currentPrice) : null;

  return {
    stitchCount: stitches,
    quantity: pieces,
    machineRatePerHour: rate,
    machineMinutesPerPiece,
    machineMinutesTotal: money(machineMinutesPerPiece * pieces),
    embroideryCostPerPiece,
    garmentCostPerPiece: money(garment),
    unitCostPerPiece,
    costFloorPerPiece,
    costFloorTotal: money(costFloorPerPiece * pieces),
    currentUnitPrice: currentPrice || null,
    action: pricing ? pricing.action : 'NO_PRICE',
    suggestedUnitPrice: pricing ? pricing.suggested : null,
  } as const;
}
