import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildExecutiveBriefing, isPhaseGatedTarget, isRedAlert, manilaDateKey, parseUpdateInput, validatePlanInput } from './order-plan.ts';

const NOW = Date.parse('2026-10-28T04:00:00Z'); // 12:00 PM Manila
const TODAY = '2026-10-28';
const HOUR = 3600 * 1000;

test('parseUpdateInput accepts next/target in any order', () => {
  const a = parseUpdateInput('next: send GCash details | target: 2026-11-05', TODAY);
  const b = parseUpdateInput('target: 2026-11-05 | next: send GCash details', TODAY);
  assert.deepEqual('plan' in a && a.plan, { next_action_item: 'send GCash details', target_completion_date: '2026-11-05' });
  assert.deepEqual(a, b);
});

test('parseUpdateInput rejects missing next, bad or past dates', () => {
  assert.ok('error' in parseUpdateInput('target: 2026-11-05', TODAY));
  assert.ok('error' in parseUpdateInput('next: call client', TODAY));
  assert.ok('error' in parseUpdateInput('next: call client | target: 11/05/2026', TODAY));
  assert.ok('error' in parseUpdateInput('next: call client | target: 2026-02-30', TODAY));
  assert.ok('error' in parseUpdateInput('next: call client | target: 2026-10-01', TODAY));
});

test('validatePlanInput trims and caps the action text', () => {
  const result = validatePlanInput({ nextActionItem: `  ${'x'.repeat(400)}  `, targetCompletionDate: '2026-11-05' }, TODAY);
  assert.ok('plan' in result);
  assert.equal(result.plan.next_action_item.length, 300);
});

test('isPhaseGatedTarget gates pipeline stages and COMPLETED only', () => {
  assert.equal(isPhaseGatedTarget('S06_SIZING'), true);
  assert.equal(isPhaseGatedTarget('COMPLETED'), true);
  assert.equal(isPhaseGatedTarget('ON_HOLD'), false);
  assert.equal(isPhaseGatedTarget('CANCELLED'), false);
});

test('isRedAlert flags active phases stuck for 48h or more', () => {
  const entered = new Date(NOW - 48 * HOUR).toISOString();
  assert.equal(isRedAlert({ stage: 'S08_PRODUCTION', stage_entered_at: entered, updated_at: null, created_at: null }, NOW), true);
  assert.equal(isRedAlert({ stage: 'S08_PRODUCTION', stage_entered_at: new Date(NOW - 47 * HOUR).toISOString(), updated_at: null, created_at: null }, NOW), false);
});

test('isRedAlert ignores ON_HOLD, COMPLETED, and CANCELLED', () => {
  const old = new Date(NOW - 200 * HOUR).toISOString();
  for (const stage of ['ON_HOLD', 'COMPLETED', 'CANCELLED']) {
    assert.equal(isRedAlert({ stage, stage_entered_at: old, updated_at: null, created_at: null }, NOW), false, stage);
  }
});

test('manilaDateKey uses Asia/Manila calendar day', () => {
  assert.equal(manilaDateKey(Date.parse('2026-10-27T17:30:00Z')), '2026-10-28');
});

test('buildExecutiveBriefing lists red alerts, overdue, and missing plans', () => {
  const text = buildExecutiveBriefing({
    nowMs: NOW,
    updatesLast24h: 3,
    orders: [
      { order_number: 'ORD-1', client_name: 'Panasonic', project_name: null, stage: 'S08_PRODUCTION', stage_entered_at: new Date(NOW - 72 * HOUR).toISOString(), updated_at: null, created_at: null, next_action_item: 'QC batch', target_completion_date: '2026-11-01' },
      { order_number: 'ORD-2', client_name: 'Nokia <Test>', project_name: null, stage: 'S04_QUOTATION', stage_entered_at: new Date(NOW - HOUR).toISOString(), updated_at: null, created_at: null, next_action_item: null, target_completion_date: null },
      { order_number: 'ORD-3', client_name: 'Globe', project_name: null, stage: 'S07_SAMPLE', stage_entered_at: new Date(NOW - HOUR).toISOString(), updated_at: null, created_at: null, next_action_item: 'Send sample', target_completion_date: '2026-10-20' },
      { order_number: 'ORD-4', client_name: 'Smart', project_name: null, stage: 'COMPLETED', stage_entered_at: null, updated_at: null, created_at: null, next_action_item: null, target_completion_date: null },
    ],
  });
  assert.match(text, /6:00 AM EXECUTIVE PROGRESS BRIEFING/);
  assert.match(text, /Red Alerts: <b>1<\/b>/);
  assert.match(text, /Client updates \(24h\): <b>3<\/b>/);
  assert.match(text, /RED ALERT: stuck 48h\+ \(1\)/);
  assert.match(text, /Overdue target \(1\)/);
  assert.match(text, /Missing plan[^\n]*\(1\)/);
  assert.match(text, /Nokia &lt;Test&gt;/);
  assert.doesNotMatch(text, /Smart/);
});
