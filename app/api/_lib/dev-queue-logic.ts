// Decides whether a CEO Telegram message is a coding job for the VS Code AI chat (queued in dev_tasks)
// or normal business chat for the CEO agent. Pure string logic: zero LLM cost, deterministic.

export type DevRoute =
  | { kind: 'dev'; task: string; explicit: boolean }
  | { kind: 'command'; name: 'ideas' | 'queue' }
  | { kind: 'ceo' };

const EXPLICIT = /^\/?(dev|vscode|code|copilot)\b[:\s-]*/i;
const NOT_DEV = /^\/?(biz|ceo|ask)\b[:\s-]*/i;

// Strong code-work signals; a verb alone ("deploy") is not enough, it must hit a repo/code noun too.
const ACTION = /\b(fix|implement|refactor|add|create|update|deploy|redeploy|commit|push|patch|debug|rewrite|migrate|apply|integrate|upgrade)\b/i;
const CODE_NOUN = /\b(code|bug|route|api|endpoint|schema|table|migration|webhook|cron|component|page|build|lint|typescript|vercel|repo|github|branch|pull request|pr|env var|\.ts|\.tsx|\.mjs|supabase)\b/i;

export function routeCeoMessage(raw: string): DevRoute {
  const text = (raw || '').trim();
  if (/^\/ideas\b/i.test(text)) return { kind: 'command', name: 'ideas' };
  if (/^\/queue\b/i.test(text)) return { kind: 'command', name: 'queue' };
  if (NOT_DEV.test(text)) return { kind: 'ceo' };

  const explicit = text.match(EXPLICIT);
  if (explicit) {
    const task = text.slice(explicit[0].length).trim();
    return task ? { kind: 'dev', task, explicit: true } : { kind: 'ceo' };
  }
  if (text.length >= 20 && ACTION.test(text) && CODE_NOUN.test(text)) return { kind: 'dev', task: text, explicit: false };
  return { kind: 'ceo' };
}
