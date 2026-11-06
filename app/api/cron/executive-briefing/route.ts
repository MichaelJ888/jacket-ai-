import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { countClientActivitySince } from '../../_lib/client-activity';
import { listOpenOrders } from '../../_lib/client-pulse';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { getAnneChatId, sendTelegramDirectMessage, sendTelegramMessage } from '../../_lib/integrations';
import { buildExecutiveBriefing } from '../../_lib/order-plan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 6:00 AM Manila executive progress briefing for CEO Richard and Ms. Anne (group + direct message).
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const nowMs = Date.now();
  const [orders, updatesLast24h] = await Promise.all([
    listOpenOrders(200),
    countClientActivitySince(new Date(nowMs - 86400000).toISOString()),
  ]);
  const text = buildExecutiveBriefing({ nowMs, orders, updatesLast24h });

  await sendTelegramMessage(text);
  const anne = await getAnneChatId();
  if (anne.chatId) await sendTelegramDirectMessage(anne.chatId, text);
  await recordHeartbeat('executive-briefing', 'ok', { orders: orders.length, updatesLast24h, annePinged: Boolean(anne.chatId) });
  return NextResponse.json({ success: true, orders: orders.length, updatesLast24h, annePinged: Boolean(anne.chatId) });
}
