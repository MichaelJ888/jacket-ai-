import { getSupabaseAdmin } from './integrations';

// Capabilities MJIC wants to keep improving. Each search is a GitHub query; add more rows to widen the scan.
export const SCOUT_NEEDS = [
  { purpose: 'embroidery digitizing / stitch file formats', query: 'embroidery' },
  { purpose: 'PDF invoice / quotation generation', query: 'invoice pdf' },
  { purpose: 'ERP / inventory for apparel manufacturing', query: 'erp inventory' },
  { purpose: 'AI sales chatbot / CRM', query: 'crm chatbot' },
  { purpose: 'social media auto-posting / scheduling', query: 'social media scheduler' },
  { purpose: 'receipt / payment screenshot fraud detection', query: 'receipt fraud' },
  { purpose: 'garment mockup / design generation', query: 'apparel mockup' },
];

const PERMISSIVE = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'Zlib', 'Unlicense', '0BSD']);

type GhRepo = { html_url: string; stargazers_count: number; pushed_at: string; archived: boolean; fork: boolean; description: string | null; license: { spdx_id?: string } | null };

// Finds new, active, permissively-licensed repos and shortlists them. It only records metadata: nothing is cloned or executed.
export async function runScout(maxPerNeed = 3) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { added: [] as string[], failures: [] as string[], error: 'Supabase is not configured' };
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'mjic-improvement-scout' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const added: string[] = [];
  const failures: string[] = [];
  for (const need of SCOUT_NEEDS) {
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${need.query} pushed:>${since} stars:>50`)}&sort=stars&order=desc&per_page=8`;
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) { failures.push(need.purpose + ': GitHub ' + response.status); continue; }
      const items = ((await response.json()) as { items?: GhRepo[] }).items || [];
      let kept = 0;
      for (const repo of items) {
        if (kept >= maxPerNeed) break;
        if (repo.archived || repo.fork) continue;
        const license = repo.license?.spdx_id || 'UNKNOWN';
        const status = PERMISSIVE.has(license) ? 'candidate' : 'reference-only';
        const { data: exists } = await supabase.from('repo_candidates').select('id').eq('url', repo.html_url).maybeSingle();
        kept += 1;
        if (exists) continue;
        await supabase.from('repo_candidates').insert({ url: repo.html_url, purpose: need.purpose, license, stars: repo.stargazers_count, last_push: repo.pushed_at, status, notes: (repo.description || '').slice(0, 300) });
        if (status === 'candidate') added.push(`${repo.html_url} (${license}, ${repo.stargazers_count}★) - ${need.purpose}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2500)); // stay under the unauthenticated search rate limit
    } catch (error) {
      console.error('Scout query failed:', need.query, error instanceof Error ? error.message : error);
    }
  }
  return { added, failures, error: null };
}
