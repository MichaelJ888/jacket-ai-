export type QaExample = { prompt?: string; reply: string };

const PROMPT_RE = /^\s*(?:q|question|client|customer|buyer|supplier|employee|staff|them)\s*[:\-–]\s*/i;
const REPLY_RE = /^\s*(?:a|answer|reply|me|ceo|boss|owner|mjic|michael|response)\s*[:\-–]\s*/i;

// Turns pasted/extracted chat text into prompt/reply pairs. Supports "Client: ... / Me: ..." and "Q: ... / A: ..."
// transcripts; text with no markers falls back to one example per blank-line-separated block.
export function parseQaText(text: string): QaExample[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const hasMarkers = lines.some((line) => PROMPT_RE.test(line)) && lines.some((line) => REPLY_RE.test(line));
  if (!hasMarkers) {
    return text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).map((reply) => ({ reply }));
  }
  const out: QaExample[] = [];
  let prompt = '';
  let reply: string[] | null = null;
  const flush = () => {
    if (reply && reply.join(' ').trim()) out.push({ prompt: prompt || undefined, reply: reply.join('\n').trim() });
    reply = null;
  };
  for (const line of lines) {
    if (PROMPT_RE.test(line)) {
      flush();
      prompt = line.replace(PROMPT_RE, '').trim();
    } else if (REPLY_RE.test(line)) {
      flush();
      reply = [line.replace(REPLY_RE, '').trim()];
    } else if (line.trim()) {
      if (reply) reply.push(line.trim());
      else if (prompt) prompt += ` ${line.trim()}`;
    }
  }
  flush();
  return out;
}
