import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GOALS,
  MAX_STEPS_PER_GOAL,
  addGoal,
  addStep,
  defaultGoals,
  deleteGoal,
  deleteStep,
  goalProgress,
  overallProgress,
  parseGoals,
  parseSuggestedSteps,
  setStepTitle,
  toggleStep,
  type MainGoal,
} from './main-goals-logic.ts';

test('defaultGoals seeds the six directives with unique ids and steps', () => {
  const goals = defaultGoals();
  assert.deepEqual(
    goals.map((g) => g.title),
    ['Virtual Office', 'Business Permit', 'PhilGEPS', 'School Uniforms (OLOPSCH & FEU)', 'Company Giveaways', 'Company Uniforms'],
  );
  assert.ok(goals.every((g) => g.steps.length === 4 && g.steps.every((s) => !s.done)));
  const ids = goals.flatMap((g) => g.steps.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('parseGoals returns null for non-array input and drops blank goals and steps', () => {
  assert.equal(parseGoals({ doneSteps: [] }), null);
  assert.equal(parseGoals(null), null);
  const parsed = parseGoals([
    { id: 'a', title: '  Alpha  ', steps: [{ id: 's1', title: 'One', done: true }, { id: 's2', title: '   ', done: false }] },
    { id: 'b', title: '   ', steps: [] },
  ]);
  assert.ok(parsed);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Alpha');
  assert.deepEqual(parsed[0].steps, [{ id: 's1', title: 'One', done: true }]);
});

test('parseGoals generates ids for missing or duplicate ids', () => {
  const parsed = parseGoals([
    { id: 'dup', title: 'First', steps: [] },
    { id: 'dup', title: 'Second', steps: [{ title: 'x', done: false }] },
  ]);
  assert.ok(parsed);
  assert.equal(parsed.length, 2);
  assert.notEqual(parsed[0].id, parsed[1].id);
  assert.ok(parsed[1].steps[0].id);
});

test('toggleStep and setStepTitle are immutable and touch only the target step', () => {
  const goals = defaultGoals();
  const target = goals[0].steps[0].id;
  const toggled = toggleStep(goals, target, true);
  assert.equal(toggled[0].steps[0].done, true);
  assert.equal(goals[0].steps[0].done, false);
  assert.equal(toggled[0].steps[1].done, false);
  const renamed = setStepTitle(goals, target, 'New text');
  assert.equal(renamed[0].steps[0].title, 'New text');
  assert.notEqual(goals[0].steps[0].title, 'New text');
});

test('addStep respects the per-goal limit and deleteStep removes only that step', () => {
  let goals: MainGoal[] = [{ id: 'g', title: 'G', steps: [] }];
  for (let i = 0; i < MAX_STEPS_PER_GOAL + 5; i++) goals = addStep(goals, 'g', `Step ${i}`);
  assert.equal(goals[0].steps.length, MAX_STEPS_PER_GOAL);
  const removed = deleteStep(goals, goals[0].steps[0].id);
  assert.equal(removed[0].steps.length, MAX_STEPS_PER_GOAL - 1);
  assert.equal(removed[0].steps[0].title, 'Step 1');
});

test('addGoal appends a goal with generated steps and respects the goal cap', () => {
  const goals = addGoal(defaultGoals(), 'Expand Factory Capacity in Rizal', ['Survey site', 'Hire crew', 'Install machines']);
  assert.equal(goals.length, 7);
  const added = goals[6];
  assert.equal(added.title, 'Expand Factory Capacity in Rizal');
  assert.deepEqual(added.steps.map((s) => s.title), ['Survey site', 'Hire crew', 'Install machines']);
  assert.ok(added.steps.every((s) => !s.done));

  const full: MainGoal[] = Array.from({ length: MAX_GOALS }, (_, i) => ({ id: `g${i}`, title: `G${i}`, steps: [] }));
  assert.equal(addGoal(full, 'Overflow', []).length, MAX_GOALS);
});

test('deleteGoal removes only the matching goal', () => {
  const goals = defaultGoals();
  const remaining = deleteGoal(goals, goals[2].id);
  assert.equal(remaining.length, 5);
  assert.ok(!remaining.some((g) => g.id === goals[2].id));
});

test('goalProgress and overallProgress compute status and percentages', () => {
  const goals = defaultGoals();
  assert.deepEqual(goalProgress(goals[0]), { done: 0, total: 4, percent: 0, status: 'not_started' });
  let partial = toggleStep(goals, goals[0].steps[0].id, true);
  assert.equal(goalProgress(partial[0]).status, 'in_progress');
  assert.equal(goalProgress(partial[0]).percent, 25);
  for (const step of partial[0].steps) partial = toggleStep(partial, step.id, true);
  assert.equal(goalProgress(partial[0]).status, 'complete');
  assert.equal(goalProgress({ id: 'e', title: 'E', steps: [] }).percent, 0);

  const overall = overallProgress(partial);
  assert.deepEqual(overall, { done: 4, total: 24, percent: 17 });
  assert.deepEqual(overallProgress([]), { done: 0, total: 0, percent: 0 });
});

test('parseSuggestedSteps reads a JSON array, including fenced output', () => {
  assert.deepEqual(parseSuggestedSteps('["Draft plan", "Get approval"]'), ['Draft plan', 'Get approval']);
  assert.deepEqual(parseSuggestedSteps('```json\n["A step", "B step"]\n```'), ['A step', 'B step']);
});

test('parseSuggestedSteps falls back to bulleted or numbered lines', () => {
  assert.deepEqual(parseSuggestedSteps('1. Draft plan\n2) Get approval\n- Launch'), ['Draft plan', 'Get approval', 'Launch']);
});

test('parseSuggestedSteps dedupes case-insensitively and caps at five', () => {
  const steps = parseSuggestedSteps('["One","one","Two","Three","Four","Five","Six"]');
  assert.deepEqual(steps, ['One', 'Two', 'Three', 'Four', 'Five']);
});

test('parseSuggestedSteps returns an empty list for blank output', () => {
  assert.deepEqual(parseSuggestedSteps('   '), []);
});
