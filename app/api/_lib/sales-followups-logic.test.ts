import assert from 'node:assert/strict';
import test from 'node:test';

import { followupDeliveryPatch, reviewRequestDeliveryPatch } from './sales-followups-logic.ts';

test('failed follow-up retains the successful-send count and schedules a bounded retry', () => {
  assert.deepEqual(followupDeliveryPatch({
    sent: false,
    followupCount: 1,
    sentAt: '2026-10-27T03:00:00.000Z',
    nextFollowupAt: '2026-10-27T22:00:00.000Z',
    retryAt: '2026-10-27T05:00:00.000Z',
  }), {
    next_followup_at: '2026-10-27T05:00:00.000Z',
  });
});

test('successful follow-up increments the count and records outbound time', () => {
  assert.deepEqual(followupDeliveryPatch({
    sent: true,
    followupCount: 1,
    sentAt: '2026-10-27T03:00:00.000Z',
    nextFollowupAt: '2026-10-28T03:00:00.000Z',
    retryAt: '2026-10-27T05:00:00.000Z',
  }), {
    followup_count: 2,
    last_outbound_at: '2026-10-27T03:00:00.000Z',
    next_followup_at: '2026-10-28T03:00:00.000Z',
  });
});

test('failed review request remains eligible for retry; successful send records completion', () => {
  assert.equal(reviewRequestDeliveryPatch(false, '2026-10-27T03:00:00.000Z'), null);
  assert.deepEqual(reviewRequestDeliveryPatch(true, '2026-10-27T03:00:00.000Z'), {
    review_requested_at: '2026-10-27T03:00:00.000Z',
    last_outbound_at: '2026-10-27T03:00:00.000Z',
  });
});
