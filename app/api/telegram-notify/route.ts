import { NextResponse } from 'next/server';

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
      `Client: ${body.client || 'Website visitor'}`,
      `Details: ${body.details || 'No details provided'}`,
      body.value ? `Value: PHP ${Number(body.value).toLocaleString('en-PH')}` : '',
      body.action ? `Next action: ${body.action}` : '',
    ].filter(Boolean).join('\n');

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Telegram notification failed:', error);
      return NextResponse.json({ success: false, configured: true }, { status: 502 });
    }

    return NextResponse.json({ success: true, configured: true });
  } catch (error) {
    console.error('Telegram notification error:', error);
    return NextResponse.json({ success: false, configured: true }, { status: 502 });
  }
}
