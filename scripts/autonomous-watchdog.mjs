// Autonomous watchdog for MJIC. Runs typecheck, lint, tests and live verification on `main`.
// Code failures get one auto-fix pass per attempt via the Copilot CLI (same binary as devq-worker).
// If code still fails, uncommitted watchdog edits are discarded and HEAD is parked on the stable tag.
// On success it commits any fix, pushes to origin main, deploys to Vercel production and re-verifies.
// Modes: --once (default), --watch (poll for new commits, full run at least hourly), --dry-run (no commit/push/deploy/rollback/fix).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const STATE_DIR = join(ROOT, '.watchdog');
const STATE_FILE = join(STATE_DIR, 'state.json');
const LOG_FILE = join(STATE_DIR, 'watchdog.log');
const LOCK_FILE = join(STATE_DIR, 'lock');
export const STABLE_TAG = process.env.WATCHDOG_STABLE_TAG || 'stable-2026-10-30';
export const MAX_FIX_ATTEMPTS = 2;
export const LIVE_RETRIES = 3;
const LIVE_RETRY_DELAY_MS = 60_000;
const POLL_MS = Number(process.env.WATCHDOG_POLL_MS || 2 * 60_000);
const FULL_RUN_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 60 * 60_000);
const LOCK_STALE_MS = 2 * 60 * 60_000;
const COPILOT_BIN = process.env.COPILOT_BIN || join(process.env.APPDATA || '', 'npm', 'node_modules', '@github', 'copilot', 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe');
const COAUTHOR = 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>';

export const CHECKS = [
  { name: 'typecheck', kind: 'code', bin: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'lint', kind: 'code', bin: 'npm', args: ['run', 'lint'] },
  { name: 'test', kind: 'code', bin: 'npm', args: ['test'] },
  { name: 'verify-live', kind: 'live', bin: process.execPath, args: ['scripts/verify-live-system.mjs'] },
];

// Pure helpers (exported for tests)

export function classifyFailures(results) {
  const failed = results.filter((r) => !r.ok);
  return {
    codeFailures: failed.filter((r) => r.kind === 'code'),
    liveFailures: failed.filter((r) => r.kind === 'live'),
  };
}

export function isTransientLiveFailure(output) {
  return /network error|timed out|timeout|ETIMEDOUT|AbortError|HTTP 0\b|HTTP 5\d\d|fetch failed/i.test(output || '');
}

export function decideRun({ head, state, now, fullRunIntervalMs = FULL_RUN_INTERVAL_MS }) {
  if (!state.lastRunAt) return { run: true, reason: 'first run' };
  if (state.lastHead !== head) return { run: true, reason: 'new commit detected' };
  if (now - state.lastRunAt >= fullRunIntervalMs) return { run: true, reason: 'hourly full run' };
  return { run: false, reason: 'no new commit and last run is recent' };
}

export function buildFixPrompt(codeFailures) {
  const excerpts = codeFailures
    .map((f) => `### ${f.name} (command: ${f.command})\n${String(f.output).slice(-3000)}`)
    .join('\n\n');
  return [
    'You are the MJIC autonomous watchdog auto-fixer. The following checks failed on the main branch.',
    'Fix ONLY the source code needed so these checks pass. Make minimal, surgical edits. Do not change tests to make them pass unless the test itself is clearly wrong.',
    'Do NOT run git commit, git push, git checkout, vercel deploy, or any database migration. Do NOT read or print secrets from .env.local.',
    'Do NOT touch the .watchdog/ folder.',
    'When done, stop. The watchdog will re-run the checks itself.',
    '',
    excerpts,
  ].join('\n');
}

// Process helpers

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* logging must never break a run */ }
}

