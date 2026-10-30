// Stale-sample rule: an OUT sample with no client movement for STALE_SAMPLE_DAYS needs a retrieval push to the staff owner.
// Pure logic: dates are Manila calendar dates (YYYY-MM-DD).

export const STALE_SAMPLE_DAYS = 30;

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

// Samples that need an alert today: stale and not already alerted today.
export function selectStaleSamplesToAlert<T extends StaleSampleRow>(samples: T[], today: string): T[] {
  return samples.filter((sample) => isSampleStale(sample, today) && sample.stale_alert_on !== today);
}
