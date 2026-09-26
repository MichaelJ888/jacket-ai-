import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { escapeTelegramHtml, recordLead, sendTelegramMessage } from '../../_lib/integrations';

function verifyMetaSignature(body: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true;
  if (!signature?.startsWith('sha256=')) return false;

  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  return NextResponse.json({ error: 'Webhook verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody);
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    let processed = 0;

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const message of messages) {
          const text = typeof message.text?.body === 'string' ? message.text.body : '';
          if (!text) continue;
          const contact = message.from || value.contacts?.[0]?.wa_id || '';
          await recordLead({
            contact,
            message: text,
            source: payload.object === 'instagram' ? 'instagram-webhook' : 'facebook-webhook',
            details: { messageId: message.id, field: change.field, entryId: entry.id },
          });
          void sendTelegramMessage(`<b>NEW SOCIAL INQUIRY</b>\n<b>Source:</b> ${escapeTelegramHtml(String(payload.object || 'meta'))}\n<b>Contact:</b> ${escapeTelegramHtml(String(contact))}\n<b>Message:</b> ${escapeTelegramHtml(text)}`);
          processed += 1;
        }
      }
    }

    return NextResponse.json({ received: true, processed });
  } catch (error) {
    console.error('Meta webhook error:', error);
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  }
}
