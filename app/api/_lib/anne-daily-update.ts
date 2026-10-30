import { recordHeartbeat } from './ceo-finance';
import { listOpenOrders, sortOrdersForPulse } from './client-pulse';
import { buildAnneClientUpdate, buildAnneDailyHeader, isDailyUpdateDue, pendingSamplesFor, type DailySample } from './anne-daily-update-logic';
import { getAnneChatId, getSupabaseAdmin, sendTelegramDirectMessage } from './integrations';
import { manilaToday } from './production-quota-logic';

export const ANNE_DAILY_UPDATE_SETTING_KEY = 'anne_daily_update_sent_on';

// Sends Ms. Anne one Telegram DM per active/pending client (open orders). Runs once per Manila date.
// Anne-only: uses the direct-message helper, so the CEO group does not receive client details.
export async function runAnneDailyUpdate(now = new Date()) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { status: 'error' as const, error: 'Supabase is not configured' };

  const today = manilaToday(now);
  const { data: setting } = await supabase.from('ceo_settings').select('value').eq('key', ANNE_DAILY_UPDATE_SETTING_KEY).maybeSingle();
  if (!isDailyUpdateDue(setting?.value ?? null, today)) return { status: 'skipped' as const, reason: 'already-sent', today };

  // Without Ms. Anne's chat ID nothing is sent and nothing is marked, so the next run retries.
  const { chatId } = await getAnneChatId();
  if (!chatId) return { status: 'error' as const, error: 'Ms. Anne Manalo chat ID is not set (ANNE_MANALO_TELEGRAM_CHAT_ID or /admin)' };

  const orders = sortOrdersForPulse(await listOpenOrders(200));
  const { data: outRows } = await supabase.from('sample_items').select('id, item, quantity, client_name, order_id, status').eq('status', 'OUT');
  const samples = (outRows || []) as DailySample[];

  await sendTelegramDirectMessage(chatId, buildAnneDailyHeader(orders.length, today));
  let sent = 0;
  for (const [index, order] of orders.entries()) {
    const text = buildAnneClientUpdate(order, index, orders.length, pendingSamplesFor(order, samples), now);
    if (await sendTelegramDirectMessage(chatId, text)) sent += 1;
  }

  // Marked after the attempt (even on partial failure) so a retry does not re-send the same updates to Anne.
  await supabase.from('ceo_settings').upsert({ key: ANNE_DAILY_UPDATE_SETTING_KEY, value: today, updated_at: new Date().toISOString() });
  await recordHeartbeat('anne-daily-updates', 'ok', { open: orders.length, sent });
  return { status: 'sent' as const, today, open: orders.length, sent, failed: orders.length - sent };
}
