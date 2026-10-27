import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { classifyWorkerResult, parseWorkerOptions, workerExitCode } from './lib/devq-worker-logic.mjs';

const task = '12345678-1234-1234-1234-123456789abc';

test('targeted cloud tasks validate full UUIDs before database access', () => {
  for (const value of ['', 'short-id', 'id&status=neq.queued', '--once']) {
    assert.throws(() => parseWorkerOptions(['--once', '--task', value]), /full dev_tasks UUID/);
  }
  assert.throws(() => parseWorkerOptions(['--task']), /full dev_tasks UUID/);
  assert.deepEqual(parseWorkerOptions(['--once', '--task', task, '--defer-completion']), { once: true, taskId: task, deferCompletion: true });
  assert.throws(() => parseWorkerOptions(['--defer-completion']), /requires --once and --task/);
});

test('failed or needs-input tasks cannot allow a success-only pull request step', () => {
  assert.equal(classifyWorkerResult({ code: 1, out: 'partial changes', err: 'failed' }), 'failed');
  assert.equal(classifyWorkerResult({ code: 0, out: 'NEEDS INPUT: credential missing', err: '' }), 'failed');
  assert.equal(classifyWorkerResult({ code: 0, out: 'SUMMARY: tested patch', err: '' }), 'success');
  assert.equal(workerExitCode('failed', true), 1);
  assert.equal(workerExitCode('success', true), 0);
});

test('auth failures and unclaimable targeted tasks are non-success outcomes', () => {
  assert.equal(classifyWorkerResult({ code: 1, out: '', err: 'Not logged in; use login' }), 'auth');
  assert.equal(workerExitCode('auth', true), 2);
  assert.equal(workerExitCode('idle', true), 3);
  assert.equal(workerExitCode('idle', false), 0);
});

test('worker entrypoint rejects invalid task IDs before configuration or network access', () => {
  const result = spawnSync(process.execPath, ['scripts/devq-worker.mjs', '--once', '--task', 'bad-filter&status=neq.queued'], {
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full dev_tasks UUID/);
});

test('cloud workflow validates before install and defers completion until PR handoff', () => {
  const workflow = readFileSync(new URL('../.github/workflows/devq-cloud.yml', import.meta.url), 'utf8');
  assert.ok(workflow.indexOf('Check runner configuration') < workflow.indexOf('Install dependencies and Copilot CLI'));
  assert.match(workflow, /--task "\$TASK_ID" --defer-completion/);
  assert.ok(workflow.indexOf('PR_URL=$(gh pr create') < workflow.indexOf('PR ready for review:'));
  assert.match(workflow, /Record PR handoff failure/);
  assert.ok(!workflow.includes('--task "${{ inputs.task_id }}"'));
});
