import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAIN_GOALS, goalProgress, overallProgress, parseDoneSteps, setStepDone } from './main-goals-logic.ts';

test('defines the six core directives in order', () => {
  assert.deepEqual(
    MAIN_GOALS.map((goal) => goal.title),
    ['Virtual Office', 'Business Permit', 'PhilGEPS', 'School Uniforms (OLOPSCH & FEU)', 'Company Giveaways', 'Company Uniforms'],
  );
  assert.ok(MAIN_GOALS.every((goal) => goal.steps.length > 0));
});

test('step IDs are unique across all goals', () => {
  const ids = MAIN_GOALS.flatMap((goal) => goal.steps.map((step) => step.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('parseDoneSteps drops unknown IDs, non-strings and duplicates', () => {
  const known = MAIN_GOALS[0].steps[0].id;
  assert.deepEqual(parseDoneSteps([known, known, 'not-a-step', 42, null]), [known]);
  assert.deepEqual(parseDoneSteps('nope'), []);
  assert.deepEqual(parseDoneSteps(undefined), []);
});

test('setStepDone adds and removes known steps and rejects unknown ones', () => {
  const [first, second] = MAIN_GOALS[0].steps.map((step) => step.id);
  assert.deepEqual(setStepDone([], first, true), [first]);
  assert.deepEqual(setStepDone([first], first, true), [first]);
  assert.deepEqual(setStepDone([first, second], first, false), [second]);
  assert.equal(setStepDone([], 'unknown-step', true), null);
});

test('goalProgress reports not started, in progress and complete', () => {
  const goal = MAIN_GOALS[1];
  const ids = goal.steps.map((step) => step.id);
  assert.deepEqual(goalProgress(goal, []), { done: 0, total: ids.length, percent: 0, status: 'not_started' });
  const partial = goalProgress(goal, ids.slice(0, 1));
  assert.equal(partial.status, 'in_progress');
  assert.equal(partial.done, 1);
  assert.deepEqual(goalProgress(goal, ids), { done: ids.length, total: ids.length, percent: 100, status: 'complete' });
});

test('overallProgress counts every step across all goals', () => {
  const total = MAIN_GOALS.reduce((sum, goal) => sum + goal.steps.length, 0);
  assert.deepEqual(overallProgress([]), { done: 0, total, percent: 0 });
  const all = MAIN_GOALS.flatMap((goal) => goal.steps.map((step) => step.id));
  assert.deepEqual(overallProgress(all), { done: total, total, percent: 100 });
});
