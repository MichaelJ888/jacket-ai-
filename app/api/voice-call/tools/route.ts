import { NextResponse } from 'next/server';
import { escapeTelegramHtml, getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';
import { maskPhone, normalizePhone, verifyRetellSignature } from '../../_lib/voice-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

type ToolBody = { name?: string; args?: Record<string, unknown>; call?: { call_id?: string; from_number?: string } };

const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// Retell custom functions. Deliberately narrow: stage-only order lookup, lead capture, human callback alert.
export async function POST(req: Request) {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Voice AI is not configured' }, { status: 503 });
  const raw = await req.text();
  if (!verifyRetellSignature(raw, apiKey, req.headers.get('x-retell-signature'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ToolBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }
  const args = body.args || {};
  const callerPhone = body.call?.from_number ? normalizePhone(body.call.from_number) : '';
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ result: 'System is busy. Please tell the caller we will call back.' });

  switch (body.name) {
    case 'check_order_status': {
      const orderNumber = clean(args.order_number, 40);
      if (!orderNumber) return NextResponse.json({ result: 'Ask the caller for their order number.' });
      const { data } = await supabase.from('orders').select('stage, contact_phone').eq('order_number', orderNumber).maybeSingle();
      // Order details are only given when the caller ID matches the order's phone.
      if (!data || !callerPhone || normalizePhone(data.contact_phone) !== callerPhone) {
        return NextResponse.json({ result: 'I could not verify that order for this phone number. Offer a callback from the team.' });
      }
      return NextResponse.json({ result: `Order stage: ${String(data.stage).replace(/_/g, ' ').toLowerCase()}.` });
    }
    case 'create_lead': {
      const name = clean(args.name, 120);
      const details = clean(args.request, 800);
      const contact = clean(args.contact, 60) || callerPhone;
      if (!name || !details) return NextResponse.json({ result: 'Ask for the name and what they need first.' });
      const { error } = await supabase.from('leads').insert({ name, contact, message: details, source: 'phone', details: { call_id: body.call?.call_id ?? null } });
      if (error) return NextResponse.json({ result: 'Could not save. Tell the caller the team will call back.' });
      await sendTelegramMessage(`<b>NEW PHONE LEAD</b>\n${escapeTelegramHtml(`${name} | ${maskPhone(contact)}\n${details}`)}`);
      return NextResponse.json({ result: 'Lead saved. Tell the caller our team will contact them.' });
    }
    case 'request_human_callback': {
      const reason = clean(args.reason, 400) || 'Caller asked for a person';
      await sendTelegramMessage(`<b>URGENT: CALLBACK REQUESTED</b>\nCaller: ${escapeTelegramHtml(callerPhone || 'unknown')}\n${escapeTelegramHtml(reason)}`);
      return NextResponse.json({ result: 'The team has been alerted and will call back soon.' });
    }
    default:
      return NextResponse.json({ result: 'Unknown function.' });
  }
}
