import { NextResponse } from 'next/server';

import { isAdminAuthorized } from '../_lib/auth';
import { getSupabaseAdmin } from '../_lib/integrations';
import { addSubconJob, completeSubconJob, logSewerOutput, markPayrollPaid, runDuePayroll, upsertWorker } from '../_lib/payroll';

export const dynamic = 'force-dynamic';

// GET [?id=<uuid>] -> payroll runs (latest 50) or one run; GET ?workers=1 -> registered workers.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const params = new URL(request.url).searchParams;
  if (params.get('workers')) {
    const { data, error } = await supabase.from('payroll_workers').select('*').order('name');
    return error ? NextResponse.json({ error: error.message }, { status: 502 }) : NextResponse.json({ workers: data });
  }
  const id = params.get('id');
  const query = supabase.from('payroll_runs').select('*');
  const { data, error } = id ? await query.eq('id', id) : await query.order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ runs: data || [] });
}

// POST { action: 'upsert_worker', name, kind?, monthlySalary?, perMinuteRate?, telegramUserId?, aliases?, active? }
// POST { action: 'log_piece', workerName, quantity, rate, item?, workDate? }
// POST { action: 'add_subcon_job', subconName, amount, jobRef?, orderId?, description? }
// POST { action: 'complete_subcon_job', job }   (job id, id prefix or job_ref -> generates the subcon payroll)
// POST { action: 'run', kind?: 'sewer' | 'employee' }   (manual run of the latest closed period)
// POST { action: 'mark_paid', runId }
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const fail = (error: string | null) => NextResponse.json({ error }, { status: 400 });

  switch (body.action) {
    case 'upsert_worker': {
      const kind = ['employee', 'sewer', 'subcon'].includes(body.kind) ? body.kind : undefined;
      const result = await upsertWorker({
        name: String(body.name || ''), kind, monthlySalary: body.monthlySalary, perMinuteRate: body.perMinuteRate,
        telegramUserId: body.telegramUserId, aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : undefined, active: body.active,
      });
      return result.error ? fail(result.error) : NextResponse.json({ success: true, worker: result.data });
    }
    case 'log_piece': {
      const result = await logSewerOutput({ workerName: String(body.workerName || ''), quantity: Number(body.quantity), rate: Number(body.rate), item: body.item, workDate: body.workDate });
      return result.error ? fail(result.error) : NextResponse.json({ success: true, entry: result.data });
    }
    case 'add_subcon_job': {
      const result = await addSubconJob({ subconName: String(body.subconName || ''), amount: Number(body.amount), jobRef: body.jobRef, orderId: body.orderId, description: body.description });
      return result.error ? fail(result.error) : NextResponse.json({ success: true, job: result.data });
    }
    case 'complete_subcon_job': {
      const result = await completeSubconJob(String(body.job || ''));
      return result.error ? fail(result.error) : NextResponse.json({ success: true, payroll: result.result });
    }
    case 'run':
      return NextResponse.json({ success: true, results: await runDuePayroll({ force: body.kind === 'sewer' || body.kind === 'employee' ? body.kind : undefined }) });
    case 'mark_paid': {
      const result = await markPayrollPaid(String(body.runId || ''));
      return result.ok ? NextResponse.json({ success: true, message: result.message }) : fail(result.message);
    }
    default:
      return fail('Unknown action');
  }
}
