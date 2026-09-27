import { NextResponse } from 'next/server';
import {
  claimEmbroideryPickupAlert,
  escapeTelegramHtml,
  listDueEmbroideryPickupAlerts,
  releaseEmbroideryPickupAlert,
  sendTelegramMessage,
} from '../../_lib/integrations';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const due = await listDueEmbroideryPickupAlerts(now);
  if (due.error) return NextResponse.json({ error: due.error }, { status: 502 });

  let sent = 0;
  for (const job of due.data) {
    const claimedAt = new Date();
    const claim = await claimEmbroideryPickupAlert(job.id, claimedAt);
    if (claim.error) return NextResponse.json({ error: claim.error, sent }, { status: 502 });
    if (!claim.data) continue;

    const pickupTime = new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    }).format(new Date(claim.data.pickup_commitment_at));
    const message = [
      '⏰ <b>EMBROIDERY PICKUP IN 30 MINUTES</b>',
      `Job: <b>${escapeTelegramHtml(claim.data.project_name || claim.data.client_name || claim.data.id)}</b>`,
      claim.data.embroiderer_name ? `Shop: <b>${escapeTelegramHtml(claim.data.embroiderer_name)}</b>` : '',
      `Target pickup: <b>${pickupTime}</b> (Asia/Manila)`,
      `Job ID: <code>${claim.data.id}</code>`,
    ].filter(Boolean).join('\n');

    if (!await sendTelegramMessage(message)) {
      await releaseEmbroideryPickupAlert(claim.data.id, claimedAt.toISOString());
      continue;
    }
    sent += 1;
  }

  return NextResponse.json({ success: true, checked: due.data.length, sent });
}