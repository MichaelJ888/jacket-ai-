import { NextResponse } from 'next/server';
import { handleInboundMessage } from '../../_lib/sales-closer';
import { recordLead } from '../../_lib/integrations';

export const maxDuration = 30;

function isAuthorized(req: Request) {
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get('x-manychat-secret');
  const authorization = req.headers.get('authorization');
  return headerSecret === secret || authorization === `Bearer ${secret}`;
}

// ManyChat "External Request" expects a v2 dynamic-content body, so the AI reply is returned inline
// and ManyChat delivers it on whichever channel (IG / FB / WhatsApp / TikTok) the contact came from.
export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const payload = await req.json();
    const customFields = payload.custom_fields || payload.customFields || {};
    const name = payload.name || payload.first_name || payload.firstName || customFields.name || '';
    const contact = payload.phone || payload.email || payload.user_id || payload.userId || '';
    const message = payload.message || payload.text || payload.last_input || payload.lastInput || '';

    if (!message && !contact && !name) {
      return NextResponse.json({ error: 'No lead content found' }, { status: 400 });
    }

    if (!message || !contact) {
      await recordLead({ name, contact, message: message || 'ManyChat lead event', source: 'manychat-webhook', details: payload });
      return NextResponse.json({ received: true });
    }

    const result = await Promise.race([
      handleInboundMessage({
        channel: 'manychat',
        externalId: String(payload.user_id || payload.userId || contact),
        name: String(name || ''),
        phone: payload.phone ? String(payload.phone) : undefined,
        email: payload.email ? String(payload.email) : undefined,
        text: String(message),
        messageId: payload.message_id ? `manychat:${payload.message_id}` : undefined,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8500)),
    ]);

    if (result?.reply) {
      return NextResponse.json({ version: 'v2', content: { messages: [{ type: 'text', text: result.reply }] } });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('ManyChat webhook error:', error);
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  }
}
