import { createHash } from 'node:crypto';

import {
  allocateProfit,
  aggregatePayrollAccruals,
  buildPeriodReport,
  classifyPaymentRisk,
  formatPeso,
  manilaDateParts,
  periodRange,
  type AllocationLine,
  type AllocationRule,
} from './finance-logic';
import {
  enqueueOutboundRequest,
  escapeTelegramHtml,
  fetchWithRetry,
  getSupabaseAdmin,
  reportCriticalError,
  sendTelegramMessage,
} from './integrations';

const HIGH_RISK_THRESHOLD = () => Number(process.env.PAYMENT_HIGH_RISK_THRESHOLD || 20000);
const DAILY_CAP = () => Number(process.env.PAYMENT_DAILY_CAP || 100000);

function manilaToday() {
  const { year, month, day } = manilaDateParts();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function currentPeriod() {
  const { year, month } = manilaDateParts();
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ---------------- Ledger ----------------

export async function recordLedgerEntry(entry: {
  type: 'income' | 'expense';
  category: string;
  amount: number;
  projectName?: string | null;
  description?: string | null;
  source?: string;
  reference?: string | null;
  entryDate?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const amount = Number(entry.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { data: null, error: 'Amount must be a positive number' };
  const row = {
    entry_type: entry.type,
    category: entry.category.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60) || 'uncategorized',
    project_name: entry.projectName?.trim() || null,
    amount,
    description: entry.description?.slice(0, 500) || null,
    source: entry.source || 'manual',
    reference: entry.reference || null,
    ...(entry.entryDate ? { entry_date: entry.entryDate } : {}),
  };
  // A repeated reference is the idempotency guard: the same event can never be booked twice.
  const { data, error } = await supabase.from('ledger_entries').insert(row).select().single();
  if (error?.code === '23505') return { data: null, error: null, duplicate: true };
  return { data, error: error?.message || null };
}

export async function getPeriodReport(period: string) {
  const supabase = getSupabaseAdmin();
  const range = periodRange(period);
  if (!supabase || !range) return { report: null, error: !range ? 'period must be YYYY-MM or YYYY' : 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('ledger_entries')
    .select('entry_type, category, project_name, amount')
    .gte('entry_date', range.start)
    .lt('entry_date', range.end);
  if (error) return { report: null, error: error.message };
  return { report: buildPeriodReport((data || []).map((row) => ({ ...row, amount: Number(row.amount) })) as Parameters<typeof buildPeriodReport>[0]), error: null };
}

export async function getCashBalance() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data } = await supabase.from('ledger_entries').select('entry_type, amount');
  if (!data) return null;
  return data.reduce((sum, row) => sum + (row.entry_type === 'income' ? 1 : -1) * Number(row.amount), 0);
}

// Books each staff member's accrued payroll for a month as an expense (idempotent per staff+month).
export async function accruePayrollToLedger(period: string) {
  const supabase = getSupabaseAdmin();
  const range = periodRange(period);
  if (!supabase || !range) return { booked: 0 };
  const [{ data: sewerWorkers, error: sewerWorkersError }, { data: attendance, error: attendanceError }] = await Promise.all([
    supabase.from('payroll_workers').select('name').eq('kind', 'sewer'),
    supabase
      .from('staff_attendance')
      .select('staff_name, total_earned, time_in')
      .gte('time_in', `${range.start}T00:00:00+08:00`)
      .lt('time_in', `${range.end}T00:00:00+08:00`),
  ]);
  // Fail closed rather than risk double-booking sewer labor if we cannot identify
  // the workers whose attendance is included in their separate sewer payroll run.
  if (sewerWorkersError || attendanceError) return { booked: 0 };
  const totals = aggregatePayrollAccruals(
    (attendance || []).map((row) => ({ staff_name: String(row.staff_name), total_earned: Number(row.total_earned || 0) })),
    new Set((sewerWorkers || []).map((worker) => String(worker.name))),
  );
  let booked = 0;
  for (const [staff, total] of totals) {
    if (total <= 0) continue;
    const result = await recordLedgerEntry({
      type: 'expense', category: 'salaries', amount: total, description: `Payroll accrual ${period}: ${staff}`,
      source: 'payroll', reference: `payroll:${period}:${staff}`, entryDate: lastDayOf(period),
    });
    if (result.data) booked += 1;
  }
  return { booked };
}

function lastDayOf(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

// ---------------- Payments (always CEO-approved) ----------------

async function paidTodayTotal() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const { data } = await supabase
    .from('payment_requests')
    .select('amount')
    .in('status', ['APPROVED', 'AWAITING_MANUAL_PAYMENT', 'PAID', 'PENDING_APPROVAL'])
    .gte('created_at', `${manilaToday()}T00:00:00+08:00`);
  return (data || []).reduce((sum, row) => sum + Number(row.amount), 0);
}

export async function createPaymentRequest(input: {
  payee: string;
  amount: number;
  purpose: string;
  category?: string;
  projectName?: string | null;
  payeeDetails?: string | null;
  requestedBy?: string;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const amount = Number(Number(input.amount).toFixed(2));
  const risk = classifyPaymentRisk(amount, { paidTodayTotal: await paidTodayTotal(), highThreshold: HIGH_RISK_THRESHOLD(), dailyCap: DAILY_CAP() });
  if (risk === 'blocked') return { data: null, error: `Blocked by safety limits (daily cap ${formatPeso(DAILY_CAP())}). Ask the CEO to raise PAYMENT_DAILY_CAP if this is intended.` };

  const idempotencyKey = createHash('sha256').update(`${input.payee.toLowerCase()}|${amount}|${input.purpose.toLowerCase()}|${manilaToday()}`).digest('hex').slice(0, 40);
  const { data, error } = await supabase.from('payment_requests').insert({
    payee: input.payee.slice(0, 120),
    amount,
    purpose: input.purpose.slice(0, 300),
    category: (input.category || 'operations').toLowerCase().replace(/\s+/g, '_').slice(0, 60),
    project_name: input.projectName || null,
    payee_details: input.payeeDetails?.slice(0, 300) || null,
    risk_tier: risk,
    requested_by: input.requestedBy || 'AI',
    idempotency_key: idempotencyKey,
  }).select().single();

  if (error?.code === '23505') {
    const { data: existing } = await supabase.from('payment_requests').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    return { data: existing, error: null, duplicate: true };
  }
  if (error || !data) return { data: null, error: error?.message || 'Could not create payment request' };

  const warning = risk === 'high' ? '\n⚠️ <b>HIGH AMOUNT — double-check before approving.</b>' : '';
  await sendTelegramMessage(
    `💸 <b>PAYMENT APPROVAL</b>\nPayee: <b>${escapeTelegramHtml(data.payee)}</b>\nAmount: <b>${formatPeso(amount)}</b>\nFor: ${escapeTelegramHtml(data.purpose)}${data.project_name ? `\nProject: ${escapeTelegramHtml(data.project_name)}` : ''}${warning}`,
    { inline_keyboard: [[{ text: '✅ Approve & pay', callback_data: `pay:approve:${data.id}` }, { text: '❌ Reject', callback_data: `pay:reject:${data.id}` }]] },
  );
  return { data, error: null, duplicate: false };
}

export async function decidePayment(id: string, decision: 'approve' | 'reject', actor: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { message: 'Supabase is not configured', ok: false };
  const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
  // Atomic claim: only a request still pending can be decided, so a double-tap cannot double-pay.
  const { data: claimed } = await supabase
    .from('payment_requests')
    .update({ status, decided_by: actor, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'PENDING_APPROVAL')
    .select()
    .maybeSingle();
  if (!claimed) return { message: 'This payment was already handled or does not exist.', ok: false };
  if (decision === 'reject') return { message: `Rejected: ${formatPeso(claimed.amount)} to ${claimed.payee}.`, ok: true };
  return { message: await executePayment(claimed.id), ok: true };
}

async function bookPaidPayment(request: { id: string; amount: number; category: string; project_name: string | null; payee: string; purpose: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  await supabase.from('payment_requests').update({ status: 'PAID', paid_at: new Date().toISOString() }).eq('id', request.id);
  // Salaries are already booked by the monthly payroll accrual; booking again would double-count.
  if (request.category !== 'salaries') {
    await recordLedgerEntry({
      type: 'expense', category: request.category, amount: Number(request.amount), projectName: request.project_name,
      description: `${request.payee}: ${request.purpose}`, source: 'payment_request', reference: `pay:${request.id}`,
    });
  }
}

// Sends the payout to a configured provider (any HTTPS endpoint, e.g. a bank/e-wallet payout API or
// a Make/Zapier hook). Without a provider, it falls back to a manual-pay checklist for the CEO.
export async function executePayment(id: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Supabase is not configured';
  const { data: request } = await supabase.from('payment_requests').select('*').eq('id', id).maybeSingle();
  if (!request) return 'Payment request not found.';
  if (request.status === 'PAID') return `Already paid: ${formatPeso(request.amount)} to ${request.payee}.`;
  if (!['APPROVED', 'FAILED'].includes(request.status)) return `Cannot pay a request that is ${request.status}.`;

  const apiUrl = process.env.PAYOUT_API_URL;
  const apiToken = process.env.PAYOUT_API_TOKEN;
  if (!apiUrl || !apiToken) {
    await supabase.from('payment_requests').update({ status: 'AWAITING_MANUAL_PAYMENT' }).eq('id', id);
    await sendTelegramMessage(
      `🧾 <b>PAY NOW (manual)</b>\nPayee: <b>${escapeTelegramHtml(request.payee)}</b>\nAmount: <b>${formatPeso(request.amount)}</b>\nDetails: ${escapeTelegramHtml(request.payee_details || 'no payee details saved')}\nTap the button after you send it so the books are updated.`,
      { inline_keyboard: [[{ text: '✅ Mark as paid', callback_data: `pay:paid:${id}` }]] },
    );
    return `Approved ${formatPeso(request.amount)} to ${request.payee}. Auto-payout is not configured yet, so I sent you the pay-now details.`;
  }

  const response = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': request.id },
    body: JSON.stringify({ id: request.id, payee: request.payee, payee_details: request.payee_details, amount: Number(request.amount), currency: 'PHP', purpose: request.purpose }),
  }, 1);
  const providerResponse = await response?.json().catch(() => null);
  if (response?.ok) {
    await supabase.from('payment_requests').update({ provider_response: providerResponse }).eq('id', id);
    await bookPaidPayment(request);
    return `Paid ${formatPeso(request.amount)} to ${request.payee}. ✅`;
  }

  await supabase.from('payment_requests').update({ status: 'FAILED', provider_response: providerResponse ?? { error: 'provider unreachable' } }).eq('id', id);
  await enqueueOutboundRequest('payout_execution', { paymentRequestId: id });
  return `Approved, but the payout provider did not respond. I queued automatic retries (idempotent) and will alert you if it still fails.`;
}

export async function markPaymentPaid(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Supabase is not configured';
  const { data: request } = await supabase
    .from('payment_requests')
    .update({ status: 'PAID', paid_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'AWAITING_MANUAL_PAYMENT')
    .select()
    .maybeSingle();
  if (!request) return 'Already marked paid or not found.';
  if (request.category !== 'salaries') {
    await recordLedgerEntry({
      type: 'expense', category: request.category, amount: Number(request.amount), projectName: request.project_name,
      description: `${request.payee}: ${request.purpose}`, source: 'payment_request', reference: `pay:${request.id}`,
    });
  }
  return `Recorded as paid: ${formatPeso(request.amount)} to ${request.payee}.`;
}

// ---------------- Profit allocation ----------------

export async function getAllocationRules(): Promise<AllocationRule[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data } = await supabase.from('profit_allocation_rules').select('*').eq('active', true);
  return (data || []).map((row) => ({ ...row, percent: Number(row.percent), monthly_target: row.monthly_target == null ? null : Number(row.monthly_target) }));
}

export async function setAllocationRule(bucket: string, percent: number, monthlyTarget?: number | null) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured', total: 0 };
  const name = bucket.trim().toLowerCase().replace(/\s+/g, '_');
  const { data: existing } = await supabase.from('profit_allocation_rules').select('*').eq('bucket', name).maybeSingle();
  const { error } = await supabase.from('profit_allocation_rules').upsert({
    bucket: name, percent, monthly_target: monthlyTarget === undefined ? existing?.monthly_target ?? null : monthlyTarget,
    priority: existing?.priority ?? 85, is_overflow: existing?.is_overflow ?? false, is_ceo_reward: existing?.is_ceo_reward ?? false,
    active: true, updated_at: new Date().toISOString(),
  });
  const rules = await getAllocationRules();
  return { error: error?.message || null, total: rules.reduce((sum, rule) => sum + rule.percent, 0) };
}

async function fundedThisMonth(period: string) {
  const supabase = getSupabaseAdmin();
  const funded: Record<string, number> = {};
  if (!supabase) return funded;
  const { data } = await supabase.from('profit_allocations').select('lines').eq('period', period).in('status', ['PROPOSED', 'APPROVED']);
  for (const row of data || []) for (const line of (row.lines as AllocationLine[]) || []) funded[line.bucket] = (funded[line.bucket] || 0) + Number(line.amount);
  return funded;
}

// Allocates only the profit of a project that has not been allocated before, so re-running is safe.
export async function proposeProfitAllocation(projectName: string, period = currentPeriod()) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, message: 'Supabase is not configured' };
  const { data: entries } = await supabase.from('ledger_entries').select('entry_type, amount').eq('project_name', projectName);
  const net = (entries || []).reduce((sum, row) => sum + (row.entry_type === 'income' ? 1 : -1) * Number(row.amount), 0);
  const { data: prior } = await supabase.from('profit_allocations').select('net_profit').eq('project_name', projectName).in('status', ['PROPOSED', 'APPROVED']);
  const alreadyAllocated = (prior || []).reduce((sum, row) => sum + Number(row.net_profit), 0);
  const allocatable = Number((net - alreadyAllocated).toFixed(2));
  if (allocatable <= 0) return { data: null, message: `${projectName}: no new profit to allocate (net ${formatPeso(net)}, already allocated ${formatPeso(alreadyAllocated)}).` };

  const result = allocateProfit(allocatable, await getAllocationRules(), await fundedThisMonth(period));
  if (!result.lines.length) return { data: null, message: result.warning || 'Nothing to allocate.' };
  const { data, error } = await supabase.from('profit_allocations').insert({ project_name: projectName, period, net_profit: allocatable, lines: result.lines }).select().single();
  if (error || !data) return { data: null, message: error?.message || 'Could not save allocation' };

  const lineText = result.lines.map((line) => `• ${escapeTelegramHtml(line.bucket.replace(/_/g, ' '))}: ${formatPeso(line.amount)}${line.capped ? ' (target reached → extra to rolling capital)' : ''}`).join('\n');
  const reward = result.lines.find((line) => line.bucket === 'ceo_reward');
  await sendTelegramMessage(
    `📊 <b>PROFIT SPLIT — ${escapeTelegramHtml(projectName)}</b>\nNew profit: <b>${formatPeso(allocatable)}</b>\n${lineText}${reward ? `\n\n🏆 Boss, magaling! ${formatPeso(reward.amount)} is your reward for a job well done.` : ''}${result.warning ? `\n⚠️ ${escapeTelegramHtml(result.warning)}` : ''}`,
    { inline_keyboard: [[{ text: '✅ Approve split', callback_data: `alloc:approve:${data.id}` }, { text: '❌ Reject', callback_data: `alloc:reject:${data.id}` }]] },
  );
  return { data, message: `Allocation proposed for ${projectName}: ${formatPeso(allocatable)}. Waiting for CEO approval.` };
}

