import { createHmac, timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { replyToComment } from '../../_lib/channels';
import { type Channel } from '../../_lib/crm';
import { reportCriticalError } from '../../_lib/integrations';
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
    from?: { id?: string; name?: string; username?: string };
    messages?: WhatsAppMessage[];
    contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  };
};

type Payload = { object?: string; entry?: Array<{ id?: string; messaging?: MessagingEvent[]; changes?: Change[] }> };

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
