import test from 'node:test';
import assert from 'node:assert/strict';
import { runSwarm, parseSubtasks, parseVerdict, clampAgents, CEO_SWARM_MAX_AGENTS, HARD_MAX_AGENTS, type AgentCall } from './swarm.ts';

function fakeRunner(opts: { failFirstSkeptic?: boolean; subtasks?: number } = {}) {
  const calls: AgentCall[] = [];
  let inflight = 0;
  let peak = 0;
  let skepticSeen = 0;
  const runner = async (c: AgentCall) => {
    calls.push(c);
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight--;
    if (c.role === 'lead') return JSON.stringify(Array.from({ length: opts.subtasks ?? 5 }, (_, i) => `task ${i}`));
    if (c.role === 'skeptic') return opts.failFirstSkeptic && skepticSeen++ === 0 ? 'VERDICT: FAIL - wrong' : 'VERDICT: PASS';
    if (c.role === 'merger') return 'FINAL';
    return `done: ${c.prompt.slice(-12)}`;
  };
  return { runner, calls, peak: () => peak };
}

test('parsers', () => {
  assert.deepEqual(parseSubtasks('x ["a","b","a"] y', 10), ['a', 'b']);
  assert.deepEqual(parseSubtasks('- one thing\n- two thing', 1), ['one thing']);
  assert.equal(parseVerdict('VERDICT: FAIL - bad').ok, false);
  assert.equal(parseVerdict('VERDICT: PASS').ok, true);
  assert.equal(parseVerdict('no idea').ok, false);
  assert.equal(clampAgents(99999), HARD_MAX_AGENTS);
  assert.equal(clampAgents(99999, CEO_SWARM_MAX_AGENTS), CEO_SWARM_MAX_AGENTS);
});

test('full run: plan, fan-out, verify, merge, with bounded concurrency', async () => {
  const f = fakeRunner({ subtasks: 8 });
  const r = await runSwarm({ goal: 'g', runner: f.runner, maxAgents: 40, concurrency: 3 });
  assert.equal(r.status, 'complete');
  assert.equal(r.state.report, 'FINAL');
  assert.equal(Object.keys(r.state.results).length, 8);
  assert.ok(f.peak() <= 3);
  assert.equal(f.calls.filter((c) => c.role === 'skeptic').length, 8);
});

test('rejected result gets exactly one revision', async () => {
  const f = fakeRunner({ failFirstSkeptic: true, subtasks: 2 });
  const r = await runSwarm({ goal: 'g', runner: f.runner, maxAgents: 40 });
  assert.equal(f.calls.filter((c) => c.role === 'worker').length, 3);
  assert.ok(Object.values(r.state.verdicts).every((v) => v.ok));
});

test('agent budget is never exceeded', async () => {
  const f = fakeRunner({ subtasks: 50 });
  const r = await runSwarm({ goal: 'g', runner: f.runner, maxAgents: 10 });
  assert.ok(f.calls.length <= 10);
  assert.equal(r.status, 'complete');
});

test('deadline yields partial state that resumes without re-running finished agents', async () => {
  const f = fakeRunner({ subtasks: 6 });
  let t = 0;
  const first = await runSwarm({ goal: 'g', runner: f.runner, maxAgents: 40, concurrency: 1, deadlineMs: 2, now: () => t++ });
  assert.equal(first.status, 'partial');
  const done = Object.keys(first.state.results).length;
  const callsBefore = f.calls.length;
  const second = await runSwarm({ goal: 'g', runner: f.runner, maxAgents: 40, state: first.state });
  assert.equal(second.status, 'complete');
  assert.equal(f.calls.filter((c) => c.role === 'lead').length, 1);
  assert.equal(f.calls.slice(callsBefore).filter((c) => c.role === 'worker').length, 6 - done);
});
