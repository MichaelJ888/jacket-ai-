import { recordHeartbeat } from '../../_lib/ceo-finance';
import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { reportCriticalError } from '../../_lib/integrations';
import { runDuePayroll } from '../../_lib/payroll';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily: Saturday -> sewer weekly payroll; 1st/16th -> all-employee payroll. ?kind=sewer|employee forces a run.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const kind = new URL(request.url).searchParams.get('kind');
  try {
    const results = await runDuePayroll({ force: kind === 'sewer' || kind === 'employee' ? kind : undefined });
    await recordHeartbeat('payroll', 'ok'); return NextResponse.json({ success: true, results });
  } catch (error) {
    await reportCriticalError('cron-payroll', error);
    return NextResponse.json({ error: 'Payroll run failed' }, { status: 500 });
  }
}
