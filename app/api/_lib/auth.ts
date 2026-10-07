// Shared bearer-token guard for admin/cron routes. Fails CLOSED when CRON_SECRET is unset.
export function isCronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

// Admin UI/API guard: accepts ADMIN_PASSWORD (preferred) or CRON_SECRET as a bearer token.
export function isAdminAuthorized(req: Request) {
  const header = req.headers.get('authorization') || '';
  const tokens = [process.env.ADMIN_PASSWORD, process.env.CRON_SECRET].filter((value): value is string => Boolean(value));
  return tokens.some((token) => header === `Bearer ${token}`);
}
