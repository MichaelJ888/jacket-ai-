// Bridge between the CEO's Telegram bot and the VS Code AI chat.
//   node scripts/devq.mjs list                 show queued/claimed jobs
//   node scripts/devq.mjs next                 claim the oldest queued job and print it
//   node scripts/devq.mjs done <id> "summary"  mark done and tell the CEO on Telegram
//   node scripts/devq.mjs fail <id> "reason"   mark failed and tell the CEO
//   node scripts/devq.mjs watch [seconds]      poll (default 30s) and print new jobs; run in a VS Code terminal
// <id> may be the 8-char prefix shown on Telegram.
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest(path, init = {}) {
  const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function telegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

async function findTask(idOrPrefix) {
  const rows = await rest('dev_tasks?select=id,task,status&order=created_at.desc&limit=100');
  const hit = rows.filter((row) => row.id.startsWith(idOrPrefix));
  if (hit.length !== 1) throw new Error(hit.length ? 'Ambiguous id prefix' : 'Task not found');
  return hit[0];
}

async function claimNext() {
  const [oldest] = await rest('dev_tasks?select=id,task&status=eq.queued&order=created_at.asc&limit=1');
  if (!oldest) return null;
  // Conditional update: only one claimer can flip queued -> claimed.
  const [claimed] = await rest(`dev_tasks?id=eq.${oldest.id}&status=eq.queued`, { method: 'PATCH', body: JSON.stringify({ status: 'claimed', claimed_at: new Date().toISOString() }) });
  return claimed || null;
}

const [command, a, b] = process.argv.slice(2);
if (command === 'list') {
  const rows = await rest('dev_tasks?select=id,task,status,created_at&status=in.(queued,claimed)&order=created_at.asc');
  console.log(rows.length ? rows.map((row) => `${row.id.slice(0, 8)} [${row.status}] ${row.task}`).join('\n') : 'No pending dev tasks.');
} else if (command === 'next') {
  const task = await claimNext();
  console.log(task ? `CLAIMED ${task.id.slice(0, 8)}\n${task.task}` : 'No queued dev tasks.');
  if (task) await telegram(`VS Code AI sinimulan na: #${task.id.slice(0, 8)} ${task.task.slice(0, 150)}`);
} else if (command === 'done' || command === 'fail') {
  if (!a) { console.error(`Usage: devq ${command} <id> "text"`); process.exit(1); }
  const task = await findTask(a);
  await rest(`dev_tasks?id=eq.${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: command === 'done' ? 'done' : 'failed', result: (b || '').slice(0, 4000), completed_at: new Date().toISOString() }) });
  await telegram(`${command === 'done' ? 'TAPOS NA' : 'HINDI NATAPOS'} #${task.id.slice(0, 8)}: ${task.task.slice(0, 100)}\n${b || ''}`);
  console.log(`${command} ${task.id.slice(0, 8)}`);
} else if (command === 'watch') {
  const seconds = Math.max(10, Number(a) || 30);
  console.log(`Watching dev_tasks every ${seconds}s. Ctrl+C to stop.`);
  const seen = new Set();
  for (;;) {
    try {
      const rows = await rest('dev_tasks?select=id,task&status=eq.queued&order=created_at.asc');
      for (const row of rows) if (!seen.has(row.id)) { seen.add(row.id); console.log(`\nNEW DEV TASK ${row.id.slice(0, 8)}: ${row.task}\n-> tell the VS Code AI chat: "run npm run devq -- next and do it"`); }
    } catch (error) { console.error('poll failed:', error.message); }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
} else {
  console.log('Usage: devq list | next | done <id> "summary" | fail <id> "reason" | watch [seconds]');
}
