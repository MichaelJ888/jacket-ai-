// Self-heal for Vercel Deployment Protection drift (Option A: only previews protected).
// Needs VERCEL_TOKEN on the Vercel project; without it this reports "unconfigured" and does nothing.
const API = 'https://api.vercel.com';

export type ProtectionResult = { status: 'ok' | 'healed' | 'unconfigured' | 'error'; detail?: string };

function url(path: string) {
  const u = new URL(`${API}${path}`);
  if (process.env.VERCEL_TEAM_ID) u.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  return u;
}

export async function ensureProductionPublic(): Promise<ProtectionResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { status: 'unconfigured', detail: 'VERCEL_TOKEN not set' };
  const project = process.env.VERCEL_PROJECT_ID || 'jacket-ai';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const res = await fetch(url(`/v9/projects/${project}`), { headers, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) return { status: 'error', detail: `GET project -> ${res.status}` };
    const data = (await res.json()) as { ssoProtection?: { deploymentType?: string } | null };
    const current = data.ssoProtection?.deploymentType ?? null;
    if (current === null || current === 'preview') return { status: 'ok' };
    const patch = await fetch(url(`/v9/projects/${project}`), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ssoProtection: { deploymentType: 'preview' } }),
      signal: AbortSignal.timeout(15000),
    });
    return patch.ok ? { status: 'healed', detail: `was ${current}` } : { status: 'error', detail: `PATCH project -> ${patch.status}` };
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : 'unknown' };
  }
}
