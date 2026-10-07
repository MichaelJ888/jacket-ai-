import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../_lib/auth';
import { demandForecast, pricingAdvice } from '../../_lib/insights';
import { escapeTelegramHtml, sendTelegramMessage } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Weekly: reorder forecast + margin/price advice, sent to the CEO. Advice only; nothing is changed automatically.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [forecast, pricing] = await Promise.all([demandForecast(), pricingAdvice()]);
  const reorders = forecast.filter((row) => row.reorder);
  const raises = pricing.filter((row) => row.action === 'RAISE');
  const lines: string[] = [];
  if (reorders.length) lines.push('<b>Reorder soon</b>', ...reorders.slice(0, 8).map((row) => `• ${escapeTelegramHtml(row.material)}: ${row.weeksOfCover} wks left, order ~${row.suggestedOrderQty} ${row.unit || ''}`));
  if (raises.length) lines.push('<b>Prices below target margin</b>', ...raises.map((row) => `• ${row.style}: now PHP ${row.sellingPrice}, suggest PHP ${row.suggested} (margin ${row.currentMarginPct}%, material cost ${row.materialCostChange30dPct}% vs 30d ago)`));
  const surges = pricing.filter((row) => row.demandSignal.startsWith('SURGE'));
  if (surges.length) lines.push('<b>Demand surge</b>', ...surges.map((row) => `• ${row.style}: consider a rush/peak surcharge`));
  if (lines.length) await sendTelegramMessage(`<b>WEEKLY FORECAST &amp; PRICING ADVICE</b>\n${lines.join('\n')}`);
  return NextResponse.json({ success: true, forecast, pricing, notified: lines.length > 0 });
}
