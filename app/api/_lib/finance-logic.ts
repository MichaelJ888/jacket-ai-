// Pure finance rules (no I/O) so they can be unit-tested with node:test.

export interface AllocationRule {
  bucket: string;
  percent: number;
  monthly_target?: number | null;
  priority?: number;
  is_overflow?: boolean;
  is_ceo_reward?: boolean;
}

export interface AllocationLine {
  bucket: string;
  amount: number;
  percent: number;
  capped: boolean;
}

export interface AllocationResult {
  lines: AllocationLine[];
  total: number;
  warning: string | null;
}

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

// Splits net profit across buckets by percent. Buckets with a monthly_target stop receiving
// money once funded for the month; the excess flows to the overflow bucket (rolling capital),
// as does any rounding remainder, so lines always sum exactly to the profit.
export function allocateProfit(netProfit: number, rules: AllocationRule[], fundedThisMonth: Record<string, number> = {}): AllocationResult {
  const profitCents = toCents(Number(netProfit) || 0);
  if (profitCents <= 0) return { lines: [], total: 0, warning: 'No positive profit to allocate.' };

  const active = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  const percentSum = active.reduce((sum, rule) => sum + Number(rule.percent || 0), 0);
  const warning = Math.abs(percentSum - 100) > 0.001 ? `Allocation percentages add up to ${percentSum}%, not 100%.` : null;
  const overflowRule = active.find((rule) => rule.is_overflow) || active[active.length - 1];
  if (!overflowRule) return { lines: [], total: 0, warning: 'No allocation rules configured.' };

  const lines: AllocationLine[] = [];
  let allocated = 0;
  let overflow = 0;

  for (const rule of active) {
    if (rule.bucket === overflowRule.bucket) continue;
    let amount = Math.floor((profitCents * Number(rule.percent || 0)) / 100);
    let capped = false;
    if (rule.monthly_target != null) {
      const room = Math.max(0, toCents(Number(rule.monthly_target)) - toCents(fundedThisMonth[rule.bucket] || 0));
      if (amount > room) {
        overflow += amount - room;
        amount = room;
        capped = true;
      }
    }
    allocated += amount;
    lines.push({ bucket: rule.bucket, amount: fromCents(amount), percent: Number(rule.percent), capped });
  }

  const overflowAmount = profitCents - allocated;
  lines.push({ bucket: overflowRule.bucket, amount: fromCents(overflowAmount), percent: Number(overflowRule.percent), capped: overflow > 0 });
  return { lines, total: fromCents(profitCents), warning };
}

export type PaymentRisk = 'standard' | 'high' | 'blocked';

// Every payment still needs the CEO's tap; this only decides how loudly to warn and
// whether the daily safety cap forbids creating the request at all.
export function classifyPaymentRisk(amount: number, options: { paidTodayTotal?: number; highThreshold?: number; dailyCap?: number } = {}): PaymentRisk {
  const { paidTodayTotal = 0, highThreshold = 20000, dailyCap = 100000 } = options;
  if (!Number.isFinite(amount) || amount <= 0) return 'blocked';
  if (paidTodayTotal + amount > dailyCap) return 'blocked';
  return amount >= highThreshold ? 'high' : 'standard';
}

export interface LedgerRow {
  entry_type: 'income' | 'expense';
  category: string;
  project_name: string | null;
  amount: number;
}

export interface PeriodReport {
  income: number;
  expenses: number;
  net: number;
  marginPercent: number;
  expensesByCategory: Record<string, number>;
  byProject: Array<{ project: string; income: number; expenses: number; net: number }>;
}

export function buildPeriodReport(rows: LedgerRow[]): PeriodReport {
  let income = 0;
  let expenses = 0;
  const expensesByCategory: Record<string, number> = {};
  const projects = new Map<string, { income: number; expenses: number }>();

  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const key = row.project_name || 'Unassigned';
    const project = projects.get(key) || { income: 0, expenses: 0 };
    if (row.entry_type === 'income') {
      income += amount;
      project.income += amount;
    } else {
      expenses += amount;
      project.expenses += amount;
      expensesByCategory[row.category] = (expensesByCategory[row.category] || 0) + amount;
    }
    projects.set(key, project);
  }

  const round = (value: number) => Number(value.toFixed(2));
  return {
    income: round(income),
    expenses: round(expenses),
    net: round(income - expenses),
    marginPercent: income > 0 ? round(((income - expenses) / income) * 100) : 0,
    expensesByCategory: Object.fromEntries(Object.entries(expensesByCategory).map(([key, value]) => [key, round(value)])),
    byProject: [...projects.entries()]
      .map(([project, value]) => ({ project, income: round(value.income), expenses: round(value.expenses), net: round(value.income - value.expenses) }))
      .sort((a, b) => b.net - a.net),
  };
}

export function checkQuoteMargin(quotePrice: number, totalCost: number, targetMarginPercent = 30) {
  const price = Number(quotePrice);
  const cost = Number(totalCost);
  if (!Number.isFinite(price) || price <= 0) return { marginPercent: 0, ok: false, minimumPrice: 0 };
  const marginPercent = Number((((price - cost) / price) * 100).toFixed(2));
  const minimumPrice = Number((cost / (1 - targetMarginPercent / 100)).toFixed(2));
  return { marginPercent, ok: marginPercent >= targetMarginPercent, minimumPrice };
}

export function forecastRunwayDays(cashOnHand: number, expensesLast30Days: number) {
  const dailyBurn = expensesLast30Days / 30;
  if (dailyBurn <= 0) return null;
  return Math.floor(cashOnHand / dailyBurn);
}

export function findDuplicateReferences(rows: Array<{ id: string; reference: string | null }>) {
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const ref = row.reference?.trim();
    if (!ref) continue;
    seen.set(ref, [...(seen.get(ref) || []), row.id]);
  }
  return [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([reference, ids]) => ({ reference, ids }));
}

export function formatPeso(value: number) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function manilaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).split('-');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

export function periodRange(period: string): { start: string; end: string } | null {
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const year = Number(month[1]);
    const m = Number(month[2]);
    if (m < 1 || m > 12) return null;
    const next = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
    return { start: `${year}-${month[2]}-01`, end: next };
  }
  const year = period.match(/^(\d{4})$/);
  if (year) return { start: `${year[1]}-01-01`, end: `${Number(year[1]) + 1}-01-01` };
  return null;
}
