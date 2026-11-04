export const QA_MAX_BATCH = 200;
export const QA_STATUSES = ['pending', 'approved', 'retired'] as const;
export type QaStatus = (typeof QA_STATUSES)[number];
export type QaPairInput = { question: string; answer: string; status: QaStatus; source: string };

const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// Validates a CEO/website batch. Invalid rows are reported, not silently dropped, so the uploader can fix them.
export function parseQaBatch(body: unknown): { pairs: QaPairInput[]; errors: string[] } {
  const rows = body && typeof body === 'object' && Array.isArray((body as { pairs?: unknown }).pairs)
    ? (body as { pairs: unknown[] }).pairs
    : null;
  if (!rows) return { pairs: [], errors: ['Body must be { "pairs": [...] }.'] };
  if (rows.length === 0) return { pairs: [], errors: ['pairs is empty.'] };
  if (rows.length > QA_MAX_BATCH) return { pairs: [], errors: [`Batch exceeds ${QA_MAX_BATCH} pairs.`] };

  const pairs: QaPairInput[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const question = clean(item.question);
    const answer = clean(item.answer);
    const status = typeof item.status === 'string' ? item.status : 'pending';
    const source = clean(item.source) || 'website';
    if (question.length < 3 || question.length > 500) errors.push(`#${index}: question must be 3-500 chars.`);
    else if (answer.length < 3 || answer.length > 2000) errors.push(`#${index}: answer must be 3-2000 chars.`);
    else if (!(QA_STATUSES as readonly string[]).includes(status)) errors.push(`#${index}: status must be pending, approved or retired.`);
    else if (source.length > 60) errors.push(`#${index}: source must be 60 chars or fewer.`);
    else pairs.push({ question, answer, status: status as QaStatus, source });
  });
  return { pairs, errors };
}
