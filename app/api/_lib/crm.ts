import { getSupabaseAdmin } from './integrations';

export type Channel = 'facebook' | 'instagram' | 'whatsapp' | 'manychat' | 'website' | 'email';
export type Stage = 'new' | 'engaged' | 'quoted' | 'negotiating' | 'won' | 'lost' | 'dormant';

export type CrmContact = {
  id: string;
  channel: Channel;
  external_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: Stage;
  tags: string[];
  lead_score: number;
  lifetime_value: number;
  orders_count: number;
  ai_paused: boolean;
  followup_count: number;
  next_followup_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  delivered_at: string | null;
  review_requested_at: string | null;
  page_id?: string | null;
};

export async function upsertContact(input: { channel: Channel; externalId: string; name?: string; phone?: string; email?: string; pageId?: string }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { contact: null, isNew: false, error: 'Supabase is not configured' };

  const existing = await supabase.from('crm_contacts').select('*').eq('channel', input.channel).eq('external_id', input.externalId).maybeSingle();
  if (existing.error) return { contact: null, isNew: false, error: existing.error.message };
  if (existing.data) {
    const patch: Record<string, unknown> = {};
    if (input.name && !existing.data.name) patch.name = input.name;
    if (input.phone && !existing.data.phone) patch.phone = input.phone;
    if (input.email && !existing.data.email) patch.email = input.email;
    if (input.pageId && existing.data.page_id !== input.pageId) patch.page_id = input.pageId;
    if (Object.keys(patch).length) await supabase.from('crm_contacts').update(patch).eq('id', existing.data.id);
    return { contact: { ...existing.data, ...patch } as CrmContact, isNew: false, error: null };
  }

  const inserted = await supabase.from('crm_contacts').insert({
    channel: input.channel,
    external_id: input.externalId,
    name: input.name || null,
    phone: input.phone || null,
    email: input.email || null,
    page_id: input.pageId || null,
  }).select('*').single();
  if (inserted.error) return { contact: null, isNew: false, error: inserted.error.message };
  return { contact: inserted.data as CrmContact, isNew: true, error: null };
}

export async function updateContact(id: string, patch: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('crm_contacts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  return { error: error?.message || null };
}

// Returns duplicate=true when the platform re-delivers a message id we already stored (Meta retries).
export async function logMessage(input: {
  contactId: string;
  channel: Channel;
  direction: 'in' | 'out';
  sender: 'customer' | 'ai' | 'human';
  content: string;
  externalMessageId?: string;
  status?: 'sent' | 'draft' | 'failed';
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { duplicate: false, error: 'Supabase is not configured' };
  const { error } = await supabase.from('inbox_messages').insert({
    contact_id: input.contactId,
    channel: input.channel,
    direction: input.direction,
    sender: input.sender,
    content: input.content.slice(0, 4000),
    external_message_id: input.externalMessageId || null,
    status: input.status || 'sent',
  });
  if (error?.code === '23505') return { duplicate: true, error: null };
  return { duplicate: false, error: error?.message || null };
}

export async function getRecentMessages(contactId: string, limit = 14) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data } = await supabase
    .from('inbox_messages')
    .select('direction, content, status')
    .eq('contact_id', contactId)
    .neq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse() as Array<{ direction: 'in' | 'out'; content: string; status: string }>;
}

// Cheap heuristic scoring; the CEO-facing pipeline sorts by this.
export function scoreMessage(text: string, current: number) {
  let score = current;
  if (/\b\d{2,5}\s*(pcs|pieces|piraso|jackets?|uniforms?|polo|shirts?)\b/i.test(text)) score += 25;
  if (/(quotation|quote|presyo|magkano|price|how much)/i.test(text)) score += 10;
  if (/(deposit|gcash|bank|bayad|paid|proof|invoice|po\b)/i.test(text)) score += 20;
  if (/(deadline|urgent|asap|rush|before|kailangan)/i.test(text)) score += 10;
  if (/(company|corp|inc\b|school|barangay|lgu|hospital|hotel|team)/i.test(text)) score += 10;
  return Math.min(100, score);
}

export function addHours(hours: number, from = new Date()) {
  return new Date(from.getTime() + hours * 3600 * 1000).toISOString();
}
