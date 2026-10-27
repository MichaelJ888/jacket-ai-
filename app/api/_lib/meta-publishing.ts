export type MetaPublishingResult = { ok: boolean; code: string; reason: string };
export type MetaPlatform = 'facebook' | 'instagram';

type TokenData = {
  is_valid?: boolean;
  app_id?: string;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
};

const blocked = (code: string, reason: string): MetaPublishingResult => ({ ok: false, code, reason });

export function evaluatePublishingToken(
  data: TokenData,
  appId: string,
  platform: MetaPlatform,
  pageId: string,
  now = Date.now(),
): MetaPublishingResult {
  if (data.is_valid !== true) return blocked('invalid_token', 'Page access token is invalid or revoked. Reconnect the configured Page.');
  for (const expiry of [data.expires_at, data.data_access_expires_at]) {
    if (expiry !== undefined && (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry < 0)) {
      return blocked('invalid_metadata', 'Meta returned invalid token expiry metadata. Publishing stays paused.');
    }
    if (expiry && expiry * 1000 <= now) return blocked('expired_token', 'Page access token or data access expired. Reconnect the configured Page.');
  }
  if (data.app_id !== appId) return blocked('wrong_app', 'Page access token belongs to a different Meta app. Reconnect using the configured app.');
  const required = platform === 'facebook' ? ['pages_manage_posts', 'pages_read_engagement'] : ['instagram_basic', 'instagram_content_publish'];
  const missing = required.filter((scope) => !Array.isArray(data.scopes) || !data.scopes.includes(scope));
  if (missing.length) return blocked('missing_permissions', `Missing Meta permission(s): ${missing.join(', ')}. Complete Meta app review/access and reconnect; credentials alone cannot grant permissions.`);
  if (data.granular_scopes !== undefined && !Array.isArray(data.granular_scopes)) {
    return blocked('invalid_metadata', 'Meta returned invalid permission metadata. Publishing stays paused.');
  }
  const wrongPage = (data.granular_scopes || []).some((grant) =>
    grant.scope.startsWith('pages_') && required.includes(grant.scope) && grant.target_ids && !grant.target_ids.includes(pageId),
  );
  if (wrongPage) return blocked('wrong_page_scope', 'Publishing permissions do not cover the configured Page. Reconnect and select the correct Page.');
  return { ok: true, code: 'ready', reason: 'Token, app and publishing scopes verified.' };
}

export function metaPublishFailure(error: unknown): MetaPublishingResult | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 190) return blocked('invalid_token', 'Meta rejected the Page access token as expired or revoked. Reconnect the configured Page.');
  if (code === 10 || code === 200) return blocked('missing_permissions', 'Meta denied publishing permission. Check app review, Page task access and publishing scopes, then reconnect.');
  return null;
}

export async function checkMetaPublishing(
  pageId: string | undefined,
  token: string | undefined,
  platform: MetaPlatform,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<MetaPublishingResult> {
  const required = ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'];
  const missing = required.filter((name) => !env[name]?.trim());
  if (!pageId) missing.push('META_PAGE_ID');
  if (!token?.trim()) missing.push('META_PAGE_ACCESS_TOKEN (or a saved/discovered Page token)');
  if (missing.length) return blocked('missing_config', `Missing Meta configuration: ${missing.join(', ')}. Add scoped credentials; publishing stays paused.`);

  try {
    const url = new URL('https://graph.facebook.com/v21.0/debug_token');
    url.searchParams.set('input_token', token!);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${env.META_APP_ID}|${env.META_APP_SECRET}` },
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!response.ok) return blocked('inspection_failed', `Meta token inspection returned HTTP ${response.status}. Check app credentials and Page access; publishing stays paused.`);
    const body = await response.json() as { data?: TokenData };
    const result = evaluatePublishingToken(body.data || {}, env.META_APP_ID!, platform, pageId!);
    if (!result.ok) return result;
    const identity = await fetcher('https://graph.facebook.com/v21.0/me?fields=id', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!identity.ok) return blocked('identity_failed', `Meta Page identity check returned HTTP ${identity.status}. Reconnect the configured Page.`);
    const page = await identity.json() as { id?: string };
    if (page.id !== pageId) return blocked('wrong_page', 'Resolved token does not belong to META_PAGE_ID. Reconnect the correct Page.');
    return result;
  } catch {
    return blocked('inspection_unavailable', 'Meta validation timed out or returned an unreadable response. Publishing stays paused until the next successful check.');
  }
}
