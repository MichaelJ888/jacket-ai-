// Pure threshold rules for stock alerts. An alert fires only on the crossing, not on every deduction,
// so a material that stays low does not spam Telegram. reorder_level <= 0 means "not tracked".

export function stockCrossingAlert(previous: number, remaining: number, reorderLevel: number): 'shortage' | 'low' | null {
  if (!(reorderLevel > 0)) return null;
  if (remaining < 0 && previous >= 0) return 'shortage';
  if (previous > reorderLevel && remaining <= reorderLevel) return 'low';
  return null;
}

export function isAtOrBelowReorder(quantityAvailable: number, reorderLevel: number) {
  return reorderLevel > 0 && quantityAvailable <= reorderLevel;
}
