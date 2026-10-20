import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

// Free-tier quota pool. Gemini quotas are PER MODEL, so rotating across models multiplies free throughput;
// optional OpenAI-compatible free providers (Groq / Cerebras / OpenRouter) join the pool when their key is set.
// Failing candidates are put on a cooldown and skipped; no paid provider is ever used here.

export type Tier = 'cheap' | 'strong';
export interface Candidate {
  id: string;
  tools: boolean; // supports function calling
  tiers: Tier[];
  make: () => LanguageModel;
}

export type FailureKind = 'quota' | 'overloaded' | 'missing' | 'timeout' | 'other';

const COOLDOWN_MS: Record<FailureKind, number> = {
  quota: 10 * 60_000,
  overloaded: 45_000,
  missing: 24 * 3600_000,
  timeout: 30_000,
  other: 20_000,
};

export function classifyFailure(err: unknown): FailureKind {
  const e = err as { statusCode?: number; message?: string; name?: string; lastError?: unknown };
  const inner = e?.lastError ? classifyFailure(e.lastError) : null;
  if (inner && inner !== 'other') return inner;
  const text = `${e?.message ?? ''} ${e?.name ?? ''}`.toLowerCase();
  const status = e?.statusCode;
  if (status === 429 || /quota|resource_exhausted|rate.?limit|too many requests/.test(text)) return 'quota';
  if (status === 404 || /not found|not_found|does not exist/.test(text)) return 'missing';
  if (status === 503 || status === 500 || /high demand|unavailable|overloaded|internal/.test(text)) return 'overloaded';
  if (/abort|timeout|timed out/.test(text)) return 'timeout';
  return 'other';
}

const split = (value: string | undefined, fallback: string[]) => {
  const items = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};

export function buildCandidates(env: Record<string, string | undefined> = process.env): Candidate[] {
  const out: Candidate[] = [];
  if (env.GEMINI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
    const strong = split(env.GEMINI_STRONG_MODELS, ['gemini-3.6-flash', 'gemini-3.7-flash']);
    const cheap = split(env.GEMINI_CHEAP_MODELS, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    const noTools = split(env.GEMINI_TEXT_ONLY_MODELS, ['gemma-4-26b-a4b-it']);
    for (const m of strong) out.push({ id: `gemini:${m}`, tools: true, tiers: ['strong', 'cheap'], make: () => google(m) });
    for (const m of cheap) out.push({ id: `gemini:${m}`, tools: true, tiers: ['cheap', 'strong'], make: () => google(m) });
    for (const m of noTools) out.push({ id: `gemini:${m}`, tools: false, tiers: ['cheap'], make: () => google(m) });
  }
  const compat: Array<[string, string | undefined, string, string]> = [
    ['groq', env.GROQ_API_KEY, 'https://api.groq.com/openai/v1', env.GROQ_MODEL || 'llama-3.3-70b-versatile'],
    ['cerebras', env.CEREBRAS_API_KEY, 'https://api.cerebras.ai/v1', env.CEREBRAS_MODEL || 'gpt-oss-120b'],
    ['openrouter', env.OPENROUTER_API_KEY, 'https://openrouter.ai/api/v1', env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free'],
        ['mistral', env.MISTRAL_API_KEY, 'https://api.mistral.ai/v1', env.MISTRAL_MODEL || 'mistral-small-latest'],
        [
          'cloudflare',
          env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID ? env.CLOUDFLARE_API_TOKEN : undefined,
          `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
          env.CLOUDFLARE_MODEL || '@cf/openai/gpt-oss-120b',
        ],
      ];
  for (const [name, apiKey, baseURL, model] of compat) {
    if (!apiKey) continue;
    const provider = createOpenAI({ apiKey, baseURL });
    out.push({ id: `${name}:${model}`, tools: true, tiers: ['cheap', 'strong'], make: () => provider.chat(model) });
  }
  return out;
}

const cooldownUntil = new Map<string, number>();
let rotation = 0;
let cached: Candidate[] | null = null;
const pool = () => (cached ??= buildCandidates());

export function resetPoolForTests(candidates?: Candidate[]) {
  cooldownUntil.clear();
  rotation = 0;
  cached = candidates ?? null;
}

export function markFailure(id: string, err: unknown, now = Date.now()) {
  cooldownUntil.set(id, now + COOLDOWN_MS[classifyFailure(err)]);
}

// Healthy candidates for a tier. Strong keeps declared order (best first); cheap rotates to spread load across quotas.
export function orderedCandidates(tier: Tier, needTools: boolean, now = Date.now()): Candidate[] {
  const eligible = pool().filter((c) => c.tiers.includes(tier) && (!needTools || c.tools));
  const healthy = eligible.filter((c) => (cooldownUntil.get(c.id) ?? 0) <= now);
  const base = healthy.length ? healthy : [...eligible].sort((a, b) => (cooldownUntil.get(a.id) ?? 0) - (cooldownUntil.get(b.id) ?? 0)).slice(0, 1);
  if (tier === 'cheap' && base.length > 1) {
    const shift = rotation++ % base.length;
    return [...base.slice(shift), ...base.slice(0, shift)];
  }
  return base;
}

export function pickModel(tier: Tier = 'strong', needTools = true): { id: string; model: LanguageModel } | null {
  const c = orderedCandidates(tier, needTools)[0];
  return c ? { id: c.id, model: c.make() } : null;
}

export async function withModelFallback<T>(
  opts: { tier: Tier; tools?: boolean; budgetMs?: number; attemptMs?: number },
  run: (model: LanguageModel, attemptMs: number) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 32_000;
  const attemptMs = opts.attemptMs ?? 20_000;
  const order = orderedCandidates(opts.tier, opts.tools ?? false);
  if (!order.length) throw new Error('No LLM provider configured (set GEMINI_API_KEY)');
  let lastError: unknown;
  for (const candidate of order) {
    const left = budget - (Date.now() - started);
    if (left < 3000) break;
    try {
      return await run(candidate.make(), Math.min(attemptMs, left));
    } catch (err) {
      lastError = err;
      markFailure(candidate.id, err);
    }
  }
  throw lastError ?? new Error('All LLM candidates exhausted');
}
