import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HARD_MAX_POSTS_PER_DAY,
  POSTING_SLOTS_UTC,
  maxPostsPerDay,
  remainingDailyQuota,
  selectWithinQuota,
  withContactFooter,
} from './content-policy.ts';

test('contact footer appends all three hotlines once', () => {
  const once = withContactFooter('Message us today.');
  assert.match(once, /Smart: 0920 695 91 67/);
  assert.match(once, /Globe: 0997 411 45 94/);
  assert.match(once, /Viber\/Telegram: 0929 227 17 61/);
  assert.equal(withContactFooter(once), once);
});

test('posting slots are the four UTC times (9 AM, 1:30 PM, 6 PM, 9 PM Manila)', () => {
  assert.deepEqual(POSTING_SLOTS_UTC.map((slot) => `${slot.hour}:${String(slot.minute).padStart(2, '0')}`), ['1:00', '5:30', '10:00', '13:00']);
});

test('video and picture slots strictly alternate every day', () => {
  assert.deepEqual(POSTING_SLOTS_UTC.map((slot) => slot.kind), ['video', 'picture', 'video', 'picture']);
  assert.equal(POSTING_SLOTS_UTC.length, HARD_MAX_POSTS_PER_DAY);
});

test('maxPostsPerDay never exceeds the hard cap of 4', () => {
  assert.equal(maxPostsPerDay(undefined), 4);
  assert.equal(maxPostsPerDay('10'), 4);
  assert.equal(maxPostsPerDay('2'), 2);
  assert.equal(maxPostsPerDay('0'), 4);
  assert.equal(maxPostsPerDay('abc'), 4);
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
