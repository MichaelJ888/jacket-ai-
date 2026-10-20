import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { isShadowMode } from '../../_lib/ceo-control';
import { sendChannelMessage } from '../../_lib/channels';
import { addHours, logMessage, updateContact, type CrmContact } from '../../_lib/crm';
import { escapeTelegramHtml, getSupabaseAdmin, isManilaDaytime, sendTelegramMessage } from '../../_lib/integrations';
import { generateFollowUp } from '../../_lib/sales-closer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HOURS = 3600 * 1000;

async function send(contact: CrmContact, text: string) {
  const result = await sendChannelMessage(contact.channel, contact.external_id, text, { pageId: contact.page_id || undefined });
  await logMessage({ contactId: contact.id, channel: contact.channel, direction: 'out', sender: 'ai', content: text, status: result.ok ? 'sent' : 'failed' });
  return result.ok;
}

// Meta DMs only allow free-form replies within 24h of the customer's last message,
// so follow-ups stop at 2 and the contact then goes dormant for human/CEO review.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const summary = { followups: 0, dormant: 0, reviews: 0, skipped: 0 };
  const now = new Date();

  if (isManilaDaytime() && !(await isShadowMode())) {
    const due = await supabase
      .from('crm_contacts')
      .select('*')
      .in('stage', ['engaged', 'quoted', 'negotiating'])
      .eq('ai_paused', false)
      .not('next_followup_at', 'is', null)
      .lte('next_followup_at', now.toISOString())
      .limit(8);

    for (const contact of (due.data || []) as CrmContact[]) {
      const lastInbound = contact.last_inbound_at ? new Date(contact.last_inbound_at).getTime() : 0;
      const metaChannel = contact.channel === 'facebook' || contact.channel === 'instagram' || contact.channel === 'whatsapp';
      const windowOpen = !metaChannel || Date.now() - lastInbound < 23.5 * HOURS;

      if (contact.followup_count >= 2 || !windowOpen) {
        await updateContact(contact.id, { stage: 'dormant', next_followup_at: null });
        summary.dormant += 1;
        void sendTelegramMessage(`<b>Lead gone quiet</b> (${escapeTelegramHtml(contact.name || contact.external_id)} via ${contact.channel}, score ${contact.lead_score}). AI follow-ups exhausted; consider a personal call.`);
        continue;
      }

      try {
        const text = await generateFollowUp(contact, contact.followup_count + 1);
        if (!text) { summary.skipped += 1; continue; }
        const ok = await send(contact, text);
        await updateContact(contact.id, {
          followup_count: contact.followup_count + 1,
          last_outbound_at: now.toISOString(),
          next_followup_at: ok ? addHours(contact.followup_count === 0 ? 19 : 24) : addHours(2),
        });
        if (ok) summary.followups += 1; else summary.skipped += 1;
      } catch (error) {
        console.error('follow-up failed:', error);
        summary.skipped += 1;
      }
    }

    const delivered = await supabase
      .from('crm_contacts')
      .select('*')
      .not('delivered_at', 'is', null)
      .is('review_requested_at', null)
      .eq('ai_paused', false)
      .lte('delivered_at', new Date(now.getTime() - 24 * HOURS).toISOString())
      .limit(5);

    for (const contact of (delivered.data || []) as CrmContact[]) {
      const first = (contact.name || '').split(' ')[0];
      const text = `Hi${first ? ` ${first}` : ''}! Salamat po sa tiwala sa MJIC. Kumusta po ang jackets/uniforms ninyo? Kung nasiyahan po kayo, malaking tulong ang isang review sa aming page, at kung may reorder o additional needs ang team ninyo, nandito lang po kami. 🙏`;
      const ok = await send(contact, text);
      await updateContact(contact.id, { review_requested_at: now.toISOString(), ...(ok ? { last_outbound_at: now.toISOString() } : {}) });
      if (ok) summary.reviews += 1;
    }
    // Delivered orders with no CRM contact can't get an automated message — nudge staff for a personal follow-up.
    const manual = await supabase.from('orders').select('id, order_number, client_name').is('contact_id', null).is('aftercare_notified_at', null).not('delivered_at', 'is', null).lte('delivered_at', new Date(now.getTime() - 24 * HOURS).toISOString()).limit(5);
    for (const order of manual.data || []) {
      void sendTelegramMessage(`<b>Post-sale follow-up due</b>: ${escapeTelegramHtml(`${order.order_number} · ${order.client_name || 'customer'}`)} was delivered 24h+ ago. Please check satisfaction and ask for a review/reorder.`);
      await supabase.from('orders').update({ aftercare_notified_at: now.toISOString() }).eq('id', order.id);
      summary.reviews += 1;
    }
  }

  await recordHeartbeat('sales-followups', 'ok', summary);
  return NextResponse.json({ success: true, ...summary });
}
