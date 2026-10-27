import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyBoostCategory, manilaWeekday, preferredCategory, rankBoostCandidates, type BoostCandidate } from './boost-advisor-logic.ts';

const candidate = (id: string, caption: string, reach: number | null = null, shares: number | null = null): BoostCandidate => ({
  id,
  platform: 'facebook',
  media_type: 'image',
  caption,
  scheduled_at: '2026-10-27T01:00:00.000Z',
  published_at: '2026-10-27T01:00:00.000Z',
  post_url: null,
  reach,
  shares,
});

test('maps Manila weekdays to the requested content themes', () => {
  assert.equal(preferredCategory('Mon'), 'b2b');
  assert.equal(preferredCategory('Tue'), 'b2b');
  assert.equal(preferredCategory('Wed'), 'safety');
  assert.equal(preferredCategory('Thu'), 'safety');
  assert.equal(preferredCategory('Fri'), 'team');
  assert.equal(preferredCategory('Sat'), 'team');
  assert.equal(preferredCategory('Sun'), 'general');
});

test('classifies corporate, safety, and team content', () => {
  assert.equal(classifyBoostCategory('Custom corporate jackets for your company'), 'b2b');
  assert.equal(classifyBoostCategory('Reflectorized safety wear for contractors'), 'safety');
  assert.equal(classifyBoostCategory('Varsity team jackets for your event'), 'team');
});

test('engagement score outranks the weekday theme and missing insight metrics', () => {
  const ranked = rankBoostCandidates([
    candidate('weekday', 'Corporate giveaways for companies', 30, 0),
    candidate('engagement', 'Custom team jackets', 25, 2),
    candidate('unknown', 'Corporate jackets'),
  ], 'Mon');

  assert.deepEqual(ranked.map((row) => row.id), ['engagement', 'weekday', 'unknown']);
});

test('uses weekday theme when no engagement metrics are available', () => {
  const ranked = rankBoostCandidates([
    candidate('team', 'Varsity sports team wear'),
    candidate('safety', 'Reflectorized industrial safety jackets'),
    candidate('video', 'Corporate uniforms'),
  ], 'Wed');

  assert.equal(ranked[0].id, 'safety');
});

test('resolves weekday in Manila time', () => {
  assert.equal(manilaWeekday(new Date('2026-10-26T17:00:00.000Z')), 'Tue');
});
