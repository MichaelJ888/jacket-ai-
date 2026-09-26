import { NextResponse } from 'next/server';
import { escapeTelegramHtml, sendTelegramMessage } from '../_lib/integrations';

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json({ success: false, configured: false });
  }

  try {
    const body = await req.json();
    const text = [
      `MJIC ${body.type === 'quotation' ? 'QUOTATION' : 'NEW LEAD'}`,
      `Client: ${escapeTelegramHtml(String(body.client || 'Website visitor'))}`,
      `Details: ${escapeTelegramHtml(String(body.details || 'No details provided'))}`,
      body.value ? `Value: PHP ${Number(body.value).toLocaleString('en-PH')}` : '',
      body.action ? `Next action: ${escapeTelegramHtml(String(body.action))}` : '',
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(text);
    return NextResponse.json({ success: true, configured: true });
  } catch (error) {
    console.error('Telegram notification error:', error);
    return NextResponse.json({ success: false, configured: true }, { status: 502 });
  }
}
