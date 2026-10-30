// Down-payment fund lock shield. Red when the cash on hand cannot cover the raw-material funds locked for orders.
// Pure logic: the caller supplies cash balance and locked total.

export type FundLockAlert = {
  level: 'red' | 'green' | 'unknown';
  cashBalance: number | null;
  lockedTotal: number;
  shortfall: number;
  message: string;
};

export function evaluateFundLockAlert(input: { cashBalance: number | null; lockedTotal: number }): FundLockAlert {
  const lockedTotal = Math.max(0, Number(input.lockedTotal) || 0);
  if (input.cashBalance === null || input.cashBalance === undefined) {
    return { level: 'unknown', cashBalance: null, lockedTotal, shortfall: 0, message: 'Hindi ma-verify ang cash balance.' };
  }
  const cashBalance = Number(input.cashBalance);
  const shortfall = Math.max(0, Math.round((lockedTotal - cashBalance) * 100) / 100);
  if (shortfall > 0) {
    return {
      level: 'red',
      cashBalance,
      lockedTotal,
      shortfall,
      message: `RED ALERT: kulang ang pondo ng tela ng ₱${shortfall.toLocaleString('en-PH')}. Naka-lock ₱${lockedTotal.toLocaleString('en-PH')}, cash ₱${cashBalance.toLocaleString('en-PH')}.`,
    };
  }
  return { level: 'green', cashBalance, lockedTotal, shortfall: 0, message: 'Naka-lock ang down payment ng tela at buo ang pondo.' };
}
