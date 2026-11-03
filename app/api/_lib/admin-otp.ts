// Telegram 2FA for the admin panel. Codes are 6 digits, sha256-hashed at rest,
// single-use, 10-minute expiry, max 5 verify attempts. Fail-safe by design:
// when Telegram is not configured the route reports required=false so the CEO
// can never be locked out by an integration outage.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtp(now = Date.now()): string {
  // randomInt is CSPRNG; `now` kept injectable for tests only.
  void now;
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(`mjic-admin-otp:${code}`).digest('hex');
}

export function otpMatches(code: string, expectedHash: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const presented = Buffer.from(hashOtp(code), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export type OtpRow = { id: string; code_hash: string; expires_at: string; used_at: string | null; attempts: number };

export function otpUsable(row: OtpRow, now = Date.now()): { ok: boolean; reason?: 'expired' | 'used' | 'too-many-attempts' } {
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' };
  if (Date.parse(row.expires_at) <= now) return { ok: false, reason: 'expired' };
  return { ok: true };
}
