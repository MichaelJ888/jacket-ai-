import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, orderedCandidates, markFailure, resetPoolForTests, withModelFallback, type Candidate } from './llm-pool.ts';

const fake = (id: string, tiers: Candidate['tiers'] = ['cheap', 'strong'], tools = true): Candidate => ({ id, tools, tiers, make: () => ({ id }) as never });

test('classifies provider failures', () => {
  assert.equal(classifyFailure({ statusCode: 429, message: 'x' }), 'quota');
  assert.equal(classifyFailure(new Error('You exceeded your current quota')), 'quota');
  assert.equal(classifyFailure(new Error('experiencing high demand')), 'overloaded');
  assert.equal(classifyFailure({ statusCode: 404, message: 'not found' }), 'missing');
  assert.equal(classifyFailure({ message: 'wrapper', lastError: { statusCode: 429 } }), 'quota');
});

test('cooled-down candidates are skipped and tools-only filters text-only models', () => {
  resetPoolForTests([fake('a'), fake('b'), fake('c', ['cheap'], false)]);
  markFailure('a', { statusCode: 429 });
  assert.deepEqual(orderedCandidates('strong', true).map((c) => c.id), ['b']);
  assert.ok(orderedCandidates('cheap', false).map((c) => c.id).includes('c'));
});

test('cheap tier rotates, strong keeps declared order', () => {
  resetPoolForTests([fake('a'), fake('b'), fake('c')]);
  const firsts = [0, 1, 2].map(() => orderedCandidates('cheap', true)[0].id);
  assert.equal(new Set(firsts).size, 3);
  assert.equal(orderedCandidates('strong', true)[0].id, 'a');
});

test('withModelFallback falls through failing models and cools them down', async () => {
  resetPoolForTests([fake('a'), fake('b')]);
  const tried: string[] = [];
  const out = await withModelFallback({ tier: 'strong' }, async (m) => {
    const id = (m as unknown as { id: string }).id;
    tried.push(id);
    if (id === 'a') throw Object.assign(new Error('quota'), { statusCode: 429 });
    return id;
  });
  assert.equal(out, 'b');
  assert.deepEqual(tried, ['a', 'b']);
  assert.deepEqual(orderedCandidates('strong', true).map((c) => c.id), ['b']);
});

test('all candidates failing rethrows the last error', async () => {
  resetPoolForTests([fake('a')]);
  await assert.rejects(withModelFallback({ tier: 'strong' }, async () => { throw new Error('boom'); }), /boom/);
});
