import { getSupabaseAdmin } from './integrations';

// Fixed-window limiter backed by Postgres (public.rate_limit_hit), so counts are shared across
// serverless instances. Fails OPEN if the database is unreachable so an outage never blocks customers.

export function clientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown').trim().slice(0, 64);
}

export async function checkRateLimit(req: Request, bucket: string, max: number, windowSeconds: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { limited: false, retryAfter: 0 };
  try {
    const { data, error } = await supabase.rpc('rate_limit_hit', { p_key: `${bucket}:${clientIp(req)}`, p_window_seconds: windowSeconds, p_max: max });
    if (error) return { limited: false, retryAfter: 0 };
    const row = Array.isArray(data) ? data[0] : data;
    return { limited: Boolean(row?.limited), retryAfter: Number(row?.retry_after || windowSeconds) };
  } catch {
    return { limited: false, retryAfter: 0 };
  }
}

// Returns a 429 Response when the caller is over the limit, otherwise null.
export async function rateLimitResponse(req: Request, bucket: string, max: number, windowSeconds: number) {
  const result = await checkRateLimit(req, bucket, max, windowSeconds);
  if (!result.limited) return null;
  return Response.json({ error: 'Too many requests. Please slow down.' }, { status: 429, headers: { 'Retry-After': String(result.retryAfter) } });
}
