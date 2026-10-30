// Sample-retrieval rule (alerts Ms. Anne): an OUT sample needs a retrieval push when either
// (a) its client has placed an order and paid the down payment, or
// (b) it has had no client movement for STALE_SAMPLE_DAYS (2 weeks).
// Pure logic: dates are Manila calendar dates (YYYY-MM-DD).

import { DEPOSIT_STAGE_NO, stageNumber } from './order-stages.ts';

export const STALE_SAMPLE_DAYS = 14;

export type StaleSampleRow = {
  id: string;
  item: string;
  quantity: number;
  client_name: string;
  contact_phone: string | null;
  status: string;
  sent_at: string;
  last_client_activity_at: string | null;
  stale_alert_on: string | null;
};

export function daysBetweenIso(from: string, to: string) {
  const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

// "Client movement" = the last client activity date, or the send date when there has been none yet.
export function staleSampleDays(sample: Pick<StaleSampleRow, 'sent_at' | 'last_client_activity_at'>, today: string) {
  const lastMovement = (sample.last_client_activity_at || sample.sent_at).slice(0, 10);
  return daysBetweenIso(lastMovement, today);
}

export function isSampleStale(sample: Pick<StaleSampleRow, 'status' | 'sent_at' | 'last_client_activity_at'>, today: string) {
  return sample.status === 'OUT' && staleSampleDays(sample, today) >= STALE_SAMPLE_DAYS;
}

export type PaymentOrderRow = {
  id: string;
  client_name: string | null;
  stage: string;
  deposit_verification_id: string | null;
};

// Down payment is paid once the order has passed Stage 05, or a deposit verification is on file.
// ON_HOLD orders without a verification record are not counted (their pre-hold stage is not stored here).
export function isDownPaymentPaid(order: PaymentOrderRow) {
  if (order.stage === 'CANCELLED') return false;
  if (order.deposit_verification_id) return true;
  return order.stage === 'COMPLETED' || stageNumber(order.stage) > DEPOSIT_STAGE_NO;
}

// Sample ids whose client has a paid-DP order: matched by order_id first, else by client name (case-insensitive).
export function samplesWithPaidDownPayment(
  samples: Array<Pick<StaleSampleRow, 'id' | 'client_name'> & { order_id?: string | null }>,
  orders: PaymentOrderRow[],
): Set<string> {
  const paidOrderIds = new Set(orders.filter(isDownPaymentPaid).map((order) => order.id));
  const paidClientNames = new Set(
    orders.filter(isDownPaymentPaid).map((order) => (order.client_name || '').trim().toLowerCase()).filter(Boolean),
  );
  const ids = new Set<string>();
  for (const sample of samples) {
    const byOrder = sample.order_id ? paidOrderIds.has(sample.order_id) : false;
    const byName = paidClientNames.has((sample.client_name || '').trim().toLowerCase());
    if (byOrder || (!sample.order_id && byName)) ids.add(sample.id);
  }
  return ids;
}

// A sample is due for a retrieval alert when it is OUT and either the client paid the DP or it is stale.
export function isSampleDue(sample: Pick<StaleSampleRow, 'status' | 'sent_at' | 'last_client_activity_at'>, today: string, depositPaid = false) {
  return sample.status === 'OUT' && (depositPaid || staleSampleDays(sample, today) >= STALE_SAMPLE_DAYS);
}

// Samples that need an alert today: due and not already alerted today.
export function selectStaleSamplesToAlert<T extends StaleSampleRow>(samples: T[], today: string, depositPaidIds: ReadonlySet<string> = new Set()): T[] {
  return samples.filter((sample) => isSampleDue(sample, today, depositPaidIds.has(sample.id)) && sample.stale_alert_on !== today);
}
