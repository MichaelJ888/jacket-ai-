import { escapeTelegramHtml, getAnneChatId, sendTelegramMessage } from './integrations';
import { selectStaleSamplesToAlert, staleSampleDays, STALE_SAMPLE_DAYS, type StaleSampleRow } from './sample-return-logic';

type SupabaseLike = NonNullable<ReturnType<typeof import('./integrations').getSupabaseAdmin>>;

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

// Alerts once per sample per day. Goes out through the shared ops fan-out, so the CEO group and Ms. Anne both receive it.
// The warning prefix is only added when Ms. Anne's chat ID is missing.
export async function runStaleSampleRetrieval(supabase: SupabaseLike, today: string) {
  const { data, error } = await supabase
    .from('sample_items')
    .select('id, item, quantity, client_name, contact_phone, status, sent_at, last_client_activity_at, stale_alert_on')
    .eq('status', 'OUT');
  if (error) throw new Error(error.message);

  const due = selectStaleSamplesToAlert((data || []) as StaleSampleRow[], today);
  if (!due.length) return { stale: 0, alerted: 0, recipient: 'none' as const };

  // Ms. Anne's chat ID (env, or auto-detected/saved in /admin). Without it, the owner group still gets the alert.
  const { chatId } = await getAnneChatId();
  const text = buildRetrievalMessage(due, today);
  await sendTelegramMessage(chatId ? text : `⚠️ Walang Telegram chat ID si Ms. Anne Manalo (i-save sa /admin o set ANNE_MANALO_TELEGRAM_CHAT_ID).\n${text}`);

  await supabase.from('sample_items').update({ stale_alert_on: today }).in('id', due.map((row) => row.id));
  return { stale: due.length, alerted: due.length, recipient: chatId ? ('anne' as const) : ('owner' as const) };
}

