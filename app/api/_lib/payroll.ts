import { manilaDateParts } from './finance-logic';
import { recordLedgerEntry } from './ceo-finance';
import {
  clockInStaff,
  clockOutStaff,
  escapeTelegramHtml,
  getSupabaseAdmin,
  reportCriticalError,
  sendTelegramMessage,
} from './integrations';
import {
  buildAttendanceLine,
  derivedPerMinuteRate,
  formatPayrollText,
  isSaturday,
  isSemiMonthlyPayday,
  latestClosedSemiMonthly,
  latestSaturdayWeek,
  parseAttendanceText,
  periodInstants,
  roundPeso,
  sumTotal,
  toDateString,
  type PayPeriod,
  type PayrollLine,
} from './payroll-logic';

type Kind = 'employee' | 'sewer' | 'subcon';

type Worker = {
  name: string;
  kind: Kind;
  monthly_salary: number | null;
  per_minute_rate: number | null;
  telegram_user_id: string | null;
  aliases: string[] | null;
};

type RunResult = { created: boolean; runId?: string; total?: number; error?: string | null };

const manilaToday = () => manilaDateParts();

// ---------------- Workers ----------------

export async function upsertWorker(input: {
  name: string;
  kind?: Kind;
  monthlySalary?: number | null;
  perMinuteRate?: number | null;
  telegramUserId?: string | null;
  aliases?: string[];
  active?: boolean;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const name = input.name.trim();
  if (!name) return { data: null, error: 'name is required' };
  const row: Record<string, unknown> = { name };
  if (input.kind) row.kind = input.kind;
  if (input.monthlySalary !== undefined) row.monthly_salary = input.monthlySalary;
  if (input.perMinuteRate !== undefined) row.per_minute_rate = input.perMinuteRate;
  if (input.telegramUserId !== undefined) row.telegram_user_id = input.telegramUserId;
  if (input.aliases) row.aliases = input.aliases;
  if (input.active !== undefined) row.active = input.active;
  const { data, error } = await supabase.from('payroll_workers').upsert(row, { onConflict: 'name' }).select().single();
  return { data, error: error?.message || null };
}

async function findWorkerByName(name: string): Promise<Worker | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const wanted = name.trim().toLowerCase();
  const { data } = await supabase.from('payroll_workers').select('*').eq('active', true);
  return ((data || []) as Worker[]).find((worker) =>
    worker.name.toLowerCase() === wanted || (worker.aliases || []).some((alias) => alias.toLowerCase() === wanted)) || null;
}

// ---------------- "ATTENDANCE GC" time in / time out ----------------

export function isAttendanceChat(chatId: unknown) {
  return Boolean(process.env.TELEGRAM_ATTENDANCE_CHAT_ID && String(chatId) === process.env.TELEGRAM_ATTENDANCE_CHAT_ID);
}

type TelegramSender = { id?: number | string; first_name?: string; last_name?: string; username?: string };

// Returns a reply for the group, or null when the message is not a time in/out.
export async function handleAttendanceMessage(text: string, sender: TelegramSender | undefined): Promise<string | null> {
  const action = parseAttendanceText(text);
  if (!action || !sender?.id) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Attendance is unavailable: Supabase is not configured.';

  const userId = String(sender.id);
  const fullName = [sender.first_name, sender.last_name].filter(Boolean).join(' ').trim();
  let worker = ((await supabase.from('payroll_workers').select('*').eq('telegram_user_id', userId).maybeSingle()).data || null) as Worker | null;

  if (!worker) {
    for (const candidate of [fullName, sender.first_name, sender.username]) {
      const found = candidate ? await findWorkerByName(candidate) : null;
      if (found) {
        worker = found;
        await supabase.from('payroll_workers').update({ telegram_user_id: userId }).eq('name', found.name);
        break;
      }
    }
  }

  let registered = false;
  if (!worker) {
    // Staff already clocked via IN/OUT keep their own profile; everyone else is auto-registered as an employee.
    const name = fullName || sender.username || `User ${userId}`;
    const created = await upsertWorker({ name, kind: 'employee', telegramUserId: userId });
    if (created.error) return `Could not register ${name}: ${created.error}`;
    worker = created.data as Worker;
    registered = true;
  }

  const result = action === 'IN' ? await clockInStaff(worker.name) : await clockOutStaff(worker.name);
  if (result.error) return result.error;
  const record = result.data as { time_in?: string; total_minutes?: number } | null;
  const at = new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
  const suffix = registered ? ' (new employee registered - boss, please set their salary/role)' : '';
  if (action === 'IN') return `TIME IN: ${worker.name} at ${at}${suffix}`;
  const minutes = Number(record?.total_minutes || 0);
  return `TIME OUT: ${worker.name} at ${at} - ${Math.floor(minutes / 60)}h ${minutes % 60}m${suffix}`;
}

