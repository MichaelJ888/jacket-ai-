import { NextResponse } from 'next/server';
import { escapeTelegramHtml, recordLead, sendTelegramMessage } from '../../_lib/integrations';

function isAuthorized(req: Request) {
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get('x-manychat-secret');
  const authorization = req.headers.get('authorization');
  return headerSecret === secret || authorization === `Bearer ${secret}`;
}

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

    await recordLead({
      name,
      contact,
      message: message || 'ManyChat lead event',
      source: 'manychat-webhook',
      details: payload,
    });
    void sendTelegramMessage([
      '<b>NEW MANYCHAT LEAD</b>',
      name ? `<b>Name:</b> ${escapeTelegramHtml(String(name))}` : '',
      contact ? `<b>Contact:</b> ${escapeTelegramHtml(String(contact))}` : '',
      message ? `<b>Message:</b> ${escapeTelegramHtml(String(message))}` : '',
    ].filter(Boolean).join('\n'));

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('ManyChat webhook error:', error);
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  }
}
