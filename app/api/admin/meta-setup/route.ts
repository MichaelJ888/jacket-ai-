import { NextResponse } from 'next/server';
import { publicBaseUrl } from '../../_lib/channels';
import { registerDeauthCallback, runSetupChecks } from '../../_lib/meta-setup';
import { isAdminAuthorized } from '../../_lib/auth';

export const dynamic = 'force-dynamic';

// GET: automated checks + the short list of steps only Meta lets a human do.
export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ checks: await runSetupChecks(publicBaseUrl()) });
}

// POST: register what the API allows (deauthorize callback), then re-run the checks.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const registered = await registerDeauthCallback(publicBaseUrl());
  return NextResponse.json({ registered, checks: await runSetupChecks(publicBaseUrl()) });
}
