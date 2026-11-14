import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const getSupabaseAdmin = async () => {
  const { getSupabaseAdmin: createAdminClient } = await import('./integrations');
  return createAdminClient();
};

const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

export const TIKTOK_OAUTH_COOKIE = 'tiktok_oauth_nonce';
export const TIKTOK_OAUTH_SCOPES = ['user.info.basic', 'video.publish'];

export type TikTokOAuthTokens = {
  access_token: string;
  refresh_token: string;
  open_id: string;
  access_token_expires_at: number;
  refresh_token_expires_at: number;
  scope?: string;
};

export function tiktokOAuthConfig() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  return clientKey && clientSecret ? { clientKey, clientSecret } : null;
}

export function createTikTokOAuthState(secret: string, now = Date.now()) {
  const nonce = randomBytes(16).toString('hex');
  const payload = Buffer.from(JSON.stringify({ nonce, expiresAt: now + STATE_TTL_MS })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { state: `${payload}.${signature}`, nonce };
}

export function verifyTikTokOAuthState(
  state: string | null,
  nonceCookie: string | null | undefined,
  secret: string,
  now = Date.now(),
) {
  if (!state || !nonceCookie) return false;
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra !== undefined) return false;

  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      nonce?: string;
      expiresAt?: number;
    };
    if (typeof parsed.nonce !== 'string' || typeof parsed.expiresAt !== 'number' || parsed.expiresAt < now) return false;
    const stateNonce = Buffer.from(parsed.nonce);
    const cookieNonce = Buffer.from(nonceCookie);
    return stateNonce.length === cookieNonce.length && timingSafeEqual(stateNonce, cookieNonce);
  } catch {
    return false;
  }
}

export function buildTikTokAuthorizeUrl(clientKey: string, redirectUri: string, state: string) {
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', clientKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', TIKTOK_OAUTH_SCOPES.join(','));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== 'string') {
    const code = typeof body.error === 'string' ? ` (${body.error})` : '';
    throw new Error(`TikTok token request failed with HTTP ${response.status}${code}`);
  }
  return body;
}

function tokenExpiry(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`TikTok token response is missing a valid ${field}`);
  }
  return Date.now() + value * 1000;
}

export async function exchangeTikTokAuthorizationCode(
  code: string,
  redirectUri: string,
  clientKey: string,
  clientSecret: string,
) {
  const body = await tokenRequest({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  if (
    typeof body.refresh_token !== 'string'
    || typeof body.open_id !== 'string'
  ) {
    throw new Error('TikTok token response is missing required account credentials');
  }

  return {
    access_token: body.access_token as string,
    refresh_token: body.refresh_token,
    open_id: body.open_id,
    access_token_expires_at: tokenExpiry(body.expires_in, 'access-token expiry'),
    refresh_token_expires_at: tokenExpiry(body.refresh_expires_in, 'refresh-token expiry'),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  } satisfies TikTokOAuthTokens;
}

export async function saveTikTokTokens(tokens: TikTokOAuthTokens) {
  const supabase = await getSupabaseAdmin();
  if (!supabase) throw new Error('Supabase service access is not configured for TikTok credentials');

  const { error } = await supabase.from('system_settings').upsert({
    key: 'tiktok_oauth',
    value: tokens,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw new Error('Could not securely save TikTok credentials');
}

function readStoredTokens(value: unknown): TikTokOAuthTokens | null {
  if (!value || typeof value !== 'object') return null;
  const tokens = value as Partial<TikTokOAuthTokens>;
  if (
    typeof tokens.access_token !== 'string'
    || typeof tokens.refresh_token !== 'string'
    || typeof tokens.open_id !== 'string'
    || typeof tokens.access_token_expires_at !== 'number'
    || typeof tokens.refresh_token_expires_at !== 'number'
  ) return null;
  return tokens as TikTokOAuthTokens;
}

export async function getTikTokAccessToken() {
  const environmentToken = process.env.TIKTOK_ACCESS_TOKEN?.trim();
  if (environmentToken) return environmentToken;

  const supabase = await getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', 'tiktok_oauth').maybeSingle();
  if (error) throw new Error('Could not read TikTok credentials from secure storage');
  let tokens = readStoredTokens(data?.value);
  if (!tokens) return null;

  if (tokens.access_token_expires_at > Date.now() + 60_000) return tokens.access_token;
  if (tokens.refresh_token_expires_at <= Date.now()) {
    throw new Error('TikTok authorization expired; reconnect the TikTok account.');
  }

  const config = tiktokOAuthConfig();
  if (!config) throw new Error('TikTok OAuth app credentials are not configured for token refresh');

  const body = await tokenRequest({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });

  tokens = {
    ...tokens,
    access_token: body.access_token as string,
    access_token_expires_at: tokenExpiry(body.expires_in, 'access-token expiry'),
    refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : tokens.refresh_token,
    refresh_token_expires_at: typeof body.refresh_expires_in === 'number'
      ? tokenExpiry(body.refresh_expires_in, 'refresh-token expiry')
      : tokens.refresh_token_expires_at,
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
  await saveTikTokTokens(tokens);
  return tokens.access_token;
}
