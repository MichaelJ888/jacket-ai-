import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'mjic_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Pages a plan may connect. Every plan is unlimited (CEO decision); a large finite number keeps JSON responses valid.
export const UNLIMITED_PAGES = 1000;
export const PLAN_LIMITS: Record<string, number> = { free: UNLIMITED_PAGES, starter: UNLIMITED_PAGES, pro: UNLIMITED_PAGES, business: UNLIMITED_PAGES };

export function pageLimit(plan: string | null | undefined) {
  return PLAN_LIMITS[plan || 'free'] ?? PLAN_LIMITS.free;
}

// No extra env var needed: derived from the Meta app secret unless SESSION_SECRET is set.
export function sessionSecret(env: Record<string, string | undefined> = process.env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  return env.META_APP_SECRET ? createHmac('sha256', env.META_APP_SECRET).update('mjic-session-v1').digest('hex') : null;
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signSession(tenantId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(value: string | null | undefined, secret: string | null, now = Date.now()): string | null {
  if (!value || !secret) return null;
  const [payload, sig, extra] = value.split('.');
  if (!payload || !sig || extra !== undefined || !safeEqual(sig, sign(payload, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t?: string; exp?: number };
    return typeof parsed.t === 'string' && typeof parsed.exp === 'number' && parsed.exp > now ? parsed.t : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | null | undefined, name: string) {
  return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header || '')?.[1];
}

// Decides which of the Pages a user granted may be saved: never steal another tenant's Page, never exceed the plan.
export function planConnect(limit: number, ownedIds: string[], foreignIds: string[], incomingIds: string[]) {
  const owned = new Set(ownedIds);
  const foreign = new Set(foreignIds);
  const allowed: string[] = [];
  const skipped: Array<{ id: string; reason: 'other_account' | 'plan_limit' }> = [];
  for (const id of incomingIds) {
    if (foreign.has(id)) skipped.push({ id, reason: 'other_account' });
    else if (owned.has(id)) allowed.push(id);
  }
  for (const id of incomingIds) {
    if (foreign.has(id) || owned.has(id)) continue;
    if (owned.size < limit) { owned.add(id); allowed.push(id); }
    else skipped.push({ id, reason: 'plan_limit' });
  }
  return { allowed, skipped };
}

// Meta sends deauthorize / data-deletion callbacks as signed_request = base64url(sig).base64url(payload).
export function parseSignedRequest(signedRequest: string | null | undefined, appSecret: string | undefined): { user_id?: string } | null {
  if (!signedRequest || !appSecret) return null;
  const [sig, payload, extra] = signedRequest.split('.');
  if (!sig || !payload || extra !== undefined) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { user_id?: string };
  } catch {
    return null;
  }
}
