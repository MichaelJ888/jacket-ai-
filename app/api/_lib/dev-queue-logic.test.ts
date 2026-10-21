import assert from 'node:assert/strict';
import test from 'node:test';
import { routeCeoMessage } from './dev-queue-logic.ts';

test('explicit prefixes queue a dev task', () => {
  assert.deepEqual(routeCeoMessage('/dev fix the payment-verify route'), { kind: 'dev', task: 'fix the payment-verify route', explicit: true });
  assert.equal(routeCeoMessage('vscode: add a column to orders').kind, 'dev');
});

test('code-looking requests are routed to dev, business chat is not', () => {
  assert.equal(routeCeoMessage('please fix the bug in the telegram webhook route').kind, 'dev');
  assert.equal(routeCeoMessage('magkano ang 50 pcs na jacket?').kind, 'ceo');
  assert.equal(routeCeoMessage('add 5 pcs to the order of Jonathan').kind, 'ceo');
});

test('biz prefix forces CEO agent, commands are recognised', () => {
  assert.equal(routeCeoMessage('/biz deploy the new price list').kind, 'ceo');
  assert.deepEqual(routeCeoMessage('/ideas'), { kind: 'command', name: 'ideas' });
  assert.deepEqual(routeCeoMessage('/queue'), { kind: 'command', name: 'queue' });
  assert.equal(routeCeoMessage('/dev').kind, 'ceo');
});
