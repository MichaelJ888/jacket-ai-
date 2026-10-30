import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { manilaToday } from '../../_lib/production-quota-logic';

// Daily: alert once per day for every OUT sample past its expected return date.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const today = manilaToday();
  const { data, error } = await supabase
    .from('sample_items')
    .select('id, item, quantity, client_name, contact_phone, expected_return_at, overdue_alert_on')
    .eq('status', 'OUT')
    .lt('expected_return_at', today);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = (data || []).filter((row) => row.overdue_alert_on !== today);
  if (due.length) {
    const lines = due.map((row) => `• ${escapeTelegramHtml(row.item)} × ${row.quantity} — ${escapeTelegramHtml(row.client_name)}${row.contact_phone ? ` (${escapeTelegramHtml(row.contact_phone)})` : ''}, due ${row.expected_return_at}`);
    await sendTelegramMessage(`⏰ <b>OVERDUE SAMPLES (${due.length})</b>\n${lines.join('\n')}\nKulitin ang client para maibalik.`);
    await supabase.from('sample_items').update({ overdue_alert_on: today }).in('id', due.map((row) => row.id));
  }
  return NextResponse.json({ success: true, overdue: (data || []).length, alerted: due.length });
}
