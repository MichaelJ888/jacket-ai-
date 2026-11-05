import { NextResponse } from 'next/server';

import { isCronAuthorized } from '../../_lib/auth';
import { upsertContact } from '../../_lib/crm';
import { recordHeartbeat } from '../../_lib/ceo-finance';
import { leadgenContactInput } from '../../_lib/leadgen-crm-logic.ts';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Daily idempotent backfill: Meta lead-ad rows in `leads` -> `crm_contacts`.
// Safe to re-run; upsertContact dedupes on (channel, external_id) = facebook / leadgen:<id>.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const { data, error } = await supabase
    .from('leads')
    .select('name, contact, source, details')
    .ilike('source', 'facebook-lead-ad%')
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of data || []) {
    const input = leadgenContactInput(row);
    if (!input) {
      skipped += 1;
      continue;
    }
    const result = await upsertContact(input);
    if (result.error) failed += 1;
    else if (result.isNew) created += 1;
    else updated += 1;
  }

  await recordHeartbeat('crm-sync', failed ? 'degraded' : 'ok', { scanned: data?.length || 0, created, updated, skipped, failed });
  return NextResponse.json({ success: failed === 0, scanned: data?.length || 0, created, updated, skipped, failed });
}
