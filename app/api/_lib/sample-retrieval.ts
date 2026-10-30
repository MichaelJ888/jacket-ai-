import { escapeTelegramHtml, sendTelegramDirectMessage, sendTelegramMessage } from './integrations';
import { selectStaleSamplesToAlert, staleSampleDays, STALE_SAMPLE_DAYS, type StaleSampleRow } from './sample-return-logic';

type SupabaseLike = NonNullable<ReturnType<typeof import('./integrations').getSupabaseAdmin>>;

// Ms. Anne Manalo receives the sample retrieval pushes. Env wins; otherwise look her up in staff_profiles.
export async function resolveSampleRetrievalChatId(supabase: SupabaseLike): Promise<string | null> {
  const fromEnv = process.env.ANNE_MANALO_TELEGRAM_CHAT_ID?.trim();
  if (fromEnv) return fromEnv;
  const { data } = await supabase
    .from('staff_profiles')
    .select('staff_name, telegram_chat_id')
    .not('telegram_chat_id', 'is', null)
    .ilike('staff_name', '%manalo%');
  const match = (data || []).find((row) => /anne/i.test(String(row.staff_name)) && row.telegram_chat_id);
  return match ? String(match.telegram_chat_id) : null;
}

export function buildRetrievalMessage(samples: StaleSampleRow[], today: string) {
  const lines = samples.map((sample) => {
    const contact = sample.contact_phone ? ` (${escapeTelegramHtml(sample.contact_phone)})` : '';
    return `• ${escapeTelegramHtml(sample.item)} × ${sample.quantity} — ${escapeTelegramHtml(sample.client_name)}${contact}, ${staleSampleDays(sample, today)} araw nang walang galaw`;
  });
  return [
    `📦 <b>SAMPLE RETRIEVAL (${samples.length})</b>`,
    `Lampas na ng ${STALE_SAMPLE_DAYS} araw ang mga sample na ito nang walang galaw ang kliyente.`,
    ...lines,
    'Pakikuha / pakikontak ang kliyente para maibalik ang sample, at i-update ang tracker kapag may aktibidad.',
  ].join('\n');
}

// Alerts once per sample per day. Sends to Ms. Anne when a chat ID is known, otherwise falls back to the staff group.
export async function runStaleSampleRetrieval(supabase: SupabaseLike, today: string) {
  const { data, error } = await supabase
    .from('sample_items')
    .select('id, item, quantity, client_name, contact_phone, status, sent_at, last_client_activity_at, stale_alert_on')
    .eq('status', 'OUT');
  if (error) throw new Error(error.message);

  const due = selectStaleSamplesToAlert((data || []) as StaleSampleRow[], today);
  if (!due.length) return { stale: 0, alerted: 0, recipient: 'none' as const };

  const chatId = await resolveSampleRetrievalChatId(supabase);
  const text = buildRetrievalMessage(due, today);
  if (chatId) await sendTelegramDirectMessage(chatId, text);
  else await sendTelegramMessage(`⚠️ Walang Telegram chat ID si Ms. Anne Manalo (set ANNE_MANALO_TELEGRAM_CHAT_ID).\n${text}`);

  await supabase.from('sample_items').update({ stale_alert_on: today }).in('id', due.map((row) => row.id));
  return { stale: due.length, alerted: due.length, recipient: chatId ? ('anne' as const) : ('owner' as const) };
}
