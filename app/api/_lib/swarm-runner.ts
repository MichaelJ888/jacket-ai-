import { generateText } from 'ai';
import type { AgentRunner } from './swarm';
import { withModelFallback } from './llm-pool';

// Worker fan-out uses the rotating cheap pool; lead/skeptic/merger use the strong models. Falls back across the whole pool.
export function createPoolRunner(): AgentRunner {
  return ({ prompt, tier }) =>
    withModelFallback({ tier }, async (model, attemptMs) => {
      const { text } = await generateText({ model, prompt, maxRetries: 0, abortSignal: AbortSignal.timeout(attemptMs) });
      if (!text.trim()) throw new Error('empty model response');
      return text.trim();
    });
}