export async function decideAllocation(id: string, decision: 'approve' | 'reject') {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Supabase is not configured';
  const { data } = await supabase
    .from('profit_allocations')
    .update({ status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'PROPOSED')
    .select()
    .maybeSingle();
  if (!data) return 'This split was already handled or does not exist.';
  return decision === 'approve' ? `Split approved for ${data.project_name}. Envelopes updated.` : `Split rejected for ${data.project_name}.`;
}

// Envelope balance = approved allocations minus paid requests whose category matches the bucket.
export async function getBucketBalances() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return {} as Record<string, number>;
  const [{ data: allocations }, { data: payments }] = await Promise.all([
    supabase.from('profit_allocations').select('lines').eq('status', 'APPROVED'),
    supabase.from('payment_requests').select('category, amount').eq('status', 'PAID'),
  ]);
  const balances: Record<string, number> = {};
  for (const row of allocations || []) for (const line of (row.lines as AllocationLine[]) || []) balances[line.bucket] = (balances[line.bucket] || 0) + Number(line.amount);
  for (const row of payments || []) if (row.category in balances) balances[row.category] -= Number(row.amount);
  return Object.fromEntries(Object.entries(balances).map(([key, value]) => [key, Number(value.toFixed(2))]));
}

// ---------------- Heartbeats & style ----------------

export async function recordHeartbeat(job: string, status = 'ok', details?: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { error } = await supabase.from('job_heartbeats').upsert({ job, last_run_at: new Date().toISOString(), last_status: status, details: details || null });
  if (error) console.error('heartbeat failed:', error.message);
}

export async function saveStyleExample(kind: string, example: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('style_examples').insert({ kind: kind.slice(0, 30), example: example.slice(0, 1000) });
  return { error: error?.message || null };
}

export async function safely<T>(context: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await reportCriticalError(context, error);
    return fallback;
  }
}
