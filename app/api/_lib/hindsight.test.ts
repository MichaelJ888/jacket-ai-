import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hindsightEnabled, hindsightRecall, hindsightRetain } from './hindsight.ts';

test('hindsightEnabled returns true by default for native cloud memory', () => {
  assert.equal(hindsightEnabled(), true);
});

test('hindsightRetain rejects empty content gracefully', async () => {
  const result = await hindsightRetain('   ');
  assert.equal(result, false);
});

test('hindsightRecall returns empty array on empty query', async () => {
  const result = await hindsightRecall('');
  assert.deepEqual(result, []);
});

