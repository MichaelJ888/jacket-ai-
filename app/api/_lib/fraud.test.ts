import assert from 'node:assert/strict';
import test from 'node:test';
import { assessReceiptRisk } from './fraud.ts';

const base = { amount: 1000, expectedAmount: 1000, reference: '123456', transactionDate: '2026-10-07T01:00:00Z', recipient: 'RICHARD DG VENEZUELA', tamperSigns: [], duplicateReference: false, now: new Date('2026-10-07T05:00:00Z') };

test('clean receipt passes', () => {
  const risk = assessReceiptRisk(base);
  assert.equal(risk.suspicious, false);
  assert.equal(risk.score, 0);
});

test('duplicate reference is suspicious', () => {
  assert.equal(assessReceiptRisk({ ...base, duplicateReference: true }).suspicious, true);
});

test('wrong recipient and stale date are suspicious', () => {
  const risk = assessReceiptRisk({ ...base, recipient: 'JUAN DELA CRUZ', transactionDate: '2026-09-01T00:00:00Z' });
  assert.equal(risk.suspicious, true);
  assert.ok(risk.flags.some((flag) => flag.startsWith('RECIPIENT_MISMATCH')));
});

test('tamper sign alone is not enough but adds risk', () => {
  const risk = assessReceiptRisk({ ...base, tamperSigns: ['font mismatch'] });
  assert.equal(risk.suspicious, false);
  assert.equal(risk.score, 0.4);
});
