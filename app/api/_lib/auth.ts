import { createHash, timingSafeEqual } from 'node:crypto';

// Scoped bearer tokens. Every guard fails CLOSED when none of its tokens are configured.
//   cron   : CRON_SECRET (sent automatically by Vercel native crons) and SCHEDULER_TOKEN (GitHub Actions scheduler)
//   admin  : ADMIN_TOKEN or ADMIN_PASSWORD (admin UI, CEO/CRM/ops writes)
//   memory : MEMORY_TOKEN (falls back to the admin tokens)
// CRON_SECRET is NOT accepted for admin/memory access, so a leaked scheduler token cannot reach admin routes.

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function bearerMatches(req: Request, tokens: Array<string | undefined>) {
  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!presented) return false;
  const presentedDigest = digest(presented);
  let ok = false;
  for (const token of tokens) {
    if (token && timingSafeEqual(presentedDigest, digest(token))) ok = true;
  }
  return ok;
}

const adminTokens = () => [process.env.ADMIN_TOKEN, process.env.ADMIN_PASSWORD];

export function isCronAuthorized(req: Request) {
  return bearerMatches(req, [process.env.CRON_SECRET, process.env.SCHEDULER_TOKEN]);
}

export function isAdminAuthorized(req: Request) {
  return bearerMatches(req, adminTokens());
}

export function isMemoryAuthorized(req: Request) {
  return bearerMatches(req, [process.env.MEMORY_TOKEN, ...adminTokens()]);
}
