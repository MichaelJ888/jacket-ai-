import { getSupabaseAdmin } from './integrations.ts';

// Hindsight Memory Engine: Hybrid Cloud implementation.
// 1. External Mode: If HINDSIGHT_URL is set, connects to external Hindsight API (vectorize-io/hindsight).
// 2. Free-Tier Cloud Mode (Default): Uses Supabase public.agent_memory_events directly. Zero extra servers,
//    zero cost, 100% cloud-native on Vercel + Supabase Free Tier.

const BANK = process.env.HINDSIGHT_BANK || 'mjic';
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'what', 'when',
  'where', 'which', 'about', 'please', 'does', 'will', 'your', 'their', 'there',
  'po', 'ano', 'mga', 'para', 'nang', 'yung', 'iyon', 'dito', 'kami', 'natin'
]);

export interface RetainContext {
  scope?: 'note' | 'decision' | 'issue' | 'attempt' | 'fix';
  location?: string;
  status?: string;
  tags?: string[];
}

function externalConfig() {
  const base = process.env.HINDSIGHT_URL?.replace(/\/+$/, '');
  if (!base) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.HINDSIGHT_API_KEY) headers.Authorization = `Bearer ${process.env.HINDSIGHT_API_KEY}`;
  return { base, headers };
}

export function hindsightEnabled(): boolean {
  return true; // Always enabled: runs native Supabase memory on free tier, or external if configured
}

export async function hindsightRetain(content: string, context?: string | RetainContext): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const ctx: RetainContext = typeof context === 'string'
    ? { scope: 'note', location: context }
    : (context || { scope: 'note' });

  let savedExternally = false;
  const ext = externalConfig();
  if (ext) {
    try {
      const res = await fetch(`${ext.base}/v1/default/banks/${encodeURIComponent(BANK)}/memories`, {
        method: 'POST',
        headers: ext.headers,
        body: JSON.stringify({ items: [{ content: trimmed.slice(0, 8000), context: ctx }] }),
        signal: AbortSignal.timeout(6000),
      });
      savedExternally = res.ok;
    } catch {
      savedExternally = false;
    }
  }

  // Always persist into cloud Supabase agent_memory_events for 100% reliable free-tier retention
  const supabase = getSupabaseAdmin();
  if (!supabase) return savedExternally;

  const scope = ctx.scope && ['note', 'decision', 'issue', 'attempt', 'fix'].includes(ctx.scope)
    ? ctx.scope
    : 'note';

  const { error } = await supabase.from('agent_memory_events').insert({
    scope,
    summary: trimmed.slice(0, 4000),
    location: ctx.location?.slice(0, 500) || null,
    status: ctx.status?.slice(0, 100) || null,
    project: 'jacket-ai',
  });

  return !error || savedExternally;
}

export async function hindsightRecall(query: string, options?: { limit?: number; scope?: string }): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(options?.limit ?? 5, 20));

  // 1. Try external Hindsight if configured
  const ext = externalConfig();
  if (ext) {
    try {
      const res = await fetch(`${ext.base}/v1/default/banks/${encodeURIComponent(BANK)}/memories/recall`, {
        method: 'POST',
        headers: ext.headers,
        body: JSON.stringify({ query: q.slice(0, 1000) }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.results || []).map((r: { text?: string; content?: string }) => r.text || r.content).filter(Boolean) as string[];
        if (results.length) return results.slice(0, limit);
      }
    } catch {
      // Fallback to native Supabase memory
    }
  }

  // 2. Native Supabase Memory Recall
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const tokens = q
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

  let dbQuery = supabase
    .from('agent_memory_events')
    .select('id, scope, summary, location, status, created_at')
    .eq('project', 'jacket-ai')
    .order('created_at', { ascending: false })
    .limit(60);

  if (options?.scope) {
    dbQuery = dbQuery.eq('scope', options.scope);
  }

  const { data: rows, error } = await dbQuery;
  if (error || !rows || !rows.length) return [];

  // Relevance ranking
  const scored = rows.map((row) => {
    const text = `${row.summary} ${row.location || ''} ${row.scope}`.toLowerCase();
    let score = 0;

    // Exact phrase match
    if (text.includes(q.toLowerCase())) score += 10;

    // Keyword matches
    for (const token of tokens) {
      if (text.includes(token)) score += 2;
    }

    // Weight key scopes (decisions and fixes are high-value operational memories)
    if (row.scope === 'decision') score += 3;
    if (row.scope === 'fix') score += 2;

    return { row, score };
  });

  const matched = scored
    .filter((item) => (tokens.length ? item.score > 2 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => `[${item.row.scope}] ${item.row.summary}`);

  return matched;
}

// Synthesizes active decisions and rules into a high-level mental model for the AI
export async function hindsightMentalModels(limit = 10): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data: decisions } = await supabase
    .from('agent_memory_events')
    .select('summary')
    .eq('project', 'jacket-ai')
    .eq('scope', 'decision')
    .is('supersedes', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (decisions || []).map((d) => d.summary).filter(Boolean);
}
