// Pure payroll helpers. All dates are Manila calendar dates as YYYY-MM-DD strings.

export type ManilaDate = { year: number; month: number; day: number };

const pad = (value: number) => String(value).padStart(2, '0');
export const toDateString = (date: ManilaDate) => `${date.year}-${pad(date.month)}-${pad(date.day)}`;

function fromUtc(ms: number): ManilaDate {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
const toUtc = (date: ManilaDate) => Date.UTC(date.year, date.month - 1, date.day);
const DAY_MS = 86400000;

export function addDays(date: ManilaDate, days: number): ManilaDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

// 0 = Sunday ... 6 = Saturday
export function weekday(date: ManilaDate) {
  return new Date(toUtc(date)).getUTCDay();
}

export type PayPeriod = { start: string; end: string; label: string };

// Most recent fully closed 1st-15th / 16th-end period as of `today`.
export function latestClosedSemiMonthly(today: ManilaDate): PayPeriod {
  if (today.day >= 16) {
    const start = { ...today, day: 1 };
    const end = { ...today, day: 15 };
    return { start: toDateString(start), end: toDateString(end), label: `${toDateString(start)} to ${toDateString(end)}` };
  }
  const lastOfPrev = addDays({ ...today, day: 1 }, -1);
  const start = { ...lastOfPrev, day: 16 };
  return { start: toDateString(start), end: toDateString(lastOfPrev), label: `${toDateString(start)} to ${toDateString(lastOfPrev)}` };
}

// Sunday-Saturday week ending on the most recent Saturday on or before `today`.
export function latestSaturdayWeek(today: ManilaDate): PayPeriod {
  const end = addDays(today, -((weekday(today) + 1) % 7));
  const start = addDays(end, -6);
  return { start: toDateString(start), end: toDateString(end), label: `Week ${toDateString(start)} to ${toDateString(end)}` };
}

export const isSaturday = (today: ManilaDate) => weekday(today) === 6;
export const isSemiMonthlyPayday = (today: ManilaDate) => today.day === 1 || today.day === 16;

// [start 00:00, end+1 00:00) in Manila time, as ISO instants.
export function periodInstants(period: PayPeriod) {
  const [y, m, d] = period.end.split('-').map(Number);
  const nextDay = toDateString(addDays({ year: y, month: m, day: d }, 1));
  return { from: `${period.start}T00:00:00+08:00`, to: `${nextDay}T00:00:00+08:00` };
}

// Matches the existing staff_profiles basis (26 working days, 10-hour day).
export function derivedPerMinuteRate(monthlySalary: number) {
  return monthlySalary / 26 / 10 / 60;
}

export const roundPeso = (value: number) => Math.round(value * 100) / 100;

export type PayrollLine = {
  name: string;
  minutes?: number;
  attendancePay?: number;
  pieceCount?: number;
  piecePay?: number;
  note?: string;
  total: number;
};

export function buildAttendanceLine(name: string, minutes: number, perMinuteRate: number | null): PayrollLine {
  const attendancePay = perMinuteRate ? roundPeso(minutes * perMinuteRate) : 0;
  return {
    name,
    minutes,
    attendancePay,
    total: attendancePay,
    ...(perMinuteRate ? {} : { note: 'No rate set - attendance logged but unpaid until a salary/rate is set' }),
  };
}

export function sumTotal(lines: PayrollLine[]) {
  return roundPeso(lines.reduce((sum, line) => sum + line.total, 0));
}

const peso = (value: number) => `P${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;

export function formatPayrollText(title: string, label: string, lines: PayrollLine[], total: number, notes: string[]) {
  const body = lines.map((line) => {
    const parts: string[] = [];
    if (line.minutes !== undefined) parts.push(hours(line.minutes));
    if (line.pieceCount) parts.push(`${line.pieceCount} pcs`);
    return `- ${line.name}${parts.length ? ` (${parts.join(', ')})` : ''}: ${peso(line.total)}${line.note ? ` - ${line.note}` : ''}`;
  });
  return [`${title}`, label, ...(body.length ? body : ['- No payable entries']), `TOTAL: ${peso(total)}`, ...notes].join('\n');
}

export type SubconPayrollRun = {
  id: string;
  kind: string;
  subject_key: string;
  period_start: string;
  period_end: string;
};

export type SubconPayoutResult = { created: boolean; runId?: string; total?: number; error?: string | null };

// Coordinates recoverable subcontractor payout without tying this logic to Supabase.
// The injected reservation must atomically set completed_at only if it is null and
// return the persisted value, including when another caller already reserved it.
export async function finalizeSubconPayout(input: {
  jobId: string;
  completionAt: string | null;
  line: PayrollLine;
}, dependencies: {
  reserveCompletionAt(jobId: string): Promise<{ value: string | null; error?: string | null }>;
  findExistingRun(jobId: string): Promise<{ run: SubconPayrollRun | null; error?: string | null }>;
  periodForCompletion(completionAt: string): PayPeriod;
  saveRun(period: PayPeriod, line: PayrollLine): Promise<SubconPayoutResult>;
  closeJob(jobId: string): Promise<{ error?: string | null }>;
}): Promise<SubconPayoutResult> {
  let completionAt = input.completionAt;
  if (!completionAt) {
    const reservation = await dependencies.reserveCompletionAt(input.jobId);
    if (reservation.error) return { created: false, error: `Could not reserve subcontractor completion time: ${reservation.error}` };
    completionAt = reservation.value;
    if (!completionAt) return { created: false, error: 'Could not reserve or recover subcontractor completion time.' };
  }

  const existing = await dependencies.findExistingRun(input.jobId);
  if (existing.error) return { created: false, error: `Could not check for an existing subcontractor payroll run: ${existing.error}` };

  let payout: SubconPayoutResult;
  if (existing.run) {
    if (existing.run.kind !== 'subcon' || existing.run.subject_key !== input.jobId || !existing.run.id) {
      return { created: false, error: 'Existing payroll run does not match this subcontractor job; job remains open.' };
    }
    payout = { created: false, runId: existing.run.id };
  } else {
    payout = await dependencies.saveRun(dependencies.periodForCompletion(completionAt), input.line);
    if (payout.error) return payout;
    if (!payout.runId) return { created: false, error: 'Payroll save did not confirm a matching run; job remains open.' };
  }

  const closed = await dependencies.closeJob(input.jobId);
  if (closed.error) return { ...payout, error: `Payroll run ${payout.runId} is confirmed, but subcontractor job could not be marked done: ${closed.error}` };
  return payout;
}

// "time in", "time-out", "in", "out" (case-insensitive) -> clock action; anything else -> null.
export function parseAttendanceText(text: string): 'IN' | 'OUT' | null {
  const match = text.trim().toLowerCase().match(/^(?:time[\s-]*)?(in|out)\b/);
  if (!match) return null;
  return match[1] === 'in' ? 'IN' : 'OUT';
}
