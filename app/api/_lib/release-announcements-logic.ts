// Feature announcements for Ms. Anne. Pure logic; the registry is app/api/_lib/release-notes.json (newest first).

import { escapeTelegramHtml } from './integrations.ts';

export type ReleaseNote = {
  id: string;
  title: string;
  items: string[];
};

export const RELEASE_ANNOUNCED_SETTING_KEY = 'announced_release_ids';

// Ids are stored as a JSON array in ceo_settings.value (text). Corrupt values fall back to "nothing announced".
export function parseAnnouncedIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function pendingReleases(registry: ReleaseNote[], announcedIds: string[]) {
  const done = new Set(announcedIds);
  return registry.filter((release) => !done.has(release.id));
}

// The deployed code is "live" for a release once its registry head matches the release the workflow expects.
export function isReleaseLive(expectedId: string, registry: ReleaseNote[]) {
  return registry[0]?.id === expectedId;
}

export function buildReleaseMessage(release: ReleaseNote) {
  return [`🚀 <b>BAGONG UPDATE: ${escapeTelegramHtml(release.title)}</b>`, ...release.items.map((item) => `• ${escapeTelegramHtml(item)}`)].join('\n');
}
