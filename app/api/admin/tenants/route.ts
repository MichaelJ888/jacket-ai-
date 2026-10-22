import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { PLAN_LIMITS } from '../../_lib/tenant-logic';
import { listTenants, setTenantPlan } from '../../_lib/tenants';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ plans: PLAN_LIMITS, tenants: await listTenants() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

// POST { id, plan }: move a buyer to another tier.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; plan?: string };
  if (!body.id || !body.plan || !(body.plan in PLAN_LIMITS)) return NextResponse.json({ error: `id and plan (${Object.keys(PLAN_LIMITS).join('/')}) required` }, { status: 400 });
  try {
    await setTenantPlan(body.id, body.plan);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
