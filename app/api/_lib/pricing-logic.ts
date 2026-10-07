export function recommendPrice(costPerPiece: number, targetMarginPct: number, currentPrice: number) {
  const margin = Math.min(90, Math.max(1, targetMarginPct)) / 100;
  const suggested = Math.ceil(costPerPiece / (1 - margin) / 5) * 5; // round up to the nearest 5 pesos
  const currentMarginPct = currentPrice > 0 ? Number((((currentPrice - costPerPiece) / currentPrice) * 100).toFixed(1)) : 0;
  const changePct = currentPrice > 0 ? Number((((suggested - currentPrice) / currentPrice) * 100).toFixed(1)) : 0;
  return { suggested, currentMarginPct, changePct, action: changePct >= 3 ? 'RAISE' : changePct <= -10 ? 'ROOM_TO_DISCOUNT' : 'HOLD' } as const;
}
