import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../_lib/auth';
import { sendChannelMessage } from '../_lib/channels';
import { logMessage, updateContact, type CrmContact } from '../_lib/crm';
import { getSupabaseAdmin } from '../_lib/integrations';

export const dynamic = 'force-dynamic';

const STAGES = ['new', 'engaged', 'quoted', 'negotiating', 'won', 'lost', 'dormant'];

// GET ?id=<contact>  -> contact + conversation;  GET ?stage=quoted -> list;  GET -> pipeline counts + hottest leads.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const params = new URL(request.url).searchParams;

  const id = params.get('id');
  if (id) {
    const [contact, messages] = await Promise.all([
      supabase.from('crm_contacts').select('*').eq('id', id).maybeSingle(),
      supabase.from('inbox_messages').select('direction, sender, content, status, created_at').eq('contact_id', id).order('created_at', { ascending: false }).limit(50),
    ]);
    return NextResponse.json({ success: true, contact: contact.data, messages: messages.data || [] });
  }

  const stage = params.get('stage');
  if (stage) {
    const { data } = await supabase.from('crm_contacts').select('*').eq('stage', stage).order('lead_score', { ascending: false }).limit(100);
    return NextResponse.json({ success: true, contacts: data || [] });
  }

  const pipeline: Record<string, number> = {};
  for (const name of STAGES) {
    const { count } = await supabase.from('crm_contacts').select('id', { count: 'exact', head: true }).eq('stage', name);
    pipeline[name] = count || 0;
  }
  const hot = await supabase.from('crm_contacts').select('id, name, channel, stage, lead_score, last_inbound_at, ai_paused').not('stage', 'in', '(won,lost,dormant)').order('lead_score', { ascending: false }).limit(10);
  const paused = await supabase.from('crm_contacts').select('id, name, channel, last_inbound_at').eq('ai_paused', true).limit(20);
  return NextResponse.json({ success: true, pipeline, hot: hot.data || [], needsHuman: paused.data || [] });
}

// POST { id, stage?, tags?, ai_paused?, delivered?, reply?, order_value? }
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as {
    id?: string; stage?: string; tags?: string[]; ai_paused?: boolean; delivered?: boolean; reply?: string; order_value?: number;
  };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const found = await supabase.from('crm_contacts').select('*').eq('id', body.id).maybeSingle();
  const contact = found.data as CrmContact | null;
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (body.stage) {
    if (!STAGES.includes(body.stage)) return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
    patch.stage = body.stage;
    if (body.stage === 'won' || body.stage === 'lost') patch.next_followup_at = null;
  }
  if (Array.isArray(body.tags)) patch.tags = body.tags.map(String).slice(0, 20);
  if (typeof body.ai_paused === 'boolean') patch.ai_paused = body.ai_paused;
  if (body.delivered) patch.delivered_at = new Date().toISOString();
  if (body.order_value && body.order_value > 0) {
    patch.lifetime_value = Number(contact.lifetime_value || 0) + body.order_value;
    patch.orders_count = Number(contact.orders_count || 0) + 1;
    patch.stage = 'won';
  }

  let sent: boolean | null = null;
  if (body.reply?.trim()) {
    const result = await sendChannelMessage(contact.channel, contact.external_id, body.reply.trim());
    sent = result.ok;
    await logMessage({ contactId: contact.id, channel: contact.channel, direction: 'out', sender: 'human', content: body.reply.trim(), status: result.ok ? 'sent' : 'failed' });
    patch.last_outbound_at = new Date().toISOString();
  }

  const { error } = await updateContact(contact.id, patch);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ success: true, replySent: sent });
}
