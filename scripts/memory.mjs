// Cloud replacement for the local projectmem MCP server — reads/writes the
// public.agent_memory_events table in Supabase instead of a local Python process.
// Usage:
//   node scripts/memory.mjs note "some gotcha"
//   node scripts/memory.mjs decision "chose X over Y" [--supersedes=<id>]
//   node scripts/memory.mjs issue "bug summary" [--location=path/to/file.ts]
//   node scripts/memory.mjs attempt "tried X" [--outcome=failed|worked]
//   node scripts/memory.mjs fix "fixed the bug" [--issue=<id>]
//   node scripts/memory.mjs summary [--scope=note|decision|issue|attempt|fix] [--limit=20] [--project=jacket-ai]
//   node scripts/memory.mjs archive [--months=6] [--dry-run] [--project=jacket-ai]
//     Retention housekeeping: copy rows older than N months into agent_memory_events_archive,
//     then delete them from the live table. Also runs daily via /api/cron/memory-archive.
// All writes default to --project=jacket-ai (this repo); pass --project=other-repo to reuse this same table elsewhere.
import { readFileSync } from 'node:fs';

const envPath = new URL('../.env.local', import.meta.url);
try {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // .env.local optional if vars are already exported in the shell
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  process.exit(1);
}

const args = process.argv.slice(2);
const positionals = args.filter((arg) => !arg.startsWith('--'));
const [scope, summary] = positionals;
const flags = Object.fromEntries(
  args
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, value] = arg.slice(2).split('=');
      return [key, value ?? true];
    }),
);

const table = `${supabaseUrl}/rest/v1/agent_memory_events`;
const archiveTable = `${supabaseUrl}/rest/v1/agent_memory_events_archive`;
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function writeEvent(eventScope, eventSummary, extra = {}) {
  const res = await fetch(table, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ scope: eventScope, summary: eventSummary, project: flags.project ?? 'jacket-ai', ...extra }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`Write failed (${res.status}):`, body);
    process.exit(1);
  }
  console.log('Recorded:', body?.[0]);
}

async function printSummary() {
  const params = new URLSearchParams({ order: 'created_at.desc', limit: String(flags.limit ?? 20) });
  if (flags.scope) params.set('scope', `eq.${flags.scope}`);
  if (flags.project) params.set('project', `eq.${flags.project}`);
  const res = await fetch(`${table}?${params.toString()}`, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`Fetch failed (${res.status}):`, body);
    process.exit(1);
  }
  for (const event of body ?? []) {
    console.log(`[${event.created_at}] (${event.scope}) ${event.summary}${event.location ? ` — ${event.location}` : ''}`);
  }
}

async function archiveOldEvents() {
  const months = Number(flags.months ?? 6);
  if (!Number.isFinite(months) || months <= 0) {
    console.error('--months must be a positive number.');
    process.exit(1);
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffIso = cutoff.toISOString();
  const batchSize = 500;

  const buildQuery = () => {
    const params = new URLSearchParams({
      created_at: `lt.${cutoffIso}`,
      order: 'created_at.asc',
      limit: String(batchSize),
    });
    if (flags.project) params.set('project', `eq.${flags.project}`);
    return params.toString();
  };

  if (flags['dry-run']) {
    const res = await fetch(`${table}?${buildQuery()}`, { headers });
    const rows = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`Fetch failed (${res.status}):`, rows);
      process.exit(1);
    }
    console.log(
      `[dry-run] ${rows.length} event(s) older than ${months} month(s) (created before ${cutoffIso}) would be archived` +
        `${rows.length === batchSize ? ' — showing first batch only' : ''}.`,
    );
    for (const event of rows ?? []) {
      console.log(`  [${event.created_at}] (${event.scope}) ${event.summary}`);
    }
    return;
  }

  let total = 0;
  for (;;) {
    const res = await fetch(`${table}?${buildQuery()}`, { headers });
    const rows = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`Fetch failed (${res.status}):`, rows);
      process.exit(1);
    }
    if (!rows?.length) break;

    // ignore-duplicates keeps re-runs idempotent after a partial failure.
    const archiveRes = await fetch(archiveTable, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify(rows),
    });
    if (!archiveRes.ok) {
      console.error(`Archive insert failed (${archiveRes.status}) — live rows NOT deleted:`, await archiveRes.json().catch(() => null));
      process.exit(1);
    }

    const ids = rows.map((row) => row.id).join(',');
    const deleteRes = await fetch(`${table}?id=in.(${ids})`, { method: 'DELETE', headers });
    if (!deleteRes.ok) {
      console.error(
        `Delete failed (${deleteRes.status}) — batch is safe in the archive, re-run to retry:`,
        await deleteRes.json().catch(() => null),
      );
      process.exit(1);
    }
    total += rows.length;
    if (rows.length < batchSize) break;
  }

  console.log(`Archived ${total} event(s) older than ${months} month(s) (created before ${cutoffIso}) to agent_memory_events_archive.`);
  if (total > 0) {
    await writeEvent('note', `Retention: archived ${total} agent_memory_events row(s) older than ${months}mo to agent_memory_events_archive.`);
  }
}

if (!scope) {
  console.error('Usage: node scripts/memory.mjs <note|decision|issue|attempt|fix|summary|archive> "..."');
  process.exit(1);
}

if (scope === 'summary') {
  await printSummary();
} else if (scope === 'archive') {
  await archiveOldEvents();
} else if (['note', 'decision', 'issue', 'attempt', 'fix'].includes(scope)) {
  if (!summary) {
    console.error('Missing summary text.');
    process.exit(1);
  }
  const extra = {};
  if (flags.location) extra.location = flags.location;
  if (flags.outcome) extra.status = flags.outcome;
  if (flags.issue) extra.status = `issue:${flags.issue}`;
  if (flags.supersedes) extra.supersedes = flags.supersedes;
  await writeEvent(scope, summary, extra);
} else {
  console.error(`Unknown scope "${scope}". Use note, decision, issue, attempt, fix, summary, or archive.`);
  process.exit(1);
}
