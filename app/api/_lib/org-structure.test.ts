import assert from 'node:assert/strict';
import test from 'node:test';

import { ORG, orgWithStatus, seatStatus } from './org-structure.ts';
import { JOBS, type JobState } from './coo-logic.ts';

test('org chart hierarchy is well-formed', () => {
  const ids = new Set(ORG.nodes.map((node) => node.id));
  assert.equal(ORG.nodes[0].id, 'board');
  assert.equal(ORG.nodes[0].reportsTo, null);
  for (const node of ORG.nodes) {
    if (node.reportsTo !== null) assert.ok(ids.has(node.reportsTo), `${node.id} reports to unknown ${node.reportsTo}`);
    assert.ok(ORG.departments.some((dept) => dept.id === node.department), `${node.id} has unknown department ${node.department}`);
  }
  // Board -> CEO -> C-Suite -> VPs -> Regional: every node reaches the board.
  const byId = new Map(ORG.nodes.map((node) => [node.id, node]));
  for (const node of ORG.nodes) {
    let cursor: OrgNodeLike = node;
    let depth = 0;
    while (cursor.reportsTo) {
      cursor = byId.get(cursor.reportsTo)!;
      depth += 1;
      assert.ok(depth < 10, `${node.id} has a reporting cycle`);
    }
    assert.equal(cursor.id, 'board', `${node.id} must chain up to the board`);
  }
  // All three regions are represented in Go-To-Market.
  const regions = new Set(ORG.nodes.filter((node) => node.region).map((node) => node.region));
  assert.deepEqual([...regions].sort(), ['AMER', 'APAC', 'EMEA']);
});

type OrgNodeLike = (typeof ORG.nodes)[number];

test('every aiJob reference points at a real scheduled job', () => {
  const known = new Set(JOBS.map((job) => job.job));
  // Jobs that exist as cron routes/heartbeats but are not in the COO department list.
  for (const extra of ['auto-pilot', 'executive-briefing', 'system-health', 'anne-daily-updates', 'client-pulse']) known.add(extra);
  for (const node of ORG.nodes) {
    for (const job of node.aiJobs) assert.ok(known.has(job), `${node.id} references unknown job ${job}`);
  }
});

test('seatStatus rolls up worst state; human seats are manual', () => {
  const states = new Map<string, JobState>([['swarm-worker', 'ok'], ['auto-pilot', 'ok']]);
  const coo = ORG.nodes.find((node) => node.id === 'coo')!;
  const board = ORG.nodes.find((node) => node.id === 'board')!;
  assert.equal(seatStatus(coo, states), 'operational');
  assert.equal(seatStatus(board, states), 'manual');
  states.set('auto-pilot', 'stale');
  assert.equal(seatStatus(coo, states), 'attention');
  const org = orgWithStatus(states);
  assert.equal(org.nodes.find((node) => node.id === 'coo')?.status, 'attention');
});
