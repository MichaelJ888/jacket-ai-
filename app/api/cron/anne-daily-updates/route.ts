import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { runAnneDailyUpdate } from '../../_lib/anne-daily-update';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Daily 8:00 AM Manila (00:00 UTC) via vercel.json: one Telegram DM per active/pending client to Ms. Anne Manalo.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runAnneDailyUpdate();
  if (result.status === 'error') return NextResponse.json({ success: false, ...result }, { status: 503 });
  return NextResponse.json({ success: true, ...result });
}
