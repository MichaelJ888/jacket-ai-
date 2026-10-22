import { NextResponse } from 'next/server';
import { resumeContact, tenantInbox } from '../../../_lib/tenant-bot';
import { resolveCaller } from '../../../_lib/tenants';

export const dynamic = 'force-dynamic';

async function tenantId(request: Request) {
  const caller = await resolveCaller(request);
  return caller && caller.kind === 'tenant' ? caller.tenant.id : null;
}

export async function GET(request: Request) {
  const id = await tenantId(request);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ contacts: await tenantInbox(id) });
}

// POST { contactId }: hand the conversation back to the assistant.
export async function POST(request: Request) {
  const id = await tenantId(request);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const contactId = typeof body?.contactId === 'string' ? body.contactId : '';
  if (!contactId) return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  const ok = await resumeContact(id, contactId);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
