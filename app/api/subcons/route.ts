import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../_lib/auth';
import { getSupabaseAdmin, sendTelegramMessage, escapeTelegramHtml } from '../_lib/integrations';
import { buildMessengerLink } from '../_lib/subcon-import-logic';

// GET: all subcons in the directory. POST: add or update one (upsert by name).
export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data, error } = await supabase.from('subcon_directory').select('*').order('active', { ascending: false }).order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const subcons = (data || []).map((row) => ({ ...row, quick_dispatch_url: buildMessengerLink(row.messenger_handle) }));
  return NextResponse.json({ success: true, subcons });
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const optionalNumber = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));
  const capacity = optionalNumber(body?.daily_capacity_pcs);
  const rate = optionalNumber(body?.rate_per_pc);
  if ((capacity !== null && !(capacity >= 0)) || (rate !== null && !(rate >= 0))) {
    return NextResponse.json({ error: 'daily_capacity_pcs and rate_per_pc must be non-negative numbers' }, { status: 400 });
  }

  const row = {
    name,
    specialty: typeof body?.specialty === 'string' ? body.specialty.slice(0, 200) : null,
    contact_phone: typeof body?.contact_phone === 'string' ? body.contact_phone.slice(0, 40) : null,
    location: typeof body?.location === 'string' ? body.location.slice(0, 200) : null,
    daily_capacity_pcs: capacity === null ? null : Math.floor(capacity),
    rate_per_pc: rate,
    active: body?.active === false ? false : true,
    notes: typeof body?.notes === 'string' ? body.notes.slice(0, 500) : null,
    messenger_handle: typeof body?.messenger_handle === 'string' ? body.messenger_handle.trim().slice(0, 120) || null : null,
    updated_at: new Date().toISOString(),
  };
  if (row.messenger_handle && !buildMessengerLink(row.messenger_handle)) {
    return NextResponse.json({ error: 'messenger_handle must be a Page username, numeric id, or m.me link' }, { status: 400 });
  }
  const { data, error } = await supabase.from('subcon_directory').upsert(row, { onConflict: 'name' }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void sendTelegramMessage(`🧵 <b>SUBCON saved</b>: ${escapeTelegramHtml(data.name)}${data.daily_capacity_pcs ? ` · kapasidad ${data.daily_capacity_pcs} pcs/araw` : ''}${data.rate_per_pc ? ` · ₱${data.rate_per_pc}/pc` : ''}`);
  return NextResponse.json({ success: true, subcon: { ...data, quick_dispatch_url: buildMessengerLink(data.messenger_handle) } });
}
