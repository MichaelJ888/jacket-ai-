import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { buildSubconOutreachTemplate, isValidEmail, maySendSubconOutreach } from '../../../_lib/subcon-outreach-logic';

export const dynamic = 'force-dynamic';

type SubconRecord = {
  id: string;
  name: string;
  specialty: string | null;
  email: string | null;
  email_opt_in: boolean;
  email_opt_in_at: string | null;
  email_opt_in_evidence: string | null;
  email_opted_out_at: string | null;
  vetted: boolean;
  vetted_at: string | null;
  vetting_evidence: string | null;
  active: boolean;
};

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data, error } = await supabase
    .from('subcon_directory')
    .select('id,name,specialty,email,email_opt_in,email_opt_in_at,email_opt_in_evidence,email_opted_out_at,vetted,vetted_at,vetting_evidence,active')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    subcons: (data ?? []) as SubconRecord[],
    resendConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    subconId?: unknown;
    email?: unknown;
    optedIn?: unknown;
    vetted?: unknown;
    evidence?: unknown;
    requestId?: unknown;
    confirmSend?: unknown;
  } | null;
  if (typeof body?.subconId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.subconId)) {
    return NextResponse.json({ error: 'A valid subconId is required.' }, { status: 400 });
  }

  if (body.action === 'vetting') {
    if (typeof body.vetted !== 'boolean') return NextResponse.json({ error: 'vetted must be a boolean.' }, { status: 400 });
    const evidence = typeof body.evidence === 'string' ? body.evidence.trim().slice(0, 500) : '';
    if (body.vetted && !evidence) return NextResponse.json({ error: 'Record the vetting source before approving this subcontractor.' }, { status: 400 });
    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from('subcon_directory').update({
      vetted: body.vetted,
      vetted_at: body.vetted ? now : null,
      vetting_evidence: body.vetted ? evidence : null,
      updated_at: now,
    }).eq('id', body.subconId).select('id').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: 'Subcontractor not found.' }, { status: 404 });
    return NextResponse.json({ success: true, vetted: body.vetted });
  }

  if (body.action === 'consent') {
    if (typeof body.email !== 'string' || !isValidEmail(body.email.trim())) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }
    if (typeof body.optedIn !== 'boolean') return NextResponse.json({ error: 'optedIn must be a boolean.' }, { status: 400 });
    const evidence = typeof body.evidence === 'string' ? body.evidence.trim().slice(0, 500) : '';
    if (body.optedIn && !evidence) {
      return NextResponse.json({ error: 'Record the source of the subcontractor’s explicit email consent before enabling outreach.' }, { status: 400 });
    }
    const consentPatch = body.optedIn
      ? { email_opt_in: true, email_opt_in_at: new Date().toISOString(), email_opt_in_evidence: evidence, email_opted_out_at: null }
      : { email_opt_in: false, email_opted_out_at: new Date().toISOString() };
    const { data: updated, error } = await supabase.from('subcon_directory').update({
      email: body.email.trim().toLowerCase(),
      ...consentPatch,
      updated_at: new Date().toISOString(),
    }).eq('id', body.subconId).select('id').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: 'Subcontractor not found.' }, { status: 404 });
    return NextResponse.json({ success: true, optedIn: body.optedIn });
  }

  if (body.action !== 'send' || body.confirmSend !== true || typeof body.requestId !== 'string'
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.requestId)) {
    return NextResponse.json({ error: 'A confirmed single-recipient send with a unique requestId is required.' }, { status: 400 });
  }

  const { data: subcon, error: subconError } = await supabase
    .from('subcon_directory')
    .select('id,name,specialty,email,email_opt_in,email_opt_in_at,email_opt_in_evidence,email_opted_out_at,vetted,vetted_at,vetting_evidence,active')
    .eq('id', body.subconId)
    .maybeSingle();
  if (subconError) return NextResponse.json({ error: subconError.message }, { status: 500 });
  const recipient = subcon as SubconRecord | null;
  if (!recipient) return NextResponse.json({ error: 'Subcontractor not found.' }, { status: 404 });
  if (!recipient.active) return NextResponse.json({ error: 'Inactive subcontractors cannot be contacted.' }, { status: 409 });
  if (!maySendSubconOutreach(recipient)) {
    return NextResponse.json({ error: 'Verified explicit email opt-in is required before outreach.' }, { status: 403 });
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    return NextResponse.json({ error: 'Resend is not configured. Add RESEND_API_KEY and RESEND_FROM to enable email outreach.' }, { status: 503 });
  }

  const existing = await supabase
    .from('crm_contacts')
    .select('id,tags')
    .eq('channel', 'email')
    .eq('external_id', recipient.email)
    .maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  let contactId: string;
  if (existing.data) {
    contactId = existing.data.id;
    const tags = Array.isArray(existing.data.tags) ? existing.data.tags.map(String) : [];
    if (!tags.includes('subcon')) tags.push('subcon');
    const { error } = await supabase.from('crm_contacts').update({ tags, email: recipient.email, updated_at: new Date().toISOString() }).eq('id', contactId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await supabase.from('crm_contacts').insert({
      channel: 'email',
      external_id: recipient.email,
      email: recipient.email,
      name: recipient.name,
      company: 'Garment subcontractor',
      tags: ['subcon'],
    }).select('id').single();
    if (error || !data) return NextResponse.json({ error: error?.message || 'Could not create CRM contact.' }, { status: 500 });
    contactId = data.id;
  }

  const template = buildSubconOutreachTemplate(recipient.name, recipient.specialty);
  const correlationId = `subcon-outreach:${body.requestId}`;
  const { data: message, error: messageError } = await supabase.from('inbox_messages').insert({
    contact_id: contactId,
    channel: 'email',
    direction: 'out',
    sender: 'human',
    content: `${template.subject}\n\n${template.text}`,
    external_message_id: correlationId,
    status: 'draft',
  }).select('id').single();
  if (messageError || !message) {
    if (messageError?.code === '23505') return NextResponse.json({ error: 'This outreach request was already processed.' }, { status: 409 });
    return NextResponse.json({ error: messageError?.message || 'Could not create the CRM outreach record.' }, { status: 500 });
  }

  let sendError: string | null = null;
  let providerMessageId: string | undefined;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [recipient.email], subject: template.subject, text: template.text }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
    if (!response.ok) sendError = result.message || result.error || `Resend HTTP ${response.status}`;
    else providerMessageId = result.id;
  } catch (error) {
    sendError = error instanceof Error ? error.message : 'Resend request failed.';
  }

  if (sendError) {
    const { error } = await supabase.from('inbox_messages').update({ status: 'failed' }).eq('id', message.id);
    if (error) return NextResponse.json({ error: `Resend failed (${sendError}); CRM status update also failed (${error.message}).` }, { status: 502 });
    return NextResponse.json({ error: `Resend failed: ${sendError}. The failed attempt is recorded in CRM.` }, { status: 502 });
  }

  const now = new Date().toISOString();
  const [messageUpdate, contactUpdate] = await Promise.all([
    supabase.from('inbox_messages').update({ status: 'sent' }).eq('id', message.id),
    supabase.from('crm_contacts').update({ last_outbound_at: now, updated_at: now }).eq('id', contactId),
  ]);
  if (messageUpdate.error || contactUpdate.error) {
    return NextResponse.json({
      error: `Email was accepted by Resend${providerMessageId ? ` (${providerMessageId})` : ''}, but CRM status could not be fully updated: ${messageUpdate.error?.message || contactUpdate.error?.message}.`,
    }, { status: 502 });
  }
  return NextResponse.json({ success: true, status: 'sent', crmContactId: contactId, providerMessageId });
}
