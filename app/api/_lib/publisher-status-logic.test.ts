import assert from 'node:assert/strict';
import { test } from 'node:test';

import { publisherHeartbeatStatus } from './publisher-status-logic.ts';

test('video provider errors alone keep the publisher healthy', () => {
  assert.equal(publisherHeartbeatStatus({ failed: 0, videoErrors: [{ error: 'AI Gateway requires a valid credit card' }], needsCredentials: [] }), 'ok');
});

test('failed posts degrade the publisher', () => {
  assert.equal(publisherHeartbeatStatus({ failed: 1, videoErrors: [], needsCredentials: [] }), 'degraded');
});

test('credential-blocked posts degrade the publisher', () => {
  assert.equal(publisherHeartbeatStatus({ failed: 0, videoErrors: [], needsCredentials: [{ id: 'p1' }] }), 'degraded');
});

test('clean runs are ok', () => {
  assert.equal(publisherHeartbeatStatus({ failed: 0, videoErrors: [], needsCredentials: [] }), 'ok');
});
