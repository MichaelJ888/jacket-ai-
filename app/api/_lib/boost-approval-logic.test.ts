import assert from 'node:assert/strict';
import test from 'node:test';

import { BOOST_TOTAL_PESOS, boostKeyboard, manilaDateKey, parseBoostCallback } from './boost-approval-logic.ts';

test('parseBoostCallback maps yes/no to APPROVED/CANCELLED', () => {
  assert.deepEqual(parseBoostCallback('boost_go:yes:post-12345678'), { decision: 'APPROVED', postId: 'post-12345678' });
  assert.deepEqual(parseBoostCallback('boost_go:no:post-12345678'), { decision: 'CANCELLED', postId: 'post-12345678' });
});

test('parseBoostCallback rejects foreign or malformed callback data', () => {
  assert.equal(parseBoostCallback('appr:yes:00000000-0000-0000-0000-000000000000'), null);
  assert.equal(parseBoostCallback('boost_go:maybe:post-12345678'), null);
  assert.equal(parseBoostCallback('boost_go:yes:x'), null);
});

test('boostKeyboard labels the total budget and fits Telegram callback limits', () => {
  const keyboard = boostKeyboard('3f2b1c4d-aaaa-bbbb-cccc-1234567890ab');
  const [approve, cancel] = keyboard.inline_keyboard[0];
  assert.equal(BOOST_TOTAL_PESOS, 700);
  assert.equal(approve.text, 'APPROVE BOOST ₱700');
  assert.equal(cancel.text, 'CANCEL');
  for (const button of [approve, cancel]) {
    assert.ok(Buffer.byteLength(button.callback_data) <= 64);
    assert.notEqual(parseBoostCallback(button.callback_data), null);
  }
});

test('manilaDateKey uses the Manila calendar day', () => {
  // 2026-11-03T20:00Z is already 2026-11-04 in Manila (UTC+8).
  assert.equal(manilaDateKey(new Date('2026-11-03T20:00:00Z')), '2026-11-04');
});
