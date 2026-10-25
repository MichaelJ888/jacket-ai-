// Unattended worker: runs CEO-approved dev_tasks one at a time through the GitHub Copilot CLI.
//   node scripts/devq-worker.mjs            poll every 60s (Ctrl+C to stop)
//   node scripts/devq-worker.mjs --once     run at most one approved task, then exit
//   node scripts/devq-worker.mjs --once --task <uuid>   run one specific approved task (used by the cloud runner)
// Requires a one-time `copilot login` on this PC (or COPILOT_GITHUB_TOKEN in CI). Never pushes, deploys, or migrates the DB.
// Changes stay uncommitted; the cloud runner commits them to a PR branch, the PC leaves them for CEO review.
import { readFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

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

const root = fileURLToPath(new URL('..', import.meta.url));
const devq = fileURLToPath(new URL('./devq.mjs', import.meta.url));
const copilotBin = process.env.COPILOT_BIN || join(process.env.APPDATA || '', 'npm', 'node_modules', '@github', 'copilot', 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe');
const TASK_TIMEOUT_MS = 25 * 60 * 1000;
const STALE_CLAIM_MS = 45 * 60 * 1000;
const POLL_MS = Number(process.env.DEVQ_WORKER_POLL_MS) || 60_000;
const once = process.argv.includes('--once');
const taskFlag = process.argv.indexOf('--task');
const onlyTaskId = taskFlag > 0 ? process.argv[taskFlag + 1] : null;

async function rest(path, init = {}) {
  const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// A worker that died mid-task leaves rows in 'claimed'; put them back so they are not stuck forever.
async function releaseStaleClaims() {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  await rest(`dev_tasks?status=eq.claimed&claimed_at=lt.${cutoff}`, { method: 'PATCH', body: JSON.stringify({ status: 'queued', claimed_at: null }) });
}

async function claimNext() {
  await releaseStaleClaims();
  const filter = onlyTaskId ? `id=eq.${onlyTaskId}` : 'order=created_at.asc&limit=1';
  const [oldest] = await rest(`dev_tasks?select=id,task&status=eq.queued&approved_at=not.is.null&${filter}`);
  if (!oldest) return null;
  const [claimed] = await rest(`dev_tasks?id=eq.${oldest.id}&status=eq.queued&approved_at=not.is.null`, { method: 'PATCH', body: JSON.stringify({ status: 'claimed', claimed_at: new Date().toISOString() }) });
  return claimed || null;
}

async function releaseClaim(id) {
  await rest(`dev_tasks?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'queued', claimed_at: null }) });
}

function buildPrompt(task) {
  return [
    'You are working in the jacket-ai repository (Next.js 16, Supabase, Telegram bot). Read AGENTS.md first.',
    'Task requested by the CEO (approved):',
    task,
    '',
    'Rules:',
    '- Make the smallest complete change that fully solves the task. Follow existing patterns; reuse shared helpers in app/api/_lib.',
    '- Do not git push, do not run vercel deploy, do not run npm run db:push, and do not delete data. Do not commit.',
    '- Validate the changed files with their tests (node --test <file>) and run eslint on changed files.',
    '- If the task needs a business decision, a credential, or a manual action from the CEO, do not guess. Stop and reply starting with "NEEDS INPUT:".',
    '- End your reply with one line starting with "SUMMARY:" describing what changed and what was verified.',
  ].join('\n');
}

function runCopilot(prompt) {
  return new Promise((resolve) => {
    if (!process.env.COPILOT_BIN && !existsSync(copilotBin)) return resolve({ code: 1, out: '', err: `Copilot CLI not found at ${copilotBin}` });
    const args = [
      '-p', prompt, '-s', '--allow-all-tools',
      '--deny-tool=shell(git push)', '--deny-tool=shell(vercel)', '--deny-tool=shell(npx vercel)',
      '--deny-tool=shell(npm run db:push)', '--deny-tool=shell(rm)', '--deny-tool=shell(del)',
    ];
    const child = spawn(copilotBin, args, { cwd: root, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), TASK_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: 1, out, err: error.message }); });
  });
}

function notify(args) {
  spawnSync(process.execPath, [devq, ...args], { cwd: root, stdio: 'inherit' });
}

function summarize(out) {
  const text = out.trim();
  const summary = text.split(/\r?\n/).filter((line) => line.startsWith('SUMMARY:')).pop();
  return (summary || text.slice(-1500) || 'Finished with no output.').slice(0, 3000);
}

async function runOne() {
  const task = await claimNext();
  if (!task) return false;
  const id = task.id.slice(0, 8);
  console.log(`[worker] running ${id}: ${task.task.slice(0, 120)}`);
  const result = await runCopilot(buildPrompt(task.task));
  if (/no authentication information|not logged in|login/i.test(result.err) && !result.out) {
    await releaseClaim(task.id);
    console.error('[worker] Copilot CLI is not logged in on this PC. Run `copilot login` once; task returned to the queue.');
    return 'auth';
  }
  const text = summarize(result.out);
  if (result.code === 0 && !/^NEEDS INPUT:/m.test(result.out)) notify(['done', id, text]);
  else notify(['fail', id, result.code === 0 ? text : `${result.err || 'exit ' + result.code}\n${text}`.slice(0, 3000)]);
  console.log(`[worker] finished ${id} (exit ${result.code})`);
  return true;
}

if (once) {
  const outcome = await runOne();
  process.exitCode = outcome === 'auth' ? 2 : 0;
}

if (!once) console.log(`devq worker started (poll ${POLL_MS / 1000}s). Ctrl+C to stop.`);
while (!once) {
  try {
    const outcome = await runOne();
    if (outcome === 'auth') await new Promise((resolve) => setTimeout(resolve, POLL_MS * 10));
    else if (!outcome) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } catch (error) {
    console.error('[worker] error:', error.message);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
