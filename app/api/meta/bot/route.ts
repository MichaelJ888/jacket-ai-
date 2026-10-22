import { NextResponse } from 'next/server';
import { getProfile, saveProfile } from '../../_lib/tenant-bot';
import { EMPTY_PROFILE, profileProblems } from '../../_lib/tenant-bot-logic';
import { resolveCaller } from '../../_lib/tenants';

export const dynamic = 'force-dynamic';

async function tenantId(request: Request) {
  const caller = await resolveCaller(request);
  return caller && caller.kind === 'tenant' ? caller.tenant.id : null;
}

export async function GET(request: Request) {
  const id = await tenantId(request);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = (await getProfile(id)) || EMPTY_PROFILE;
  return NextResponse.json({ profile, problems: profileProblems(profile) });
}

export async function PUT(request: Request) {
  const id = await tenantId(request);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  try {
    return NextResponse.json(await saveProfile(id, body as Record<string, unknown>));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