// ---------------- Payroll runs ----------------

async function attendanceMinutes(period: PayPeriod) {
  const supabase = getSupabaseAdmin();
  const minutes = new Map<string, number>();
  const open: string[] = [];
  if (!supabase) return { minutes, open };
  const { from, to } = periodInstants(period);
  const { data } = await supabase.from('staff_attendance').select('staff_name, total_minutes, time_out').gte('time_in', from).lt('time_in', to);
  for (const row of data || []) {
    const key = String(row.staff_name).toLowerCase();
    if (!row.time_out) {
      open.push(String(row.staff_name));
      continue;
    }
    minutes.set(key, (minutes.get(key) || 0) + Number(row.total_minutes || 0));
  }
  return { minutes, open };
}

async function saveRun(kind: Kind, period: PayPeriod, subjectKey: string, title: string, lines: PayrollLine[], notes: string[]): Promise<RunResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { created: false, error: 'Supabase is not configured' };
  const total = sumTotal(lines);
  const { data, error } = await supabase.from('payroll_runs').insert({
    kind, period_start: period.start, period_end: period.end, subject_key: subjectKey,
    label: period.label, total, lines, notes,
  }).select('id').single();
  if (error?.code === '23505') return { created: false };
  if (error || !data) return { created: false, error: error?.message || 'Insert failed' };
  void sendTelegramMessage(`💵 <b>${escapeTelegramHtml(title)}</b>\n<pre>${escapeTelegramHtml(formatPayrollText(title, period.label, lines, total, notes))}</pre>\nRun ID: <code>${data.id}</code>\nReply <code>PAYROLL PAID ${String(data.id).slice(0, 8)}</code> once released.`);
  return { created: true, runId: data.id, total };
}

// Every employee: 1st-15th (run on the 16th) and 16th-end (run on the 1st), paid from attendance in "ATTENDANCE GC".
export async function generateEmployeePayroll(period: PayPeriod): Promise<RunResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { created: false, error: 'Supabase is not configured' };
  const [{ data: workers }, { data: profiles }, { minutes, open }] = await Promise.all([
    supabase.from('payroll_workers').select('*').eq('active', true).eq('kind', 'employee'),
    supabase.from('staff_profiles').select('staff_name, per_minute_rate'),
    attendanceMinutes(period),
  ]);
  const rates = new Map<string, number | null>();
  for (const profile of profiles || []) rates.set(String(profile.staff_name).toLowerCase(), Number(profile.per_minute_rate) || null);
  const names = new Map<string, string>();
  for (const profile of profiles || []) names.set(String(profile.staff_name).toLowerCase(), String(profile.staff_name));
  for (const worker of (workers || []) as Worker[]) {
    names.set(worker.name.toLowerCase(), worker.name);
    const own = Number(worker.per_minute_rate) || (worker.monthly_salary ? derivedPerMinuteRate(Number(worker.monthly_salary)) : 0);
    if (own) rates.set(worker.name.toLowerCase(), own);
  }
  const lines = [...names.entries()]
    .map(([key, name]) => buildAttendanceLine(name, minutes.get(key) || 0, rates.get(key) || null))
    .filter((line) => (line.minutes || 0) > 0 || line.attendancePay);
  const notes = open.length ? [`Open time-in with no time-out (not paid): ${[...new Set(open)].join(', ')}`] : [];
  return saveRun('employee', period, '', 'MJIC EMPLOYEE PAYROLL', lines, notes);
}

