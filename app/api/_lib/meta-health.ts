import { evaluateHealth, type HealthCheck, type HealthInputs } from './meta-health-logic';
import { metaOAuthConfig, subscribePageToWebhooks } from './meta-oauth';
import { getPageToken } from './meta-pages';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 15000;

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<{ ok: boolean; data: T & { error?: { message?: string } } }> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { ok: response.ok, data: (await response.json().catch(() => ({}))) as T & { error?: { message?: string } } };
}

export async function checkPageHealth(pageId: string, igUserId: string | null): Promise<{ checks: HealthCheck[]; healthy: boolean }> {
  const config = metaOAuthConfig();
  const token = await getPageToken(pageId);
  if (!config || !token) {
    return { healthy: false, checks: evaluateHealth({ appId: config?.appId || '', tokenValid: false, tokenError: !config ? 'Meta app is not configured on the server.' : 'No saved token for this Page. Connect it again.', igUserId }) };
  }

  let tokenValid = false;
  let tokenError: string | undefined;
  let tokenExpiresAt: number | undefined;
  let tokenAppId: string | undefined;
  let subscribedApps: HealthInputs['subscribedApps'];
  try {
    const debug = await graph<{ data?: { is_valid?: boolean; expires_at?: number; app_id?: string; error?: { message?: string } } }>('/debug_token', `${config.appId}|${config.appSecret}`, { input_token: token });
    tokenValid = Boolean(debug.data.data?.is_valid);
    tokenExpiresAt = debug.data.data?.expires_at || undefined;
    tokenAppId = debug.data.data?.app_id;
    if (!tokenValid) tokenError = debug.data.data?.error?.message || debug.data.error?.message;
    if (tokenValid) {
      const subs = await graph<{ data?: HealthInputs['subscribedApps'] }>(`/${pageId}/subscribed_apps`, token);
      if (subs.ok) subscribedApps = subs.data.data;
      else tokenError = subs.data.error?.message;
    }
  } catch (error) {
    tokenError = error instanceof Error ? error.message : 'Health check failed';
  }

  const checks = evaluateHealth({ appId: config.appId, tokenValid, tokenError, tokenExpiresAt, tokenAppId, subscribedApps, igUserId });
  return { checks, healthy: checks.filter((check) => check.id !== 'instagram').every((check) => check.ok) };
}

export async function resubscribePage(pageId: string) {
  const token = await getPageToken(pageId);
  if (!token) return { ok: false, error: 'No saved token for this Page. Connect it again.' };
  return subscribePageToWebhooks(pageId, token);
}
