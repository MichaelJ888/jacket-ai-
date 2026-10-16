import { generateText } from 'ai';

import { getSetting, setSetting } from './ceo-control';
import { buildSummaryPrompt, clampSummary, selectMessagesToCompact, type ChatRow } from './ceo-memory-logic';
import { getSupabaseAdmin } from './integrations';
import { withModelFallback } from './llm-pool';

// Rolling summary of the CEO chat: old turns are folded into one short memory so the bot keeps context beyond the last few messages.

const SUMMARY_KEY = 'ceo_chat_summary';
const UPTO_KEY = 'ceo_chat_summary_upto';

export async function getChatSummary() {
  return getSetting(SUMMARY_KEY, '');
}

export async function compactConversationIfNeeded() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const upTo = await getSetting(UPTO_KEY, '1970-01-01T00:00:00Z');
  const { data } = await supabase.from('ceo_conversations').select('role, content, created_at').gt('created_at', upTo).order('created_at', { ascending: true }).limit(200);
  const { toCompact, upTo: newUpTo } = selectMessagesToCompact((data || []) as ChatRow[]);
  if (!toCompact.length || !newUpTo) return;
  try {
    const previous = await getChatSummary();
    const result = await withModelFallback({ tier: 'cheap', budgetMs: 25_000, attemptMs: 15_000 }, (model, attemptMs) =>
      generateText({ model, prompt: buildSummaryPrompt(previous, toCompact), maxRetries: 0, abortSignal: AbortSignal.timeout(attemptMs) }),
    );
    const summary = clampSummary(result.text);
    if (!summary) return;
    await setSetting(SUMMARY_KEY, summary);
    await setSetting(UPTO_KEY, newUpTo);
  } catch (error) {
    console.error('CEO conversation compaction failed:', error);
  }
}