// Sewers: weekly (Sunday-Saturday). Pay = piece-rate output + attendance minutes when they have a per-minute rate.
export async function generateSewerPayroll(period: PayPeriod): Promise<RunResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { created: false, error: 'Supabase is not configured' };
  const [{ data: workers }, { data: pieces }, { minutes, open }] = await Promise.all([
    supabase.from('payroll_workers').select('*').eq('active', true).eq('kind', 'sewer'),
    supabase.from('sewer_output').select('worker_name, quantity, amount').gte('work_date', period.start).lte('work_date', period.end),
    attendanceMinutes(period),
  ]);
  const byName = new Map<string, PayrollLine>();
  const ensure = (name: string) => {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, total: 0 });
    return byName.get(key)!;
  };
  for (const worker of (workers || []) as Worker[]) {
    const mins = minutes.get(worker.name.toLowerCase()) || 0;
    const rate = Number(worker.per_minute_rate) || (worker.monthly_salary ? derivedPerMinuteRate(Number(worker.monthly_salary)) : 0);
    const line = ensure(worker.name);
    line.minutes = mins;
    line.attendancePay = rate ? roundPeso(mins * rate) : 0;
  }
  for (const piece of pieces || []) {
    const line = ensure(String(piece.worker_name));
    line.pieceCount = (line.pieceCount || 0) + Number(piece.quantity);
    line.piecePay = roundPeso((line.piecePay || 0) + Number(piece.amount));
  }
  const lines = [...byName.values()]
    .map((line) => ({ ...line, total: roundPeso((line.attendancePay || 0) + (line.piecePay || 0)) }))
    .filter((line) => line.total > 0 || (line.pieceCount || 0) > 0);
  const notes = open.length ? [`Open time-in with no time-out (not paid): ${[...new Set(open)].join(', ')}`] : [];
  return saveRun('sewer', period, '', 'MJIC SEWER WEEKLY PAYROLL', lines, notes);
}

// ---------------- Subcon (per project) ----------------

