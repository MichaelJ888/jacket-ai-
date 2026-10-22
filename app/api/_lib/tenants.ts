import { isAdminAuthorized } from './auth';
import { getSupabaseAdmin } from './integrations';
import { pageLimit, readCookie, sessionSecret, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from './tenant-logic';

export type Tenant = { id: string; name: string | null; email: string | null; plan: string };

function db() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase is not configured');
  return client;
}

// Facebook identity is the account: first login creates the tenant, later logins refresh it. Plan is never touched here.
export async function upsertTenantFromProfile(profile: { id: string; name?: string; email?: string }): Promise<Tenant> {
  const { data, error } = await db()
    .from('tenants')
    .upsert({ fb_user_id: profile.id, name: profile.name ?? null, email: profile.email ?? null, last_login_at: new Date().toISOString() }, { onConflict: 'fb_user_id' })
    .select('id,name,email,plan')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not save account');
  return data as Tenant;
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const { data } = await db().from('tenants').select('id,name,email,plan').eq('id', id).maybeSingle();
  return (data as Tenant | null) || null;
}

export function sessionCookieFor(tenantId: string) {
  const secret = sessionSecret();
  if (!secret) return null;
  return {
    name: SESSION_COOKIE,
    value: signSession(tenantId, secret),
    options: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: Math.floor(SESSION_TTL_MS / 1000) },
  };
}

export async function tenantFromRequest(req: Request): Promise<Tenant | null> {
  const id = verifySession(readCookie(req.headers.get('cookie'), SESSION_COOKIE), sessionSecret());
  return id ? getTenant(id) : null;
}

export type Caller = { kind: 'admin' } | { kind: 'tenant'; tenant: Tenant };

// Admin bearer sees everything; a buyer session sees only its own tenant.
export async function resolveCaller(req: Request): Promise<Caller | null> {
  if (isAdminAuthorized(req)) return { kind: 'admin' };
  const tenant = await tenantFromRequest(req).catch(() => null);
  return tenant ? { kind: 'tenant', tenant } : null;
}

export const tenantScope = (caller: Caller) => (caller.kind === 'tenant' ? caller.tenant.id : undefined);

export function describeTenant(tenant: Tenant) {
  return { name: tenant.name, email: tenant.email, plan: tenant.plan, pageLimit: pageLimit(tenant.plan) };
}

export async function listTenants() {
  const { data, error } = await db().from('tenants').select('id,name,email,plan,created_at,last_login_at').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function setTenantPlan(id: string, plan: string) {
  const { error } = await db().from('tenants').update({ plan }).eq('id', id);
  if (error) throw new Error(error.message);
}

// Used by Meta's deauthorize callback: forget the buyer and (via cascade) their Page tokens.
export async function deleteTenantByFacebookUser(fbUserId: string) {
  const { data: tenant } = await db().from('tenants').select('id').eq('fb_user_id', fbUserId).maybeSingle();
  if (!tenant) return false;
  const id = (tenant as { id: string }).id;
  const { data: rows } = await db().from('meta_connections').select('page_id').eq('tenant_id', id);
  const { disconnectPage } = await import('./meta-oauth');
  for (const row of (rows || []) as Array<{ page_id: string }>) await disconnectPage(row.page_id).catch(() => undefined);
  await db().from('tenants').delete().eq('id', id);
  return true;
}
