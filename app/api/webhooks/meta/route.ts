import { createHmac, timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { GRAPH, replyToComment } from '../../_lib/channels';
import { type Channel, upsertContact } from '../../_lib/crm';
import { isMjicLeadgenPage, leadgenExternalId } from '../../_lib/leadgen-crm-logic.ts';
import { escapeTelegramHtml, recordLead, reportCriticalError, sendTelegramMessage } from '../../_lib/integrations';
import { parseLeadgenFieldData } from '../../_lib/meta-lead-logic.ts';
import { getPageToken } from '../../_lib/meta-pages';
import { handleInboundMessage } from '../../_lib/sales-closer';

export const maxDuration = 60;

// Fails closed: without META_APP_SECRET nothing can be authenticated.
function verifyMetaSignature(body: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false;
  if (!signature?.startsWith('sha256=')) return false;

  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(req: Request) {
  if (!process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.error('Meta webhook handshake unavailable: META_WEBHOOK_VERIFY_TOKEN is missing.');
    return NextResponse.json({ error: 'Meta webhook is not configured' }, { status: 503 });
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  return NextResponse.json({ error: 'Webhook verification failed' }, { status: 403 });
}

type Job = () => Promise<unknown>;

type MessagingEvent = {
  sender?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string; payload?: { url?: string } }> };
};

type WhatsAppMessage = { id?: string; from?: string; text?: { body?: string }; image?: { id?: string }; type?: string };

type Change = {
  field?: string;
  value?: {
    item?: string;
    verb?: string;
    comment_id?: string;
    id?: string;
    message?: string;
    text?: string;
    leadgen_id?: string;
    form_id?: string;
    ad_id?: string;
    from?: { id?: string; name?: string; username?: string };
    messages?: WhatsAppMessage[];
    contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  };
};

type Payload = { object?: string; entry?: Array<{ id?: string; messaging?: MessagingEvent[]; changes?: Change[] }> };

// Lead-ads form submissions are accepted only from the configured MJIC Page.
async function handleLeadgen(leadgenId: string, pageId?: string, formId?: string, adId?: string) {
  const mjicPageId = process.env.META_PAGE_ID;
  if (!isMjicLeadgenPage(pageId, mjicPageId)) {
    console.error(`Ignoring Meta leadgen ${leadgenId}: Page ID does not match the configured MJIC META_PAGE_ID.`);
    return;
  }
  if (mjicPageId === process.env.META_CGV_PAGE_ID) {
    console.error(`Ignoring Meta leadgen ${leadgenId}: META_PAGE_ID conflicts with META_CGV_PAGE_ID.`);
    return;
  }
  const token = await getPageToken(pageId);
  if (!token) {
    console.error(`Leadgen ${leadgenId}: no Page access token for configured MJIC Page ${mjicPageId}.`);
    return;
  }
  const response = await fetch(`${GRAPH}/${leadgenId}?fields=field_data,created_time,form_id,ad_id`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    console.error(`Leadgen ${leadgenId}: Graph fetch failed with HTTP ${response.status}.`);
    return;
  }
  const data = (await response.json()) as { field_data?: unknown; form_id?: string; ad_id?: string };
  const parsed = parseLeadgenFieldData(data.field_data);
  await recordLead({
    name: parsed.name || 'Facebook lead',
    company: parsed.company || undefined,
    contact: parsed.contact || undefined,
    message: parsed.message || 'Facebook lead-ad signup',
    source: 'facebook-lead-ad',
    details: { leadgenId, pageId, formId: data.form_id || formId || null, adId: data.ad_id || adId || null, email: parsed.email || null, phone: parsed.phone || null },
  });
  const crm = await upsertContact({
    channel: 'facebook',
    externalId: leadgenExternalId(leadgenId),
    name: parsed.name || undefined,
    phone: parsed.phone || undefined,
    email: parsed.email || undefined,
    pageId,
  });
  if (crm.error) console.error(`Leadgen ${leadgenId}: CRM upsert failed: ${crm.error}`);
  await sendTelegramMessage(
    `🎯 <b>New MJIC Facebook lead ad signup</b>\n` +
      `Name: ${escapeTelegramHtml(parsed.name || '—')}\n` +
      `Contact: ${escapeTelegramHtml(parsed.contact || '—')}\n` +
      (parsed.company ? `Company: ${escapeTelegramHtml(parsed.company)}\n` : '') +
      `Lead ID: ${escapeTelegramHtml(leadgenId)}`,
  );
}

function collectJobs(payload: Payload) {
  const jobs: Job[] = [];
  const socialChannel: Channel = payload.object === 'instagram' ? 'instagram' : 'facebook';

  for (const entry of payload.entry || []) {
    // Messenger / Instagram DMs
    for (const event of entry.messaging || []) {
      const message = event.message;
      const senderId = event.sender?.id;
      if (!message || message.is_echo || !senderId || senderId === entry.id) continue;
      const imageUrls = (message.attachments || []).filter((item) => item.type === 'image' && item.payload?.url).map((item) => item.payload!.url!);
      const pageId = entry.id;
      jobs.push(() => handleInboundMessage({ channel: socialChannel, pageId, externalId: senderId, text: message.text || '', messageId: message.mid, imageUrls }));
    }

    for (const change of entry.changes || []) {
      const value = change.value || {};

      // Facebook lead-ads (leadgen) form submission
      if (change.field === 'leadgen' && value.leadgen_id) {
        const leadgenId = value.leadgen_id;
        jobs.push(() => handleLeadgen(leadgenId, entry.id, value.form_id, value.ad_id));
      }

      // WhatsApp Cloud API
      for (const message of value.messages || []) {
        const from = message.from || value.contacts?.[0]?.wa_id;
        if (!from) continue;
        const text = message.text?.body || '';
        if (!text && message.type !== 'image') continue;
        const name = value.contacts?.[0]?.profile?.name;
        jobs.push(() => handleInboundMessage({
          channel: 'whatsapp',
          externalId: from,
          phone: from,
          name,
          text: text || '[image attachment]',
          messageId: message.id,
          imageUrls: message.type === 'image' ? [`whatsapp-media-id:${message.image?.id || ''}`] : [],
        }));
      }

      // Facebook Page comment -> private reply + short public reply
      if (change.field === 'feed' && value.item === 'comment' && value.verb === 'add' && value.comment_id && value.from?.id && value.from.id !== entry.id && value.message) {
        const commentId = value.comment_id;
        const text = value.message;
        const from = value.from;
        jobs.push(async () => {
          const result = await handleInboundMessage({ channel: 'facebook', pageId: entry.id, externalId: from.id!, name: from.name, text, messageId: `comment:${commentId}`, commentId });
          if (result.handled && !result.duplicate) await replyToComment('facebook', commentId, publicCommentText(result, 'Salamat po sa inyong comment! Na-message na po namin kayo para sa details at quotation.'), entry.id);
        });
      }

      // Instagram comment
      if (change.field === 'comments' && value.id && value.from?.id && value.from.id !== entry.id && value.text) {
        const commentId = value.id;
        const text = value.text;
        const from = value.from;
        jobs.push(async () => {
          const result = await handleInboundMessage({ channel: 'instagram', pageId: entry.id, externalId: from.id!, name: from.username, text, messageId: `comment:${commentId}`, commentId });
          if (result.handled && !result.duplicate) await replyToComment('instagram', commentId, publicCommentText(result, 'Salamat po! Na-DM na po namin kayo para sa details at quotation.'), entry.id);
        });
      }
    }
  }
  return jobs;
}

// If the private reply could not be delivered, answer publicly so the commenter is never ignored.
function publicCommentText(result: { sent: boolean; reply: string | null }, sentText: string) {
  if (result.sent || !result.reply) return sentText;
  const answer = result.reply.replace(/\s+/g, ' ').trim().slice(0, 420);
  return `${answer}\n\nPara sa quotation, i-message lang po kami sa page na ito. Salamat po!`;
}
export async function POST(req: Request) {
  if (!process.env.META_APP_SECRET) {
    console.error('Meta webhook authentication unavailable: META_APP_SECRET is missing.');
    return NextResponse.json({ error: 'Meta webhook is not configured' }, { status: 503 });
  }
  const rawBody = await req.text();
  if (!verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  }

  const jobs = collectJobs(payload);
  // Acknowledge immediately (Meta retries slow webhooks); the AI reply runs after the response.
  after(async () => {
    for (const job of jobs) {
      try {
        await job();
      } catch (error) {
        await reportCriticalError('meta-webhook:job', error);
      }
    }
  });

  return NextResponse.json({ received: true, queued: jobs.length });
}
