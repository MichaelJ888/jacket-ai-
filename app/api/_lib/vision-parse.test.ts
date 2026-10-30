import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStageInput } from './client-pulse.ts';

// The vision parser maps Filipino/English status words to canonical stages via resolveStageInput.
test('stage mapping covers Viber/chat screenshot phrases', () => {
  assert.equal(resolveStageInput('sewing'), 'S08_PRODUCTION');
  assert.equal(resolveStageInput('tahi'), 'S08_PRODUCTION');
  assert.equal(resolveStageInput('burda'), 'S08_PRODUCTION');
  assert.equal(resolveStageInput('paid'), 'S10_BALANCE');
  assert.equal(resolveStageInput('full paid'), 'S10_BALANCE');
  assert.equal(resolveStageInput('fullpaid'), 'S10_BALANCE');
  assert.equal(resolveStageInput('binayaran'), 'S10_BALANCE');
  assert.equal(resolveStageInput('deposit'), 'S05_DEPOSIT');
  assert.equal(resolveStageInput('dp'), 'S05_DEPOSIT');
  assert.equal(resolveStageInput('downpayment'), 'S05_DEPOSIT');
  assert.equal(resolveStageInput('down payment'), 'S05_DEPOSIT');
  assert.equal(resolveStageInput('ready'), 'S11_DISPATCH');
  assert.equal(resolveStageInput('delivered'), 'S11_DISPATCH');
  assert.equal(resolveStageInput('qc'), 'S09_QC');
  assert.equal(resolveStageInput('done'), 'COMPLETED');
  assert.equal(resolveStageInput('hold'), 'ON_HOLD');
  assert.equal(resolveStageInput('cancel'), 'CANCELLED');
});

test('unknown or empty stage returns null (parser will skip stage update)', () => {
  assert.equal(resolveStageInput('bogus'), null);
  assert.equal(resolveStageInput(''), null);
  assert.equal(resolveStageInput('   '), null);
});
