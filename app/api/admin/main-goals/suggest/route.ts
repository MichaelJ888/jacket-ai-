import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../../_lib/auth';
import { withModelFallback } from '../../../_lib/llm-pool';
import { cleanText, parseSuggestedSteps, MAX_TITLE_LENGTH } from '../../../../admin/main-goals-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SYSTEM_PROMPT = `You plan work for MJIC, a Philippine uniform, embroidery, and corporate giveaway business.
Break the CEO's goal into 3 to 5 clear, actionable, sequential milestones.
Each milestone is one short imperative sentence in English, at most 14 words.
Return ONLY a JSON array of strings, with no commentary.`;

// Body { title } -> { steps: string[] }. The CEO reviews and edits the steps; nothing is saved here.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const title = cleanText(body.title, MAX_TITLE_LENGTH);
  if (title.length < 3) return NextResponse.json({ error: 'Goal title must be at least 3 characters' }, { status: 400 });

  try {
    const result = await withModelFallback({ tier: 'strong', budgetMs: 25_000, attemptMs: 12_000 }, (model, attemptMs) =>
      generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: `Goal: ${title}`,
        maxOutputTokens: 400,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(attemptMs),
      }),
    );
    const steps = parseSuggestedSteps(result.text);
    if (steps.length === 0) {
      return NextResponse.json({ error: 'The AI returned no usable steps. Add them manually.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, steps }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'AI step generator is unavailable right now. Add the steps manually.' }, { status: 503 });
  }
}
