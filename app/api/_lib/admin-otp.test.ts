import assert from 'node:assert/strict';
import test from 'node:test';

import { generateOtp, hashOtp, otpMatches, otpUsable, OTP_MAX_ATTEMPTS, type OtpRow } from './admin-otp.ts';

test('generateOtp returns 6 digits and hashes verify timing-safe', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = generateOtp();
    assert.match(code, /^\d{6}$/);
    assert.ok(otpMatches(code, hashOtp(code)));
    assert.ok(!otpMatches(code === '000000' ? '000001' : '000000', hashOtp(code)));
  }
  assert.ok(!otpMatches('12345', hashOtp('123456')), 'non-6-digit input rejected');
  assert.ok(!otpMatches('abcdef', hashOtp('123456')), 'non-numeric input rejected');
});

test('otpUsable enforces expiry, single-use and attempt cap', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const base: OtpRow = { id: '1', code_hash: 'x', expires_at: new Date(now + 60_000).toISOString(), used_at: null, attempts: 0 };
  assert.deepEqual(otpUsable(base, now), { ok: true });
  assert.equal(otpUsable({ ...base, used_at: new Date(now).toISOString() }, now).reason, 'used');
  assert.equal(otpUsable({ ...base, attempts: OTP_MAX_ATTEMPTS }, now).reason, 'too-many-attempts');
  assert.equal(otpUsable({ ...base, expires_at: new Date(now - 1).toISOString() }, now).reason, 'expired');
});
