import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStageInput } from './client-pulse.ts';

// The vision parser maps Filipino/English status words to canonical stages via resolveStageInput.
test('stage mapping covers Viber/chat screenshot phrases', () => {
  assert.equal(resolveStageInput('sewing'), 'SEWING');
  assert.equal(resolveStageInput('tahi'), 'SEWING');
  assert.equal(resolveStageInput('burda'), 'EMBROIDERY');
  assert.equal(resolveStageInput('paid'), 'DEPOSIT_VERIFIED');
  assert.equal(resolveStageInput('deposit'), 'AWAITING_DEPOSIT');
  assert.equal(resolveStageInput('ready'), 'READY_FOR_DELIVERY');
  assert.equal(resolveStageInput('delivered'), 'DELIVERED');
  assert.equal(resolveStageInput('done'), 'COMPLETED');
  assert.equal(resolveStageInput('hold'), 'ON_HOLD');
  assert.equal(resolveStageInput('cancel'), 'CANCELLED');
});

test('unknown or empty stage returns null (parser will skip stage update)', () => {
  assert.equal(resolveStageInput('bogus'), null);
  assert.equal(resolveStageInput(''), null);
  assert.equal(resolveStageInput('   '), null);
});
