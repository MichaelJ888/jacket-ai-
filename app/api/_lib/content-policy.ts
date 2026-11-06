// Pure posting-policy rules for the content publisher. No I/O, so they are unit-tested directly.

// Four daily posting slots in UTC (= 9:00 AM, 1:30 PM, 6:00 PM, 9:00 PM Manila). They use the full 4-post
// Meta quota, and the cron triggers match these exact times, so no jitter is applied.
// Video and picture slots strictly alternate: index 0 and 2 are video, 1 and 3 are pictures.
export const POSTING_SLOTS_UTC: ReadonlyArray<{ hour: number; minute: number; kind: 'video' | 'picture' }> = [
  { hour: 1, minute: 0, kind: 'video' },
  { hour: 5, minute: 30, kind: 'picture' },
  { hour: 10, minute: 0, kind: 'video' },
  { hour: 13, minute: 0, kind: 'picture' },
];

// Hard ceiling per platform (Meta anti-spam). CONTENT_MAX_POSTS_PER_DAY can lower it but never raise it.
export const HARD_MAX_POSTS_PER_DAY = 4;

export const CONTACT_HOTLINES = ['Smart: 0920 695 91 67', 'Globe: 0997 411 45 94', 'Viber/Telegram: 0929 227 17 61'] as const;

// Appends the corporate hotlines to a caption exactly once, so reprocessing a row never duplicates them.
export function withContactFooter(caption: string): string {
  const text = caption.trim();
  if (text.includes(CONTACT_HOTLINES[2])) return text;
  return `${text}\n\n📞 ${CONTACT_HOTLINES.join(' | ')}`;
}
export const DAY_MS = 24 * 3600 * 1000;

export function maxPostsPerDay(raw: string | undefined): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return HARD_MAX_POSTS_PER_DAY;
  return Math.min(parsed, HARD_MAX_POSTS_PER_DAY);
}

// Posts still allowed for one platform in the rolling 24h window.
export function remainingDailyQuota(publishedLast24h: number, cap = HARD_MAX_POSTS_PER_DAY): number {
  return Math.max(0, cap - publishedLast24h);
}

// Each Meta Page is its own account, so its quota is tracked separately (MJIC and CGVenezuela).
export function quotaKey(row: { platform: string; page_key?: string | null }): string {
  return `${row.page_key || 'mjic'}:${row.platform}`;
}

// Keeps rows in order while respecting each account's remaining quota.
export function selectWithinQuota<T extends { platform: string }>(rows: T[], usedByKey: Record<string, number>, cap = HARD_MAX_POSTS_PER_DAY, keyOf: (row: T) => string = (row) => row.platform): T[] {
  const taken: Record<string, number> = {};
  return rows.filter((row) => {
    const key = keyOf(row);
    const used = (usedByKey[key] || 0) + (taken[key] || 0);
    if (used >= cap) return false;
    taken[key] = (taken[key] || 0) + 1;
    return true;
  });
}

// Meta is still transcoding/finishing the container. This is not a failure, so the row goes back to READY
// without consuming one of its three attempts.
export class MediaProcessingPending extends Error {}
