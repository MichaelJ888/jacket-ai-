import { NextResponse } from 'next/server';
import { rateLimitResponse } from '../../../_lib/rate-limit';
import { previewTenantReply } from '../../../_lib/sales-closer';
import { sanitizeProfile } from '../../../_lib/tenant-bot-logic';
import { resolveCaller } from '../../../_lib/tenants';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST { message, profile }: try the assistant with the (unsaved) form values.
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller || caller.kind !== 'tenant') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limited = await rateLimitResponse(request, `bot-test-${caller.tenant.id}`, 20, 600);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
  try {
    const reply = await previewTenantReply(sanitizeProfile({ ...(body.profile || {}), enabled: true }), message);
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json({ error: 'The assistant could not answer right now.' }, { status: 502 });
  }
}
