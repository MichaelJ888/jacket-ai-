import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
// Lazy so the pure helpers stay importable from plain node tests.
const getSupabaseAdmin = async () => {
  const client = (await import('./integrations')).getSupabaseAdmin();
  if (!client) throw new Error('Supabase is not configured');
  return client;
};

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 15000;
const STATE_TTL_MS = 10 * 60 * 1000;

export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
];
export const META_SUBSCRIBED_FIELDS = 'messages,messaging_postbacks,feed';
export const META_NONCE_COOKIE = 'meta_oauth_nonce';
export const META_CTX_COOKIE = 'meta_oauth_ctx';
export type OAuthContext = 'popup' | 'connect' | 'admin';

export function parseOAuthContext(value: string | null | undefined): OAuthContext {
  return value === 'popup' || value === 'connect' ? value : 'admin';
}

export type ConnectedPage = {
  page_id: string;
  page_name: string | null;
  ig_user_id: string | null;
  webhook_subscribed: boolean;
  subscribe_error: string | null;
  connected_at: string;
};

export function metaOAuthConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  return appId && appSecret ? { appId, appSecret } : null;
}

export function oauthRedirectUri(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/meta/oauth/callback`;
}

// State = base64url(payload).HMAC. The nonce is also set as an httpOnly cookie, so a forged callback can't succeed.
export function createOAuthState(secret: string, now = Date.now()) {
  const nonce = randomBytes(16).toString('hex');
  const payload = Buffer.from(JSON.stringify({ n: nonce, exp: now + STATE_TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return { state: `${payload}.${sig}`, nonce };
}

export function verifyOAuthState(state: string | null, nonceCookie: string | null | undefined, secret: string, now = Date.now()) {
  if (!state || !nonceCookie) return false;
  const [payload, sig, extra] = state.split('.');
  if (!payload || !sig || extra !== undefined) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { n?: string; exp?: number };
    if (typeof parsed.n !== 'string' || typeof parsed.exp !== 'number' || parsed.exp < now) return false;
    const n = Buffer.from(parsed.n);
    const c = Buffer.from(nonceCookie);
    return n.length === c.length && timingSafeEqual(n, c);
  } catch {
    return false;
  }
}

export function buildAuthorizeUrl(appId: string, redirectUri: string, state: string) {
  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', META_OAUTH_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

async function graphGet<T>(path: string, params: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `Graph HTTP ${response.status}`);
  return data;
}

// code -> short-lived user token -> long-lived user token (~60 days).
export async function exchangeCodeForLongLivedToken(code: string, redirectUri: string, appId: string, appSecret: string) {
  const short = await graphGet<{ access_token: string }>('/oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const long = await graphGet<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: short.access_token,
  });
  return { userToken: long.access_token, expiresIn: long.expires_in };
}

type AccountPage = { id: string; name?: string; access_token?: string; instagram_business_account?: { id: string } };

// Page tokens obtained from a long-lived user token never expire.
export async function fetchManagedPages(userToken: string) {
  const pages: AccountPage[] = [];
  let next: string | null = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const data: { data?: AccountPage[]; paging?: { next?: string } } = next
      ? await (await fetch(next, { headers: { Authorization: `Bearer ${userToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })).json()
      : await graphGet('/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id}', limit: '100' }, userToken);
    for (const page of data.data || []) if (page.access_token) pages.push(page);
    next = data.paging?.next || null;
    if (!next) break;
  }
  return pages;
}

export async function subscribePageToWebhooks(pageId: string, pageToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pageToken}` },
      body: JSON.stringify({ subscribed_fields: META_SUBSCRIBED_FIELDS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    return data.success ? { ok: true } : { ok: false, error: data.error?.message || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'request failed' };
  }
}

export type FacebookProfile = { id: string; name?: string; email?: string };

export async function fetchFacebookProfile(userToken: string) {
  return graphGet<FacebookProfile>('/me', { fields: 'id,name,email' }, userToken);
}

export type SkippedPage = { id: string; name: string | null; reason: 'other_account' | 'plan_limit' };

// Saves the Pages the user granted (within their plan) under their tenant and auto-subscribes each to the shared webhook.
export async function connectPagesFromUserToken(userToken: string, tenant: { id: string; plan: string }): Promise<{ connected: ConnectedPage[]; skipped: SkippedPage[] }> {
  const pages = await fetchManagedPages(userToken);
  if (!pages.length) throw new Error('No Facebook Pages were granted. Select at least one Page in the Facebook dialog.');
  const { pageLimit, planConnect } = await import('./tenant-logic');
  const supabase = await getSupabaseAdmin();

  const { data: ownedRows } = await supabase.from('meta_connections').select('page_id').eq('tenant_id', tenant.id);
  const { data: existingRows } = await supabase.from('meta_connections').select('page_id,tenant_id').in('page_id', pages.map((page) => page.id));
  const foreignIds = ((existingRows || []) as Array<{ page_id: string; tenant_id: string | null }>)
    .filter((row) => row.tenant_id && row.tenant_id !== tenant.id)
    .map((row) => row.page_id);
  const plan = planConnect(pageLimit(tenant.plan), ((ownedRows || []) as Array<{ page_id: string }>).map((row) => row.page_id), foreignIds, pages.map((page) => page.id));

  const connected: ConnectedPage[] = [];
  for (const page of pages.filter((item) => plan.allowed.includes(item.id))) {
    const sub = await subscribePageToWebhooks(page.id, page.access_token!);
    const row = {
      page_id: page.id,
      page_name: page.name ?? null,
      page_access_token: page.access_token!,
      ig_user_id: page.instagram_business_account?.id ?? null,
      tenant_id: tenant.id,
      webhook_subscribed: sub.ok,
      subscribe_error: sub.ok ? null : sub.error ?? null,
      connected_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('meta_connections').upsert(row, { onConflict: 'page_id' });
    if (error) throw new Error(`Saving Page ${page.id} failed: ${error.message}`);
    connected.push({ page_id: row.page_id, page_name: row.page_name, ig_user_id: row.ig_user_id, webhook_subscribed: row.webhook_subscribed, subscribe_error: row.subscribe_error, connected_at: row.connected_at });
  }
  const names = new Map(pages.map((page) => [page.id, page.name ?? null]));
  return { connected, skipped: plan.skipped.map((item) => ({ ...item, name: names.get(item.id) ?? null })) };
}

export async function listConnections(tenantId?: string): Promise<ConnectedPage[]> {
  let query = (await getSupabaseAdmin())
    .from('meta_connections')
    .select('page_id,page_name,ig_user_id,webhook_subscribed,subscribe_error,connected_at')
    .order('connected_at', { ascending: false });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as ConnectedPage[];
}
export async function getConnectionToken(pageId: string): Promise<string | undefined> {
  try {
    const { data } = await (await getSupabaseAdmin()).from('meta_connections').select('page_access_token').eq('page_id', pageId).maybeSingle();
    return (data as { page_access_token?: string } | null)?.page_access_token || undefined;
  } catch {
    return undefined;
  }
}

export async function disconnectPage(pageId: string) {
  const token = await getConnectionToken(pageId);
  if (token) {
    await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  }
  const { error } = await (await getSupabaseAdmin()).from('meta_connections').delete().eq('page_id', pageId);
  if (error) throw new Error(error.message);
}
