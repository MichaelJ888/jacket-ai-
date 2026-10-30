import releaseNotes from './release-notes.json';
import { getAnneChatId, getSupabaseAdmin, sendTelegramDirectMessage } from './integrations';
import {
  buildReleaseMessage,
  isReleaseLive,
  parseAnnouncedIds,
  pendingReleases,
  RELEASE_ANNOUNCED_SETTING_KEY,
  type ReleaseNote,
} from './release-announcements-logic';

const REGISTRY = releaseNotes as ReleaseNote[];

// Called by the release workflow after a push to main. It only announces once the deployed code's registry head
// equals `expectedId`, so an old deployment never announces a release it does not contain yet.
export async function dispatchReleaseAnnouncements(expectedId: string) {
  if (!isReleaseLive(expectedId, REGISTRY)) return { status: 'not-live' as const, expected: expectedId, head: REGISTRY[0]?.id ?? null };

  const supabase = getSupabaseAdmin();
  if (!supabase) return { status: 'error' as const, error: 'Supabase is not configured' };
  const { data } = await supabase.from('ceo_settings').select('value').eq('key', RELEASE_ANNOUNCED_SETTING_KEY).maybeSingle();
  const announced = parseAnnouncedIds(data?.value);
  const pending = pendingReleases(REGISTRY, announced);
  if (!pending.length) return { status: 'skipped' as const, reason: 'nothing-new' };

  // Without Ms. Anne's chat ID nothing is sent and nothing is marked, so the next workflow run retries.
  const { chatId } = await getAnneChatId();
  if (!chatId) return { status: 'error' as const, error: 'Ms. Anne Manalo chat ID is not set (ANNE_MANALO_TELEGRAM_CHAT_ID or /admin)' };

  const sent: string[] = [];
  for (const release of pending) {
    if (await sendTelegramDirectMessage(chatId, buildReleaseMessage(release))) sent.push(release.id);
  }
  if (sent.length) {
    await supabase.from('ceo_settings').upsert({
      key: RELEASE_ANNOUNCED_SETTING_KEY,
      value: JSON.stringify([...announced, ...sent]),
      updated_at: new Date().toISOString(),
    });
  }
  return { status: sent.length === pending.length ? ('sent' as const) : ('partial' as const), sent, failed: pending.length - sent.length };
}
