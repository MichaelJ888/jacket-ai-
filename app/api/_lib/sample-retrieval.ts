import { escapeTelegramHtml, getAnneChatId, sendTelegramMessage } from './integrations';
import { samplesWithPaidDownPayment, selectStaleSamplesToAlert, staleSampleDays, STALE_SAMPLE_DAYS, type PaymentOrderRow, type StaleSampleRow } from './sample-return-logic';

type SupabaseLike = NonNullable<ReturnType<typeof import('./integrations').getSupabaseAdmin>>;

type RetrievalSample = StaleSampleRow & { order_id?: string | null };

export function buildRetrievalMessage(samples: RetrievalSample[], today: string, depositPaidIds: ReadonlySet<string> = new Set()) {
  const lines = samples.map((sample) => {
    const contact = sample.contact_phone ? ` (${escapeTelegramHtml(sample.contact_phone)})` : '';
    const reason = depositPaidIds.has(sample.id) ? 'DP bayad na' : `${staleSampleDays(sample, today)} araw nang walang galaw`;
    return `• ${escapeTelegramHtml(sample.item)} × ${sample.quantity} — ${escapeTelegramHtml(sample.client_name)}${contact}, ${reason}`;
  });
  return [
    `📦 <b>SAMPLE RETRIEVAL (${samples.length})</b>`,
    `Kunin ang mga sample na ito: DP bayad na na ang kliyente, o lampas na ng ${STALE_SAMPLE_DAYS} araw nang walang galaw.`,
    ...lines,
    'Pakikuha / pakikontak ang kliyente para maibalik ang sample, at i-update ang tracker kapag may aktibidad.',
  ].join('\n');
}

// Alerts once per sample per day. Goes out through the shared ops fan-out, so the CEO group and Ms. Anne both receive it.
// The warning prefix is only added when Ms. Anne's chat ID is missing.
export async function runStaleSampleRetrieval(supabase: SupabaseLike, today: string) {
  const { data, error } = await supabase
    .from('sample_items')
    .select('id, item, quantity, client_name, contact_phone, status, sent_at, last_client_activity_at, stale_alert_on, order_id')
    .eq('status', 'OUT');
  if (error) throw new Error(error.message);
  const outSamples = (data || []) as RetrievalSample[];
  if (!outSamples.length) return { stale: 0, alerted: 0, recipient: 'none' as const };

  const { data: orderRows, error: orderError } = await supabase
    .from('orders')
    .select('id, client_name, stage, deposit_verification_id')
    .in('stage', ['S05_DEPOSIT', 'S06_SIZING', 'S07_SAMPLE', 'S08_PRODUCTION', 'S09_QC', 'S10_BALANCE', 'S11_DISPATCH', 'COMPLETED', 'ON_HOLD']);
  if (orderError) throw new Error(orderError.message);
  const depositPaidIds = samplesWithPaidDownPayment(outSamples, (orderRows || []) as PaymentOrderRow[]);

  const due = selectStaleSamplesToAlert(outSamples, today, depositPaidIds);
  if (!due.length) return { stale: 0, alerted: 0, recipient: 'none' as const };

  // Ms. Anne's chat ID (env, or auto-detected/saved in /admin). Without it, the owner group still gets the alert.
  const { chatId } = await getAnneChatId();
  const text = buildRetrievalMessage(due, today, depositPaidIds);
  await sendTelegramMessage(chatId ? text : `⚠️ Walang Telegram chat ID si Ms. Anne Manalo (i-save sa /admin o set ANNE_MANALO_TELEGRAM_CHAT_ID).\n${text}`);

  await supabase.from('sample_items').update({ stale_alert_on: today }).in('id', due.map((row) => row.id));
  return { stale: due.length, alerted: due.length, recipient: chatId ? ('anne' as const) : ('owner' as const) };
}

