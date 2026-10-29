import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { buildClientPulseMessage, buildOrderPulseMessage, listOpenOrders, sortOrdersForPulse } from '../../_lib/client-pulse';
import { sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// 2x-daily per-client action list (6AM & 1PM Manila via GitHub Actions scheduler).
// Sends ONE Telegram message per client so each next-step is its own text.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const orders = sortOrdersForPulse(await listOpenOrders());
  if (!orders.length) {
    const sent = await sendTelegramMessage(buildClientPulseMessage([]));
    await recordHeartbeat('client-pulse', 'ok', { open: 0, sent });
    return NextResponse.json({ success: true, open: 0, sent });
  }
  const now = new Date();
  const manilaTime = now.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  await sendTelegramMessage(`<b>📋 CLIENT PULSE — ${manilaTime}</b>\n${orders.length} open order(s). Isa-isang next step bawat client:`);
  let sent = 0;
  for (const [index, order] of orders.entries()) {
    if (await sendTelegramMessage(buildOrderPulseMessage(order, index, orders.length, now))) sent += 1;
  }
  await recordHeartbeat('client-pulse', 'ok', { open: orders.length, sent });
  return NextResponse.json({ success: true, open: orders.length, sent });
}
