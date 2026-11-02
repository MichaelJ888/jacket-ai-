export const DEFAULT_MARGIN_PCT = 35;
export const MOQ_PIECES = 20;
export const FREE_ADD_ONS = ['metro-manila-delivery', 'digital-mockup', 'first-logo-embroidery'] as const;

// Catalog unit price x quantity, no hidden fees. Free add-ons are listed for the customer, never charged.
export function quoteBulkOrder(unitPrice: number, quantity: number) {
  const pieces = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
  const price = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
  const subtotal = Math.round(price * pieces * 100) / 100;
  return { pieces, moqMet: pieces >= MOQ_PIECES, piecesShort: Math.max(0, MOQ_PIECES - pieces), subtotal, total: subtotal, freeAddOns: FREE_ADD_ONS };
}

export function recommendPrice(costPerPiece: number, targetMarginPct: number, currentPrice: number) {
  const margin = Math.min(90, Math.max(1, targetMarginPct)) / 100;
  const suggested = Math.ceil(costPerPiece / (1 - margin) / 5) * 5; // round up to the nearest 5 pesos
  const currentMarginPct = currentPrice > 0 ? Number((((currentPrice - costPerPiece) / currentPrice) * 100).toFixed(1)) : 0;
  const changePct = currentPrice > 0 ? Number((((suggested - currentPrice) / currentPrice) * 100).toFixed(1)) : 0;
  return { suggested, currentMarginPct, changePct, action: changePct >= 3 ? 'RAISE' : changePct <= -10 ? 'ROOM_TO_DISCOUNT' : 'HOLD' } as const;
}
