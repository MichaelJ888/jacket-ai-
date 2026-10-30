import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { buildQuotaProgress, isQuotaKind, manilaToday, planSubconOverflow, quotaWindow, type QuotaTarget } from '../_lib/production-quota-logic';
import { getSupabaseAdmin } from '../_lib/integrations';
import { buildQuotaFormulaRows } from '../_lib/quota-engine-logic';

// GET: progress for every quota period (targets vs. actual sewer output and income). Optional ?date=YYYY-MM-DD.
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const requested = new URL(req.url).searchParams.get('date');
  const today = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : manilaToday();
  // The 12-month window is the widest, so one query covers every period.
  const { start } = quotaWindow('year', today);

  const [targetsResult, outputResult, incomeResult, subconsResult] = await Promise.all([
    supabase.from('production_quotas').select('period_kind, target_pcs, target_revenue'),
    supabase.from('sewer_output').select('work_date, quantity').gte('work_date', start).lte('work_date', today),
    supabase.from('ledger_entries').select('entry_date, amount').eq('entry_type', 'income').gte('entry_date', start).lte('entry_date', today),
    supabase.from('subcon_directory').select('name, daily_capacity_pcs, rate_per_pc, active'),
  ]);
  if (targetsResult.error || outputResult.error || incomeResult.error) {
    return NextResponse.json({ error: targetsResult.error?.message || outputResult.error?.message || incomeResult.error?.message }, { status: 500 });
  }

  const targets = (targetsResult.data || []) as QuotaTarget[];
  const progress = buildQuotaProgress(
    today,
    targets,
    (outputResult.data || []).map((row) => ({ work_date: String(row.work_date), quantity: Number(row.quantity) })),
    (incomeResult.data || []).map((row) => ({ entry_date: String(row.entry_date), amount: Number(row.amount) })),
  );

  const dailyRow = progress.find((row) => row.kind === 'daily');
  const subcon = planSubconOverflow(dailyRow?.actualPcs || 0, dailyRow?.targetPcs ?? null, subconsResult.data || []);
  const formula = buildQuotaFormulaRows(today, targets);
  return NextResponse.json({ success: true, today, progress, subcon, formula });
}

// POST: set or clear a target. Body: { period_kind, target_pcs?, target_revenue? } (null clears a value).
export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { period_kind?: unknown; target_pcs?: unknown; target_revenue?: unknown } | null;
  if (!body || !isQuotaKind(body.period_kind)) return NextResponse.json({ error: 'period_kind must be one of daily, week, half_month, month, quarter, semester, nine_month, year' }, { status: 400 });

  const toTarget = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
  };
  const target_pcs = toTarget(body.target_pcs);
  const target_revenue = toTarget(body.target_revenue);
  if (Number.isNaN(target_pcs) || Number.isNaN(target_revenue)) return NextResponse.json({ error: 'Targets must be non-negative numbers or null' }, { status: 400 });

  const { data, error } = await supabase
    .from('production_quotas')
    .upsert({ period_kind: body.period_kind, target_pcs, target_revenue, updated_at: new Date().toISOString() }, { onConflict: 'period_kind' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, target: data });
}
