import { getSupabaseAdmin } from './integrations';
import { getConnectionToken } from './meta-oauth';
import { type BotProfile, draftFromPage, EMPTY_PROFILE, profileProblems, sanitizeProfile } from './tenant-bot-logic';

const GRAPH = 'https://graph.facebook.com/v21.0';

function db() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error('Supabase is not configured');
  return client;
}

export type TenantBot = { tenantId: string; profile: BotProfile };

export async function getProfile(tenantId: string): Promise<BotProfile | null> {
  const { data } = await db().from('bot_profiles').select('business_name,about,offers,contact_info,tone,language,handoff_message,enabled').eq('tenant_id', tenantId).maybeSingle();
  return data ? sanitizeProfile(data as Record<string, unknown>) : null;
}

export async function saveProfile(tenantId: string, input: Record<string, unknown>): Promise<{ profile: BotProfile; problems: string[] }> {
  const profile = sanitizeProfile(input);
  const problems = profileProblems(profile);
  // Going live without facts would make the assistant improvise, so force it off until the profile is usable.
  if (problems.length) profile.enabled = false;
  const { error } = await db().from('bot_profiles').upsert({ tenant_id: tenantId, ...profile, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw new Error(error.message);
  return { profile, problems };
}

// Returns null for pages MJIC owns (no tenant) so they keep the MJIC prompt. For a tenant page the bot is returned even
// when disabled, so callers can stay silent instead of falling back to the MJIC prompt.
export async function getTenantBotForPage(pageId?: string | null): Promise<(TenantBot & { enabled: boolean }) | null> {
  if (!pageId) return null;
  try {
    const { data } = await db().from('meta_connections').select('tenant_id').eq('page_id', pageId).maybeSingle();
    const tenantId = (data as { tenant_id?: string | null } | null)?.tenant_id;
    if (!tenantId) return null;
    const profile = (await getProfile(tenantId)) || EMPTY_PROFILE;
    return { tenantId, profile, enabled: profile.enabled && profileProblems(profile).length === 0 };
  } catch {
    return null;
  }
}

// First connection: pre-fill the assistant from the Page's own public info so the owner only reviews it.
export async function ensureDraftProfile(tenantId: string, pageId: string) {
  if (await getProfile(tenantId)) return;
  const token = await getConnectionToken(pageId);
  if (!token) return;
  try {
    const url = new URL(`${GRAPH}/${pageId}`);
    url.searchParams.set('fields', 'name,about,description,phone,emails,website,single_line_address,category');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    const data = response.ok ? await response.json() : {};
    await db().from('bot_profiles').upsert({ tenant_id: tenantId, ...draftFromPage(data), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id', ignoreDuplicates: true });
  } catch {
    // The owner can still fill the form by hand.
  }
}

export type InboxRow = { id: string; name: string | null; channel: string; stage: string; ai_paused: boolean; last_inbound_at: string | null; page_id: string | null };

export async function tenantInbox(tenantId: string): Promise<InboxRow[]> {
  const { data: pages } = await db().from('meta_connections').select('page_id').eq('tenant_id', tenantId);
  const ids = ((pages || []) as Array<{ page_id: string }>).map((row) => row.page_id);
  if (!ids.length) return [];
  const { data } = await db().from('crm_contacts').select('id,name,channel,stage,ai_paused,last_inbound_at,page_id').in('page_id', ids).order('last_inbound_at', { ascending: false, nullsFirst: false }).limit(30);
  return (data || []) as InboxRow[];
}

export async function resumeContact(tenantId: string, contactId: string) {
  const rows = await tenantInbox(tenantId);
  if (!rows.some((row) => row.id === contactId)) return false;
  const { error } = await db().from('crm_contacts').update({ ai_paused: false, updated_at: new Date().toISOString() }).eq('id', contactId);
  return !error;
}