export async function addSubconJob(input: { subconName: string; amount: number; jobRef?: string; orderId?: string; description?: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  if (!input.subconName.trim() || !(input.amount > 0)) return { data: null, error: 'subconName and a positive amount are required' };
  const { data, error } = await supabase.from('subcon_jobs').insert({
    subcon_name: input.subconName.trim(), amount: input.amount, job_ref: input.jobRef || null,
    order_id: input.orderId || null, description: input.description || null,
  }).select().single();
  return { data, error: error?.message || null };
}

type SubconJob = { id: string; subcon_name: string; job_ref: string | null; amount: number; status: string };

async function payoutSubconJob(job: SubconJob): Promise<RunResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { created: false, error: 'Supabase is not configured' };
  const { data: claimed } = await supabase.from('subcon_jobs')
    .update({ status: 'DONE', completed_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'OPEN').select('id').maybeSingle();
  if (!claimed) return { created: false };
  const today = toDateString(manilaToday());
  const period: PayPeriod = { start: today, end: today, label: `Project ${job.job_ref || job.id.slice(0, 8)} - ${today}` };
  const line: PayrollLine = { name: job.subcon_name, total: roundPeso(Number(job.amount)), ...(job.job_ref ? { note: job.job_ref } : {}) };
  return saveRun('subcon', period, job.id, 'MJIC SUBCON PAYROLL', [line], []);
}

// Marks one project done (by job id, or by an exact job_ref / unique id prefix) and generates the subcon payroll.
export async function completeSubconJob(idOrRef: string): Promise<{ result: RunResult | null; error: string | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { result: null, error: 'Supabase is not configured' };
  const { data } = await supabase.from('subcon_jobs').select('*').eq('status', 'OPEN');
  const key = idOrRef.trim().toLowerCase();
  const matches = ((data || []) as SubconJob[]).filter((job) => job.id.toLowerCase().startsWith(key) || (job.job_ref || '').toLowerCase() === key);
  if (matches.length !== 1) return { result: null, error: matches.length ? 'More than one open job matches - use the full id.' : 'No open subcon job matches.' };
  return { result: await payoutSubconJob(matches[0]), error: null };
}

// Called when an order is DELIVERED: every open subcon job on that order is paid out.
export async function completeSubconJobsForOrder(orderId: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const { data } = await supabase.from('subcon_jobs').select('*').eq('order_id', orderId).eq('status', 'OPEN');
  let created = 0;
  for (const job of (data || []) as SubconJob[]) {
    try {
      if ((await payoutSubconJob(job)).created) created += 1;
    } catch (error) {
      await reportCriticalError('subcon-payroll', error, { jobId: job.id });
    }
  }
  return created;
}

// ---------------- Sewer piece entries ----------------

export async function logSewerOutput(input: { workerName: string; quantity: number; rate: number; item?: string; workDate?: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const worker = await findWorkerByName(input.workerName);
  if (!worker || worker.kind !== 'sewer') return { data: null, error: `${input.workerName} is not a registered sewer. Add them with kind "sewer" first.` };
  const { data, error } = await supabase.from('sewer_output').insert({
    worker_name: worker.name, quantity: input.quantity, rate: input.rate, item: input.item || null,
    ...(input.workDate ? { work_date: input.workDate } : {}),
  }).select().single();
  return { data, error: error?.message || null };
}

// ---------------- Scheduler entry + paid ----------------

// Safe to call daily: Saturday -> sewers; latest closed 1st/16th period -> employees. Existing runs are never duplicated.
export async function runDuePayroll(options: { force?: Kind } = {}) {
  const today = manilaToday();
  const out: Record<string, RunResult> = {};
  if (options.force === 'sewer' || (!options.force && isSaturday(today))) out.sewer = await generateSewerPayroll(latestSaturdayWeek(today));
  if (options.force === 'employee' || (!options.force && isSemiMonthlyPayday(today))) out.employee = await generateEmployeePayroll(latestClosedSemiMonthly(today));
  return out;
}

export async function markPayrollPaid(idOrPrefix: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, message: 'Supabase is not configured' };
  const { data: runs } = await supabase.from('payroll_runs').select('*').eq('status', 'DRAFT');
  const key = idOrPrefix.trim().toLowerCase();
  const matches = (runs || []).filter((run) => String(run.id).toLowerCase().startsWith(key));
  if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one run matches - use more of the id.' : 'No unpaid payroll run matches that id.' };
  const run = matches[0];
  const { data: claimed } = await supabase.from('payroll_runs').update({ status: 'PAID', paid_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'DRAFT').select('id').maybeSingle();
  if (!claimed) return { ok: false, message: 'Already marked paid.' };

  // Salaried staff with a staff_profiles row are already booked by the monthly payroll accrual; skip them to avoid double counting.
  const { data: profiles } = await supabase.from('staff_profiles').select('staff_name');
  const accrued = new Set((profiles || []).map((profile) => String(profile.staff_name).toLowerCase()));
  const category = run.kind === 'subcon' ? 'subcontract' : run.kind === 'sewer' ? 'sewer_labor' : 'salaries';
  for (const line of (run.lines || []) as PayrollLine[]) {
    if (line.total <= 0 || (run.kind === 'employee' && accrued.has(line.name.toLowerCase()))) continue;
    await recordLedgerEntry({
      type: 'expense', category, amount: line.total, description: `${run.kind} payroll ${run.label}: ${line.name}`,
      source: 'payroll', reference: `payrun:${run.id}:${line.name}`, entryDate: run.period_end,
    });
  }
  return { ok: true, message: `Marked paid: ${run.kind} payroll ${run.label} (P${Number(run.total).toLocaleString('en-PH')}).` };
}
