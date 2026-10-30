import { QUOTA_PERIODS, quotaWindow, type QuotaKind } from './production-quota-logic.ts';

// Quota engine: daily quota = period total target / operating days in that period.
// Operating days = Monday to Saturday (Sunday is a rest day). Pure logic; dates are Manila YYYY-MM-DD.

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const isoFromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function operatingDaysBetween(start: string, end: string) {
  let count = 0;
  for (let ms = toUtc(start); ms <= toUtc(end); ms += 86_400_000) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0) count += 1;
  }
  return count;
}

// Full calendar span of the period that contains `today` (quotaWindow only runs to today; the formula needs the whole span).
export function fullPeriodWindow(kind: QuotaKind, today: string): { start: string; end: string } {
  const window = quotaWindow(kind, today);
  if (kind === 'daily' || kind === 'week' || kind === 'half_month') return window;
  const months = QUOTA_PERIODS.find((period) => period.kind === kind)?.months || 1;
  const [year, month] = window.start.split('-').map(Number);
  const lastDay = isoFromUtc(Date.UTC(year, month - 1 + months, 0));
  return { start: window.start, end: lastDay };
}

// Rounded to one decimal so the figure reads cleanly on Telegram.
export function dailyQuotaFromTarget(targetPcs: number | null | undefined, operatingDays: number) {
  if (targetPcs === null || targetPcs === undefined || !(operatingDays > 0)) return null;
  return Math.round((Number(targetPcs) / operatingDays) * 10) / 10;
}

export type DailyQuotaSource = { kind: QuotaKind; targetPcs: number; operatingDays: number; dailyPcs: number };

// Uses the most specific configured target (daily first, then week, half-month, month, ...).
export function resolveDailyQuota(
  today: string,
  targets: Array<{ period_kind: string; target_pcs: number | null }>,
): { dailyPcs: number | null; source: DailyQuotaSource | null; isOperatingDay: boolean } {
  const isOperatingDay = new Date(`${today}T00:00:00Z`).getUTCDay() !== 0;
  for (const period of QUOTA_PERIODS) {
    const target = targets.find((row) => row.period_kind === period.kind);
    if (!target || target.target_pcs === null || target.target_pcs === undefined) continue;
    const { start, end } = fullPeriodWindow(period.kind, today);
    const operatingDays = operatingDaysBetween(start, end);
    const dailyPcs = dailyQuotaFromTarget(target.target_pcs, operatingDays);
    if (dailyPcs === null) continue;
    return { dailyPcs, source: { kind: period.kind, targetPcs: Number(target.target_pcs), operatingDays, dailyPcs }, isOperatingDay };
  }
  return { dailyPcs: null, source: null, isOperatingDay };
}

// Full quota schedule for the dashboard: each period's per-day quota derived from its total target.
export function buildQuotaFormulaRows(today: string, targets: Array<{ period_kind: string; target_pcs: number | null }>) {
  return QUOTA_PERIODS.map((period) => {
    const { start, end } = fullPeriodWindow(period.kind, today);
    const operatingDays = operatingDaysBetween(start, end);
    const target = targets.find((row) => row.period_kind === period.kind);
    const targetPcs = target?.target_pcs ?? null;
    return { kind: period.kind, label: period.label, start, end, operatingDays, targetPcs, dailyPcs: dailyQuotaFromTarget(targetPcs, operatingDays) };
  });
}
