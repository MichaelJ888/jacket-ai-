import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HARD_MAX_POSTS_PER_DAY,
  POSTING_SLOTS_PHT,
  jitterMinutes,
  maxPostsPerDay,
  remainingDailyQuota,
  selectWithinQuota,
} from './content-policy.ts';

test('posting slots are the four PHT peak times', () => {
  assert.deepEqual(POSTING_SLOTS_PHT.map((slot) => `${slot.hour}:${String(slot.minute).padStart(2, '0')}`), ['9:30', '13:30', '16:00', '20:30']);
});

test('maxPostsPerDay never exceeds the hard cap of 4', () => {
  assert.equal(maxPostsPerDay(undefined), 4);
  assert.equal(maxPostsPerDay('10'), 4);
  assert.equal(maxPostsPerDay('2'), 2);
  assert.equal(maxPostsPerDay('0'), 4);
  assert.equal(maxPostsPerDay('abc'), 4);
});

test('jitter stays within the window and is bounded by the injected random source', () => {
  assert.equal(jitterMinutes(12, () => 0), -12);
  assert.equal(jitterMinutes(12, () => 1), 12);
  assert.equal(jitterMinutes(12, () => 0.5), 0);
  for (let i = 0; i < 200; i += 1) {
    const value = jitterMinutes(12);
    assert.ok(value >= -12 && value <= 12);
  }
});

test('remaining quota floors at zero', () => {
  assert.equal(remainingDailyQuota(0), HARD_MAX_POSTS_PER_DAY);
  assert.equal(remainingDailyQuota(3), 1);
  assert.equal(remainingDailyQuota(9), 0);
});

test('selectWithinQuota caps each platform independently and keeps order', () => {
  const rows = [
    { id: 1, platform: 'facebook' },
    { id: 2, platform: 'instagram' },
    { id: 3, platform: 'facebook' },
    { id: 4, platform: 'facebook' },
    { id: 5, platform: 'facebook' },
    { id: 6, platform: 'facebook' },
    { id: 7, platform: 'instagram' },
  ];
  const picked = selectWithinQuota(rows, { facebook: 2 });
  assert.deepEqual(picked.map((row) => row.id), [1, 2, 3, 7]);
});

test('selectWithinQuota returns nothing when a platform already hit the cap', () => {
  const rows = [{ id: 1, platform: 'facebook' }];
  assert.deepEqual(selectWithinQuota(rows, { facebook: 4 }), []);
});
