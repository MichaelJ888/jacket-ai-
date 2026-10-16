// Pure helpers for the CEO chat's rolling-summary memory. No imports so they are unit-testable.

export const KEEP_RECENT = 12;
export const COMPACT_AT = 30;
export const SUMMARY_MAX_CHARS = 1800;

export type ChatRow = { role: 'user' | 'assistant'; content: string; created_at: string };

// Once the un-summarised tail reaches COMPACT_AT messages, everything except the newest KEEP_RECENT is folded into the summary.
export function selectMessagesToCompact(rows: ChatRow[]): { toCompact: ChatRow[]; upTo: string | null } {
  if (rows.length < COMPACT_AT) return { toCompact: [], upTo: null };
  const toCompact = rows.slice(0, rows.length - KEEP_RECENT);
  return { toCompact, upTo: toCompact[toCompact.length - 1]?.created_at ?? null };
}

export function buildSummaryPrompt(previousSummary: string, rows: ChatRow[]) {
  const transcript = rows.map((row) => `${row.role === 'user' ? 'CEO' : 'AI'}: ${row.content.slice(0, 500)}`).join('\n');
  return `Update the running memory of a chat between the CEO of MJIC (a Philippine uniform/embroidery business) and his AI chief-of-staff.
Keep ONLY durable facts: decisions made, instructions and preferences from the CEO, open tasks/follow-ups, names, amounts, deadlines, and unresolved questions. Drop greetings and small talk. Never invent facts. Max ${SUMMARY_MAX_CHARS} characters, plain text, short bullet lines starting with "- ".

Previous memory:
${previousSummary || '(none yet)'}

New messages to fold in:
${transcript}

Output only the updated memory.`;
}

export function clampSummary(text: string) {
  const clean = text.trim();
  return clean.length > SUMMARY_MAX_CHARS ? `${clean.slice(0, SUMMARY_MAX_CHARS - 1)}…` : clean;
}
