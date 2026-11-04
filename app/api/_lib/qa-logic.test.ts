import assert from 'node:assert/strict';
import test from 'node:test';

import { QA_MAX_BATCH, parseQaBatch } from './qa-logic.ts';

test('parseQaBatch accepts valid pairs and normalizes whitespace', () => {
  const { pairs, errors } = parseQaBatch({ pairs: [{ question: '  Ano po ang MOQ?  ', answer: 'Ang MOQ po namin ay 20 pcs.', status: 'approved' }] });
  assert.deepEqual(errors, []);
  assert.deepEqual(pairs, [{ question: 'Ano po ang MOQ?', answer: 'Ang MOQ po namin ay 20 pcs.', status: 'approved', source: 'website' }]);
});

test('parseQaBatch defaults status to pending and rejects bad rows individually', () => {
  const { pairs, errors } = parseQaBatch({
    pairs: [
      { question: 'Valid question?', answer: 'Valid answer.' },
      { question: 'x', answer: 'Too short question.' },
      { question: 'Good question?', answer: 'Good answer.', status: 'live' },
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].status, 'pending');
  assert.equal(errors.length, 2);
});

test('parseQaBatch rejects malformed or oversized bodies', () => {
  assert.equal(parseQaBatch(null).errors.length, 1);
  assert.equal(parseQaBatch({ pairs: [] }).errors.length, 1);
  const big = Array.from({ length: QA_MAX_BATCH + 1 }, () => ({ question: 'Question?', answer: 'Answer.' }));
  assert.match(parseQaBatch({ pairs: big }).errors[0], /exceeds/);
});
