// Daily 8:00 AM client update for Ms. Anne Manalo: one Telegram message per active/pending client.
// Pure logic only (no I/O). The runner lives in anne-daily-update.ts.

import { STAGE_NEXT_ACTION, stageProgressLine, type OpenOrder } from './client-pulse.ts';
import { escapeTelegramHtml } from './integrations.ts';

export type DailySample = {
  id: string;
  item: string;
  quantity: number;
  client_name: string;
  order_id?: string | null;
  status: string;
};

// A sample belongs to an order when linked by order_id, otherwise when the client name matches (case-insensitive).
export function sampleBelongsToOrder(sample: Pick<DailySample, 'client_name' | 'order_id'>, order: Pick<OpenOrder, 'id' | 'client_name'>) {
  if (sample.order_id) return sample.order_id === order.id;
  return (sample.client_name || '').trim().toLowerCase() === (order.client_name || '').trim().toLowerCase();
}

export function pendingSamplesFor(order: OpenOrder, samples: DailySample[]) {
  return samples.filter((sample) => sample.status === 'OUT' && sampleBelongsToOrder(sample, order));
}

export function daysSince(iso: string | null, now: Date) {
  const since = Date.parse(iso || '');
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, Math.floor((now.getTime() - since) / 86_400_000));
}

// One message per client: status, recent progress, and pending items (deposit, sample return, next step).
export function buildAnneClientUpdate(order: OpenOrder, index: number, total: number, pendingSamples: DailySample[], now = new Date()): string {
  const name = escapeTelegramHtml(order.client_name || order.project_name || 'Client');
  const project = order.project_name && order.project_name !== order.client_name ? ` — ${escapeTelegramHtml(order.project_name)}` : '';
  const status = stageProgressLine(order.stage) || `Status: <b>${escapeTelegramHtml(order.stage.replaceAll('_', ' '))}</b>`;
  const idle = daysSince(order.updated_at || order.created_at, now);
  const progress = idle >= 1 ? `Huling galaw: ${idle} araw na ang nakalipas` : 'Huling galaw: ngayong araw';

  const pending: string[] = [];
  if (order.stage === 'S05_DEPOSIT') pending.push('• Hinihintay ang 50% D.P.');
  if (order.stage === 'S10_BALANCE') pending.push('• Hinihintay ang balance payment');
  for (const sample of pendingSamples) {
    pending.push(`• Ibalik ang sample: ${escapeTelegramHtml(sample.item)} × ${sample.quantity}`);
  }
  const pendingBlock = pending.length ? pending.join('\n') : '• Wala — walang nakabinbin.';

  return [
    `<b>${index + 1}/${total} · ${name}</b>${project}`,
    status,
    progress,
    `<b>Nakabinbin:</b>\n${pendingBlock}`,
    `👉 ${escapeTelegramHtml(STAGE_NEXT_ACTION[order.stage] || 'I-check ang status nito.')}`,
  ].join('\n');
}

export function buildAnneDailyHeader(total: number, today: string) {
  return `<b>📋 DAILY CLIENT UPDATE — ${escapeTelegramHtml(today)}</b>\n${total} na active/pending na client. Isa-isang update sa baba:`;
}

// The daily run is idempotent per Manila date: a second run on the same day does nothing.
export function isDailyUpdateDue(lastSentOn: string | null, today: string) {
  return lastSentOn !== today;
}
