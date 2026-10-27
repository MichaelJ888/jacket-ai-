// Dynamic-workflow swarm engine (clone of Claude "dynamic workflows"): the PLAN LIVES IN CODE, not in a model context.
//   lead splits goal -> workers fan out (clean context each, bounded concurrency) -> skeptic verifies each result
//   -> failed items get one revision -> merger assembles the final report.
// Pure + provider-agnostic: callers inject `runner`. State is returned and can be passed back to resume
// (completed agents are never re-run), which is how a run survives Vercel's per-request time limit.

export const HARD_MAX_AGENTS = 1000;
export const DEFAULT_MAX_AGENTS = 24;
export const CEO_SWARM_MAX_AGENTS = 100;
export const DEFAULT_CONCURRENCY = 16;
const RESULT_CAP = 4000;

export type AgentRole = 'lead' | 'worker' | 'skeptic' | 'merger';
export type AgentCall = { role: AgentRole; prompt: string; tier: 'cheap' | 'strong' };
export type AgentRunner = (call: AgentCall) => Promise<string>;

export interface SwarmState {
  goal: string;
  subtasks: Array<{ id: string; task: string }> | null;
  results: Record<string, string>;
  verdicts: Record<string, { ok: boolean; note: string }>;
  revised: Record<string, boolean>;
  failures: Record<string, string>;
  agentsUsed: number;
  report: string | null;
}

export interface SwarmOptions {
  goal: string;
  context?: string;
  runner: AgentRunner;
  maxAgents?: number;
  concurrency?: number;
  verify?: boolean;
  deadlineMs?: number; // wall-clock budget for this invocation; unfinished work is left for the next resume
  state?: SwarmState;
  now?: () => number;
}

export interface SwarmResult {
  status: 'complete' | 'partial';
  state: SwarmState;
}

export function newState(goal: string): SwarmState {
  return { goal, subtasks: null, results: {}, verdicts: {}, revised: {}, failures: {}, agentsUsed: 0, report: null };
}

export function clampAgents(requested?: number, max = HARD_MAX_AGENTS) {
  const n = Number.isFinite(requested) ? Math.floor(requested as number) : DEFAULT_MAX_AGENTS;
  const ceiling = Math.max(3, Math.min(HARD_MAX_AGENTS, Math.floor(max)));
  return Math.max(3, Math.min(ceiling, n));
}

export function parseSubtasks(raw: string, limit: number): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  let items: unknown[] = [];
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }
  if (!items.length) {
    items = raw.split('\n').map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 3);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = (typeof item === 'string' ? item : JSON.stringify(item)).trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseVerdict(raw: string): { ok: boolean; note: string } {
  const match = raw.match(/VERDICT:\s*(PASS|FAIL)\b[\s:.-]*([\s\S]*)/i);
  if (!match) return { ok: false, note: 'Skeptic gave no verdict' };
  return { ok: match[1].toUpperCase() === 'PASS', note: match[2].trim().slice(0, 500) };
}

// Runs fn over items with at most `limit` in flight; stops STARTING new items once the deadline passes.
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, expired: () => boolean) {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !expired()) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

const cap = (text: string) => (text.length > RESULT_CAP ? `${text.slice(0, RESULT_CAP)}…[truncated]` : text);

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const state: SwarmState = opts.state ? structuredClone(opts.state) : newState(opts.goal);
  try {
    return await runSwarmInner(opts, state);
  } catch (err) {
    // Carry the progress made so far so the caller can persist it and retry only the failed stage.
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { swarmState: state });
  }
}

