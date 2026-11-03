// Pure posting-policy rules for the content publisher. No I/O, so they are unit-tested directly.

// Peak-engagement slots in Manila time (UTC+8).
export const POSTING_SLOTS_PHT: ReadonlyArray<{ hour: number; minute: number }> = [
  { hour: 9, minute: 30 },
  { hour: 13, minute: 30 },
  { hour: 16, minute: 0 },
  { hour: 20, minute: 30 },
];

// Hard ceiling per platform (Meta anti-spam). CONTENT_MAX_POSTS_PER_DAY can lower it but never raise it.
export const HARD_MAX_POSTS_PER_DAY = 4;
export const DAY_MS = 24 * 3600 * 1000;

export function maxPostsPerDay(raw: string | undefined): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return HARD_MAX_POSTS_PER_DAY;
  return Math.min(parsed, HARD_MAX_POSTS_PER_DAY);
}

// Random offset in whole minutes within +/- maxMinutes. `random` is injectable for tests.
export function jitterMinutes(maxMinutes = 12, random: () => number = Math.random): number {
  return Math.round((random() * 2 - 1) * maxMinutes);
}

// Posts still allowed for one platform in the rolling 24h window.
export function remainingDailyQuota(publishedLast24h: number, cap = HARD_MAX_POSTS_PER_DAY): number {
  return Math.max(0, cap - publishedLast24h);
}

// Keeps rows in order while respecting each platform's remaining quota.
export function selectWithinQuota<T extends { platform: string }>(rows: T[], usedByPlatform: Record<string, number>, cap = HARD_MAX_POSTS_PER_DAY): T[] {
  const taken: Record<string, number> = {};
  return rows.filter((row) => {
    const used = (usedByPlatform[row.platform] || 0) + (taken[row.platform] || 0);
    if (used >= cap) return false;
    taken[row.platform] = (taken[row.platform] || 0) + 1;
    return true;
  });
}

// Meta is still transcoding/finishing the container. This is not a failure, so the row goes back to READY
// without consuming one of its three attempts.
export class MediaProcessingPending extends Error {}
