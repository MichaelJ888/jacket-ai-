// Production quota periods. All dates are Manila calendar dates in YYYY-MM-DD form.
export const QUOTA_PERIODS = [
  { kind: 'daily', label: 'Daily', months: 0 },
  { kind: 'week', label: '1 Week', months: 0 },
  { kind: 'half_month', label: 'Per Half-Month', months: 0 },
  { kind: 'month', label: '1 Month', months: 1 },
  { kind: 'quarter', label: '3 Months', months: 3 },
  { kind: 'semester', label: '6 Months', months: 6 },
  { kind: 'nine_month', label: '9 Months', months: 9 },
  { kind: 'year', label: '1 Whole Year', months: 12 },
] as const;

export type QuotaKind = (typeof QUOTA_PERIODS)[number]['kind'];

export function isQuotaKind(value: unknown): value is QuotaKind {
  return QUOTA_PERIODS.some((period) => period.kind === value);
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

// Today's calendar date in Asia/Manila as YYYY-MM-DD.
export function manilaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
};
const lastDayOfMonth = (year: number, monthIndex: number) => isoDate(new Date(Date.UTC(year, monthIndex + 1, 0)));

// Inclusive window that contains `today`:
// - daily: today
// - week: Monday to Sunday
// - half_month: 1-15 or 16-end of month
// - month/quarter/semester/nine_month/year: first day of the (N-1) months before the current month, through today
export function quotaWindow(kind: QuotaKind, today: string): { start: string; end: string } {
  const [year, month, day] = today.split('-').map(Number);
  if (kind === 'daily') return { start: today, end: today };
  if (kind === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const offsetToMonday = (weekday + 6) % 7;
    const start = addDays(today, -offsetToMonday);
    return { start, end: addDays(start, 6) };
  }
  if (kind === 'half_month') {
    const monthIndex = month - 1;
    return day <= 15
      ? { start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${year}-${String(month).padStart(2, '0')}-15` }
      : { start: `${year}-${String(month).padStart(2, '0')}-16`, end: lastDayOfMonth(year, monthIndex) };
  }
  const months = QUOTA_PERIODS.find((period) => period.kind === kind)?.months || 1;
  const startDate = new Date(Date.UTC(year, month - 1 - (months - 1), 1));
  return { start: isoDate(startDate), end: today };
}

export type QuotaTarget = { period_kind: string; target_pcs: number | null; target_revenue: number | null };

export type QuotaProgress = {
  kind: QuotaKind;
  label: string;
  start: string;
  end: string;
  targetPcs: number | null;
  targetRevenue: number | null;
  actualPcs: number;
  actualRevenue: number;
  pctPcs: number | null;
  pctRevenue: number | null;
};

// Pure: combines configured targets with actual output (sewer_output qty) and income (ledger) for each period.
export function buildQuotaProgress(
  today: string,
  targets: QuotaTarget[],
  actualPcsByDate: Array<{ work_date: string; quantity: number }>,
  incomeByDate: Array<{ entry_date: string; amount: number }>,
): QuotaProgress[] {
  return QUOTA_PERIODS.map((period) => {
    const { start, end } = quotaWindow(period.kind, today);
    const target = targets.find((row) => row.period_kind === period.kind);
    const actualPcs = actualPcsByDate.filter((row) => row.work_date >= start && row.work_date <= end).reduce((sum, row) => sum + Number(row.quantity), 0);
    const actualRevenue = incomeByDate.filter((row) => row.entry_date >= start && row.entry_date <= end).reduce((sum, row) => sum + Number(row.amount), 0);
    const targetPcs = target?.target_pcs ?? null;
    const targetRevenue = target?.target_revenue ?? null;
    return {
      kind: period.kind,
      label: period.label,
      start,
      end,
      targetPcs,
      targetRevenue,
      actualPcs,
      actualRevenue,
      pctPcs: targetPcs ? Math.round((actualPcs / targetPcs) * 1000) / 10 : null,
      pctRevenue: targetRevenue ? Math.round((actualRevenue / targetRevenue) * 1000) / 10 : null,
    };
  });
}

export type SubconCandidate = { name: string; daily_capacity_pcs: number | null; rate_per_pc: number | null; active: boolean };

// Overflow = how many pcs today's output exceeds the daily target. Suggests active subcons that can absorb it, cheapest first.
export function planSubconOverflow(dailyActualPcs: number, dailyTargetPcs: number | null, subcons: SubconCandidate[]) {
  const overflowPcs = dailyTargetPcs ? Math.max(0, dailyActualPcs - dailyTargetPcs) : 0;
  const suggestions = subcons
    .filter((subcon) => subcon.active && Number(subcon.daily_capacity_pcs || 0) > 0)
    .sort((a, b) => Number(a.rate_per_pc ?? Infinity) - Number(b.rate_per_pc ?? Infinity))
    .map((subcon) => ({ name: subcon.name, capacityPcs: Number(subcon.daily_capacity_pcs), ratePerPc: subcon.rate_per_pc }));
  return { overflowPcs, needsSubcon: overflowPcs > 0, suggestions };
}