async function runSwarmInner(opts: SwarmOptions, state: SwarmState): Promise<SwarmResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const expired = () => opts.deadlineMs !== undefined && now() - started >= opts.deadlineMs;
  const maxAgents = clampAgents(opts.maxAgents);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 64));
  const verify = opts.verify !== false;
  const budgetLeft = () => maxAgents - state.agentsUsed;
  const call = async (c: AgentCall) => {
    state.agentsUsed += 1;
    try {
      return await opts.runner(c);
    } catch (err) {
      state.agentsUsed -= 1; // a failed call is not billed; do not burn budget on provider hiccups
      throw err;
    }
  };
  const ctx = opts.context ? `\n\nSHARED CONTEXT (read-only):\n${cap(opts.context)}` : '';

  // 1) Lead: split the job. Reserve 1 agent for the merger and (if verifying) one skeptic + possible revision per item.
  if (!state.subtasks) {
    const perItem = verify ? 2 : 1;
    const limit = Math.max(1, Math.floor((maxAgents - 2) / perItem));
    const raw = await call({
      role: 'lead',
      tier: 'strong',
      prompt:
        `You are the lead of an agent team. Split this job into at most ${limit} INDEPENDENT, self-contained subtasks ` +
        `that can be done in parallel by workers who see nothing but their own subtask text. ` +
        `Reply with ONLY a JSON array of strings.\n\nJOB: ${state.goal}${ctx}`,
    });
    const parts = parseSubtasks(raw, limit);
    state.subtasks = (parts.length ? parts : [state.goal]).map((task, i) => ({ id: `t${i + 1}`, task }));
  }
  const subtasks = state.subtasks;

  const workerPrompt = (task: string, critique?: string) =>
    `You are one worker on a larger job. Complete ONLY this subtask and return the finished result as plain text.\n` +
    `OVERALL JOB (for orientation): ${state.goal}\nYOUR SUBTASK: ${task}${ctx}` +
    (critique ? `\n\nA reviewer rejected your previous answer: ${critique}\nFix it.` : '');

  // 2) Fan out workers.
  const pending = subtasks.filter((s) => !(s.id in state.results));
  await pool(pending, concurrency, async (s) => {
    if (budgetLeft() < 2) return; // keep room for the merger
    try {
      state.results[s.id] = cap(await call({ role: 'worker', tier: 'cheap', prompt: workerPrompt(s.task) }));
      delete state.failures[s.id];
    } catch (err) {
      state.failures[s.id] = err instanceof Error ? err.message.slice(0, 200) : 'worker failed';
    }
  }, expired);

  // 3) Adversarial verification, enforced by control flow, with one revision for rejected items.
  if (verify) {
    const toCheck = subtasks.filter((s) => s.id in state.results && !(s.id in state.verdicts));
    await pool(toCheck, concurrency, async (s) => {
      if (budgetLeft() < 2) return;
      try {
        let verdict = parseVerdict(await call({ role: 'skeptic', tier: 'strong', prompt: skepticPrompt(s.task, state.results[s.id]) }));
        if (!verdict.ok && !state.revised[s.id] && budgetLeft() >= 4) {
          state.revised[s.id] = true;
          state.results[s.id] = cap(await call({ role: 'worker', tier: 'cheap', prompt: workerPrompt(s.task, verdict.note) }));
          verdict = parseVerdict(await call({ role: 'skeptic', tier: 'strong', prompt: skepticPrompt(s.task, state.results[s.id]) }));
        }
        state.verdicts[s.id] = verdict;
      } catch (err) {
        state.failures[s.id] = err instanceof Error ? err.message.slice(0, 200) : 'skeptic failed';
      }
    }, expired);
  }

  const settled = subtasks.every((s) => s.id in state.results && (!verify || s.id in state.verdicts));
  const exhausted = budgetLeft() < 2;
  if (!settled && !exhausted) return { status: 'partial', state };

  // 4) Merge (also reached when the agent budget is exhausted: report what we have, flagged).
  if (!state.report) {
    const body = subtasks
      .map((s) => {
        const r = state.results[s.id];
        const v = state.verdicts[s.id];
        const flag = !r ? 'MISSING' : verify ? (v?.ok ? 'VERIFIED' : `UNVERIFIED${v ? `: ${v.note}` : ''}`) : 'UNREVIEWED';
        return `### ${s.id} [${flag}]\nSubtask: ${s.task}\n${r ?? state.failures[s.id] ?? '(no result)'}`;
      })
      .join('\n\n');
    state.report = await call({
      role: 'merger',
      tier: 'strong',
      prompt:
        `Combine the worker results below into one final answer for the job. De-duplicate, resolve conflicts, and ` +
        `clearly mark anything UNVERIFIED or MISSING rather than presenting it as fact.\n\nJOB: ${state.goal}\n\n${body}`,
    });
  }
  return { status: 'complete', state };
}

function skepticPrompt(task: string, result: string) {
  return (
    `You are a skeptical reviewer. Try to find errors, unsupported claims, or missing parts in this answer.\n` +
    `SUBTASK: ${task}\nANSWER: ${result}\n\n` +
    `Reply on the first line with exactly "VERDICT: PASS" or "VERDICT: FAIL - <one-sentence reason>".`
  );
}
