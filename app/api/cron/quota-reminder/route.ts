import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { manilaToday, type QuotaTarget } from '../../_lib/production-quota-logic';
import { resolveDailyQuota } from '../../_lib/quota-engine-logic';

// Daily Telegram reminder: today's production quota (Total Target / Operating Days) vs. today's sewer output.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const today = manilaToday();
  const [targetsResult, outputResult] = await Promise.all([
    supabase.from('production_quotas').select('period_kind, target_pcs, target_revenue'),
    supabase.from('sewer_output').select('quantity').eq('work_date', today),
  ]);
  if (targetsResult.error || outputResult.error) {
    return NextResponse.json({ error: targetsResult.error?.message || outputResult.error?.message }, { status: 500 });
  }

  const targets = (targetsResult.data || []) as QuotaTarget[];
  const { dailyPcs, source, isOperatingDay } = resolveDailyQuota(today, targets);
  if (dailyPcs === null || !source) {
    return NextResponse.json({ success: true, sent: false, reason: 'No quota target set' });
  }

  const actual = (outputResult.data || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const remaining = Math.max(0, Math.ceil(dailyPcs - actual));
  const pct = dailyPcs > 0 ? Math.round((actual / dailyPcs) * 100) : 0;
  const status = actual >= dailyPcs ? '✅ Naabot na ang quota' : `⏳ Kulang pa ng ${remaining} pcs`;
  const note = isOperatingDay ? '' : '\nLinggo ngayon: walang operating day, kaya hindi kasama sa quota.';

  await sendTelegramMessage(
    [
      `🎯 <b>DAILY QUOTA REMINDER</b> (${today})`,
      `Quota ngayon: <b>${dailyPcs} pcs</b> (${source.kind}: ${source.targetPcs} ÷ ${source.operatingDays} operating days)`,
      `Output ngayon: <b>${actual} pcs</b> (${pct}%)`,
      status + note,
    ].join('\n'),
  );
  return NextResponse.json({ success: true, sent: true, today, dailyPcs, actual, remaining });
}
