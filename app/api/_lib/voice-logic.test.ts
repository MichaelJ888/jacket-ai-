import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCallAlert, maskPhone, normalizePhone, signRetellBody, toCallRecord, verifyRetellSignature } from './voice-logic.ts';

const KEY = 'key_test';
const BODY = '{"event":"call_ended","call":{"call_id":"abc"}}';

test('valid signature passes', () => {
  const now = Date.now();
  assert.equal(verifyRetellSignature(BODY, KEY, signRetellBody(BODY, KEY, now), now), true);
});

test('tampered body, wrong key, stale timestamp, garbage header fail', () => {
  const now = Date.now();
  const sig = signRetellBody(BODY, KEY, now);
  assert.equal(verifyRetellSignature(BODY + ' ', KEY, sig, now), false);
  assert.equal(verifyRetellSignature(BODY, 'other', sig, now), false);
  assert.equal(verifyRetellSignature(BODY, KEY, sig, now + 6 * 60 * 1000), false);
  assert.equal(verifyRetellSignature(BODY, KEY, 'nonsense', now), false);
  assert.equal(verifyRetellSignature(BODY, KEY, null, now), false);
  assert.equal(verifyRetellSignature(BODY, '', sig, now), false);
});

test('normalizePhone handles PH formats', () => {
  assert.equal(normalizePhone('+63 917 123 4567'), '09171234567');
  assert.equal(normalizePhone('9171234567'), '09171234567');
  assert.equal(normalizePhone('0917-123-4567'), '09171234567');
  assert.equal(maskPhone('+639171234567'), '*******4567');
});

test('toCallRecord maps fields and rejects missing id', () => {
  assert.equal(toCallRecord({}), null);
  const rec = toCallRecord({ call_id: 'c1', from_number: '+639171234567', duration_ms: 65000, call_cost: { combined_cost: 12.5 }, call_analysis: { call_summary: 'Wants 20 jackets' } });
  assert.equal(rec?.duration_seconds, 65);
  assert.equal(rec?.cost_usd, 0.13);
  assert.equal(rec?.from_number, '09171234567');
  assert.match(formatCallAlert(rec!), /Wants 20 jackets/);
  assert.doesNotMatch(formatCallAlert(rec!), /09171234567/);
});
