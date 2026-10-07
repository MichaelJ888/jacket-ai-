import { NextResponse } from 'next/server';
import { getSupabaseAdmin, sendTelegramMessage } from '../../_lib/integrations';

const ARCHIVE_AFTER_MONTHS = 6;
const BATCH_SIZE = 500;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow while CRON_SECRET is not yet configured, for initial setup/testing
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

// Daily Vercel cron (see vercel.json): copies agent_memory_events rows older than
// ARCHIVE_AFTER_MONTHS into agent_memory_events_archive, then deletes them from the
// live table so it stays small. Manual equivalent: npm run memory -- archive.
export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_AFTER_MONTHS);
  const cutoffIso = cutoff.toISOString();

  let archived = 0;
  for (;;) {
    const { data: rows, error } = await supabase
      .from('agent_memory_events')
      .select('id, scope, summary, location, status, supersedes, project, created_at')
      .lt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) return NextResponse.json({ error: `Fetch failed: ${error.message}`, archived }, { status: 500 });
    if (!rows.length) break;

    // ignoreDuplicates keeps re-runs idempotent after a partial failure.
    const { error: archiveError } = await supabase
      .from('agent_memory_events_archive')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (archiveError) {
      return NextResponse.json({ error: `Archive insert failed: ${archiveError.message} — live rows NOT deleted`, archived }, { status: 500 });
    }

    const { error: deleteError } = await supabase
      .from('agent_memory_events')
      .delete()
      .in('id', rows.map((row) => row.id));
    if (deleteError) {
      // Batch is safe in the archive; a re-run will skip those rows via ignoreDuplicates.
      return NextResponse.json({ error: `Delete failed: ${deleteError.message}`, archived }, { status: 500 });
    }

    archived += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  if (archived) {
    await supabase.from('agent_memory_events').insert({
      scope: 'note',
      summary: `Retention: archived ${archived} agent_memory_events row(s) older than ${ARCHIVE_AFTER_MONTHS}mo to agent_memory_events_archive (cron).`,
    });
    void sendTelegramMessage(`🗄️ Memory retention: archived ${archived} agent_memory_events row(s) older than ${ARCHIVE_AFTER_MONTHS} months.`);
  }

  return NextResponse.json({ success: true, archived, cutoff: cutoffIso });
}
