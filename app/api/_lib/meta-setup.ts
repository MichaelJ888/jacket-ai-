const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 10000;

export const rolesLink = (appId?: string | null) => (appId ? `https://developers.facebook.com/apps/${encodeURIComponent(appId)}/roles/roles/` : 'https://developers.facebook.com/apps/');
export const loginSettingsLink = (appId?: string | null) => (appId ? `https://developers.facebook.com/apps/${encodeURIComponent(appId)}/fb-login/settings/` : 'https://developers.facebook.com/apps/');
export const appReviewLink = (appId?: string | null) => (appId ? `https://developers.facebook.com/apps/${encodeURIComponent(appId)}/app-review/permissions/` : 'https://developers.facebook.com/apps/');

export type SetupCheck = { id: string; label: string; ok: boolean; manual?: boolean; hint?: string; link?: string };

async function reachable(url: string) {
  try {
    return (await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })).ok;
  } catch {
    return false;
  }
}

async function appField(field: string): Promise<string | null> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return null;
  try {
    const url = new URL(`${GRAPH}/${appId}`);
    url.searchParams.set('fields', field);
    url.searchParams.set('access_token', `${appId}|${secret}`);
    const data = (await (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).json()) as Record<string, unknown>;
    return typeof data[field] === 'string' ? (data[field] as string) : null;
  } catch {
    return null;
  }
}

// Meta lets the app's own server set the deauthorize callback (so removing the app from Facebook wipes the buyer's tokens).
export async function registerDeauthCallback(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return { ok: false, error: 'META_APP_ID / META_APP_SECRET missing' };
  try {
    const body = new URLSearchParams({ deauth_callback_url: `${baseUrl}/api/meta/deauthorize`, access_token: `${appId}|${secret}` });
    const response = await fetch(`${GRAPH}/${appId}`, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    return data.success ? { ok: true } : { ok: false, error: data.error?.message || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'request failed' };
  }
}

export async function runSetupChecks(baseUrl: string): Promise<SetupCheck[]> {
  const appId = process.env.META_APP_ID;
  const [privacy, terms, deletion, deauth] = await Promise.all([
    reachable(`${baseUrl}/privacy`),
    reachable(`${baseUrl}/terms`),
    reachable(`${baseUrl}/data-deletion`),
    appField('deauth_callback_url'),
  ]);
  const env = (name: string) => Boolean(process.env[name]);
  return [
    { id: 'env', label: 'META_APP_ID, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN are set', ok: env('META_APP_ID') && env('META_APP_SECRET') && env('META_WEBHOOK_VERIFY_TOKEN') },
    { id: 'policies', label: 'Privacy, Terms and Data-deletion pages are public', ok: privacy && terms && deletion, hint: 'Meta requires all three URLs for App Review.' },
    { id: 'deauth', label: 'Deauthorize callback is registered', ok: deauth === `${baseUrl}/api/meta/deauthorize`, hint: 'Press "Register callbacks" to set it automatically.' },
    { id: 'redirect', label: 'Valid OAuth Redirect URI added (one-time, Meta forbids automating this)', ok: false, manual: true, link: loginSettingsLink(appId), hint: `Paste ${baseUrl}/api/meta/oauth/callback into "Valid OAuth Redirect URIs". Never needs repeating.` },
    { id: 'tester', label: 'Testers added while the app is in Development Mode', ok: false, manual: true, link: rolesLink(appId), hint: 'Buyers who request access are sent to you on Telegram with this link.' },
    { id: 'review', label: 'App Review approved + app switched to Live (Meta-only process)', ok: false, manual: true, link: appReviewLink(appId), hint: 'Follow docs/META_APP_REVIEW_KIT.md - every answer and the screencast script are prepared.' },
  ];
}
