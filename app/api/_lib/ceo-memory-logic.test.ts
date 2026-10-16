import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPACT_AT, KEEP_RECENT, SUMMARY_MAX_CHARS, buildSummaryPrompt, clampSummary, selectMessagesToCompact, type ChatRow } from './ceo-memory-logic.ts';

const rows = (n: number): ChatRow[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, created_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z` }));

test('no compaction below the threshold', () => {
  assert.deepEqual(selectMessagesToCompact(rows(COMPACT_AT - 1)), { toCompact: [], upTo: null });
});

test('compaction keeps the newest messages and reports the cut-off', () => {
  const all = rows(COMPACT_AT);
  const { toCompact, upTo } = selectMessagesToCompact(all);
  assert.equal(toCompact.length, COMPACT_AT - KEEP_RECENT);
  assert.equal(upTo, all[COMPACT_AT - KEEP_RECENT - 1].created_at);
});

test('summary prompt includes prior memory and new messages; output is clamped', () => {
  const prompt = buildSummaryPrompt('- supplier X gives 5% off', rows(2));
  assert.match(prompt, /supplier X/);
  assert.match(prompt, /CEO: m0/);
  assert.match(prompt, /AI: m1/);
  assert.equal(clampSummary('a'.repeat(SUMMARY_MAX_CHARS + 500)).length, SUMMARY_MAX_CHARS);
});
