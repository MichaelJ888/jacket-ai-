// Shared bearer-token guard for admin/cron routes. Fails CLOSED when CRON_SECRET is unset.
export function isCronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
