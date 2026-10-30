// Down payments are reserved for raw materials. Any other outflow may only use cash that is not locked.
export const MATERIAL_CATEGORY = 'raw_materials';

export function evaluateOperationalPayment(input: { amount: number; category: string; cashBalance: number | null; lockedTotal: number }) {
  const category = input.category.trim().toLowerCase().replace(/\s+/g, '_');
  if (category === MATERIAL_CATEGORY) return { allowed: true as const, availableCash: input.cashBalance, reason: null };
  if (input.lockedTotal <= 0) return { allowed: true as const, availableCash: input.cashBalance, reason: null };
  if (input.cashBalance === null) {
    return { allowed: false as const, availableCash: null, reason: 'Hindi mabasa ang cash balance habang may naka-lock na D.P. para sa materials. Naka-block muna ang payment.' };
  }
  const availableCash = input.cashBalance - input.lockedTotal;
  if (input.amount > availableCash) {
    return {
      allowed: false as const,
      availableCash,
      reason: `Naka-lock ang D.P. para sa raw materials (${input.lockedTotal.toFixed(2)}). Available cash para sa ibang gastos: ${availableCash.toFixed(2)}, kulang para sa ${input.amount.toFixed(2)}.`,
    };
  }
  return { allowed: true as const, availableCash, reason: null };
}
