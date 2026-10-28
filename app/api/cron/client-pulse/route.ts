import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { buildClientPulseMessage, listOpenOrders } from '../../_lib/client-pulse';
import { sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// 2x-daily per-client action list (6AM & 1PM Manila via GitHub Actions scheduler).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const orders = await listOpenOrders();
  const sent = await sendTelegramMessage(buildClientPulseMessage(orders));
  await recordHeartbeat('client-pulse', 'ok', { open: orders.length, sent });
  return NextResponse.json({ success: true, open: orders.length, sent });
}