function run(bin, args, { timeoutMs = 10 * 60_000 } = {}) {
  const useShell = process.platform === 'win32' && (bin === 'npm' || bin === 'npx');
  return new Promise((done) => {
    let out = '';
    const append = (d) => { out += d.toString(); if (out.length > 300_000) out = out.slice(-200_000); };
    let child;
    try {
      child = spawn(bin, args, { cwd: ROOT, windowsHide: true, shell: useShell });
    } catch (err) {
      return done({ code: 1, out: String(err) });
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (err) => { clearTimeout(timer); done({ code: 1, out: out + String(err) }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
  });
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function writeState(patch) {
  mkdirSync(STATE_DIR, { recursive: true });
  const next = { ...readState(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

function acquireLock() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(LOCK_FILE) && Date.now() - statSync(LOCK_FILE).mtimeMs < LOCK_STALE_MS) return false;
  writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch { /* already gone */ }
}

// Check runner

async function runChecks() {
  const results = [];
  for (const check of CHECKS) {
    let attempt = 0;
    let r;
    while (true) {
      attempt++;
      r = await run(check.bin, check.args, { timeoutMs: check.kind === 'live' ? 5 * 60_000 : 10 * 60_000 });
      const ok = r.code === 0;
      if (ok || check.kind !== 'live' || !isTransientLiveFailure(r.out) || attempt > LIVE_RETRIES) break;
      log(`${check.name}: transient failure, retry ${attempt}/${LIVE_RETRIES} in 60s`);
      await sleep(LIVE_RETRY_DELAY_MS);
    }
    const command = `${check.bin === process.execPath ? 'node' : check.bin} ${check.args.join(' ')}`;
    const output = r.out.slice(-8000);
    results.push({ name: check.name, kind: check.kind, command, ok: r.code === 0, output });
    log(`${r.code === 0 ? 'PASS' : 'FAIL'} ${check.name}`);
  }
  return results;
}

async function autoFix(codeFailures, attempt) {
  log(`auto-fix attempt ${attempt}/${MAX_FIX_ATTEMPTS} via Copilot CLI for: ${codeFailures.map((f) => f.name).join(', ')}`);
  if (!existsSync(COPILOT_BIN)) {
    log(`Copilot CLI not found at ${COPILOT_BIN}; auto-fix skipped`);
    return false;
  }
  const r = await run(COPILOT_BIN, ['-p', buildFixPrompt(codeFailures), '-s', '--allow-all-tools'], { timeoutMs: 15 * 60_000 });
  log(`auto-fix attempt ${attempt} exited with code ${r.code}`);
  return r.code === 0;
}

function rollback(reason) {
  log(`ROLLBACK: ${reason}`);
  git(['checkout', '--', '.']);
  git(['clean', '-fd']);
  const co = git(['checkout', STABLE_TAG]);
  if (co.code !== 0) {
    log(`rollback checkout of ${STABLE_TAG} failed: ${co.out.trim()}`);
    return false;
  }
  log(`HEAD parked on ${STABLE_TAG} (detached). Run "git checkout main" to resume normal operation.`);
  return true;
}

async function pushWithRetry() {
  for (let i = 1; i <= 3; i++) {
    const r = git(['push', 'origin', 'HEAD:main']);
    if (r.code === 0) return true;
    log(`git push attempt ${i} failed: ${r.out.trim().slice(0, 300)}`);
    await sleep(15_000);
  }
  return false;
}

// Main cycle

export async function runCycle({ dryRun = false } = {}) {
  if (!acquireLock()) return { status: 'skipped', reason: 'another watchdog run holds the lock' };
  try {
    const state = readState();
    const head = git(['rev-parse', 'HEAD']).out.trim();
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
    const dirty = git(['status', '--porcelain']).out.trim();

    const decision = decideRun({ head, state, now: Date.now() });
    if (!decision.run) return { status: 'idle', reason: decision.reason };
    if (dirty) {
      log('skip: uncommitted changes present; not touching human work');
      writeState({ lastRunAt: Date.now(), lastResult: 'skipped-dirty' });
      return { status: 'skipped', reason: 'dirty working tree' };
    }
    log(`cycle start (${decision.reason}) branch=${branch} head=${head.slice(0, 7)}${dryRun ? ' [dry-run]' : ''}`);

    let results = await runChecks();
    let fixAttempt = 0;
    while (!dryRun) {
      const { codeFailures } = classifyFailures(results);
      if (!codeFailures.length || fixAttempt >= MAX_FIX_ATTEMPTS) break;
      fixAttempt++;
      await autoFix(codeFailures, fixAttempt);
      results = await runChecks();
    }

    const { codeFailures, liveFailures } = classifyFailures(results);
    if (codeFailures.length) {
      if (!dryRun) rollback(`code checks still failing after ${fixAttempt} auto-fix attempt(s): ${codeFailures.map((f) => f.name).join(', ')}`);
      writeState({ lastHead: head, lastRunAt: Date.now(), lastResult: dryRun ? 'dry-run-code-failure' : 'rolled-back' });
      return { status: dryRun ? 'dry-run-failed' : 'rolled-back', failures: codeFailures.map((f) => f.name) };
    }
    if (liveFailures.length) {
      log(`live verification failed (not code-related, no rollback): ${liveFailures.map((f) => f.name).join(', ')}`);
      writeState({ lastHead: head, lastRunAt: Date.now(), lastResult: 'live-failed' });
      return { status: 'live-failed', failures: liveFailures.map((f) => f.name) };
    }

    if (dryRun) {
      log('dry-run: all checks passed; no commit/push/deploy performed');
      return { status: 'dry-run-ok' };
    }

    if (branch !== 'main') {
      log(`checks pass on ${branch}; not on main, so no push/deploy`);
      writeState({ lastHead: head, lastRunAt: Date.now(), lastResult: 'ok-not-main' });
      return { status: 'ok-not-main' };
    }

    let currentHead = head;
    if (git(['status', '--porcelain']).out.trim()) {
      git(['add', '-A']);
      const msg = `fix(watchdog): auto-repair failing checks (${fixAttempt} auto-fix attempt${fixAttempt === 1 ? '' : 's'})`;
      const c = git(['commit', '-m', msg, '-m', COAUTHOR]);
      if (c.code !== 0) {
        rollback(`commit failed: ${c.out.trim().slice(0, 300)}`);
        writeState({ lastHead: head, lastRunAt: Date.now(), lastResult: 'rolled-back' });
        return { status: 'rolled-back', failures: ['commit'] };
      }
      currentHead = git(['rev-parse', 'HEAD']).out.trim();
      log(`committed auto-fix ${currentHead.slice(0, 7)}`);
    }

    if (state.lastDeployedSha === currentHead) {
      writeState({ lastHead: currentHead, lastRunAt: Date.now(), lastResult: 'ok-already-deployed' });
      return { status: 'ok-already-deployed' };
    }

    if (!(await pushWithRetry())) {
      writeState({ lastHead: currentHead, lastRunAt: Date.now(), lastResult: 'push-failed' });
      return { status: 'push-failed' };
    }
    log('pushed to origin/main');

    const deploy = await run('npx', ['vercel', '--prod', '--yes'], { timeoutMs: 20 * 60_000 });
    if (deploy.code !== 0) {
      log(`vercel deploy failed (exit ${deploy.code}): ${deploy.out.slice(-400)}`);
      writeState({ lastHead: currentHead, lastRunAt: Date.now(), lastResult: 'deploy-failed' });
      return { status: 'deploy-failed' };
    }
    log('deployed to Vercel production');

    const post = await run(process.execPath, ['scripts/verify-live-system.mjs'], { timeoutMs: 5 * 60_000 });
    const postOk = post.code === 0;
    log(`post-deploy verify-live: ${postOk ? 'PASS' : 'FAIL'}`);
    writeState({
      lastHead: currentHead,
      lastRunAt: Date.now(),
      lastDeployedSha: currentHead,
      lastResult: postOk ? 'deployed-verified' : 'deployed-verify-failed',
    });
    return { status: postOk ? 'deployed-verified' : 'deployed-verify-failed' };
  } finally {
    releaseLock();
  }
}

async function watch() {
  log(`watch mode: polling every ${Math.round(POLL_MS / 1000)}s, full run at least every ${Math.round(FULL_RUN_INTERVAL_MS / 60000)} min`);
  while (true) {
    try {
      const r = await runCycle();
      log(`cycle result: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    } catch (err) {
      log(`cycle crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(POLL_MS);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  if (process.argv.includes('--watch')) {
    await watch();
  } else {
    const r = await runCycle({ dryRun });
    log(`result: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    if (!['ok-already-deployed', 'deployed-verified', 'idle', 'ok-not-main', 'dry-run-ok', 'skipped'].includes(r.status)) process.exitCode = 1;
  }
}
