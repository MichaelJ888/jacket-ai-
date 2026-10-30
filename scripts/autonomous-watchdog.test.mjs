import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailures, isTransientLiveFailure, decideRun, buildFixPrompt } from './autonomous-watchdog.mjs';

test('classifyFailures separates code failures from live failures', () => {
  const { codeFailures, liveFailures } = classifyFailures([
    { name: 'typecheck', kind: 'code', ok: true },
    { name: 'test', kind: 'code', ok: false },
    { name: 'verify-live', kind: 'live', ok: false },
  ]);
  assert.deepEqual(codeFailures.map((f) => f.name), ['test']);
  assert.deepEqual(liveFailures.map((f) => f.name), ['verify-live']);
});

test('network, timeout and 5xx live failures are transient; auth failures are not', () => {
  assert.equal(isTransientLiveFailure('network error: fetch failed'), true);
  assert.equal(isTransientLiveFailure('HTTP 503 Service Unavailable'), true);
  assert.equal(isTransientLiveFailure('HTTP 0 timed out'), true);
  assert.equal(isTransientLiveFailure('401 Unauthorized with ADMIN_TOKEN'), false);
  assert.equal(isTransientLiveFailure('FAIL CRM client count HTTP 200, 3 contacts'), false);
});

test('decideRun runs on first run, new commit, or hourly; otherwise idles', () => {
  const now = 10_000_000;
  assert.equal(decideRun({ head: 'a', state: {}, now }).run, true);
  assert.equal(decideRun({ head: 'b', state: { lastHead: 'a', lastRunAt: now - 1000 }, now }).run, true);
  assert.equal(decideRun({ head: 'a', state: { lastHead: 'a', lastRunAt: now - 60_000 }, now, fullRunIntervalMs: 3_600_000 }).run, false);
  assert.equal(decideRun({ head: 'a', state: { lastHead: 'a', lastRunAt: now - 3_600_000 }, now, fullRunIntervalMs: 3_600_000 }).run, true);
});

test('buildFixPrompt forbids commit, push, deploy and secret access', () => {
  const prompt = buildFixPrompt([{ name: 'lint', command: 'npm run lint', output: 'error at app/x.ts' }]);
  assert.match(prompt, /lint/);
  assert.match(prompt, /app\/x\.ts/);
  assert.match(prompt, /Do NOT run git commit, git push/);
  assert.match(prompt, /\.env\.local/);
});
