import { createAnthropic } from '@ai-sdk/anthropic';
import { rateLimitResponse } from '../_lib/rate-limit';
import { isStepCount, streamText } from 'ai';
import { markFailure, pickModel } from '../_lib/llm-pool';
import { INJECTION_GUARD_ADDENDUM, detectPromptInjection, redactSecrets, sanitizeChatMessages } from '../_lib/chat-guard';
import { shouldUseQuoteModel } from '../_lib/chat-model-router';
import { escapeTelegramHtml, recordChatMessage, sendTelegramMessage } from '../_lib/integrations';
import { FIRST_MESSAGE_ADDENDUM, MJIC_SYSTEM_PROMPT } from '../_lib/mjic-prompt';
import { mjicQuoteTool } from '../_lib/sales-tools';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export const maxDuration = 30;

export async function POST(req: Request) {
  const limited = await rateLimitResponse(req, 'chat', 20, 60);
  if (limited) return limited;
  try {
    const body = await req.json();
    const messages = sanitizeChatMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return Response.json({ error: 'A user message is required.' }, { status: 400 });
    }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : crypto.randomUUID();
    const useQuoteModel = shouldUseQuoteModel(messages);

    if (useQuoteModel && !process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'Quote requests require ANTHROPIC_API_KEY to be configured.' }, { status: 503 });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user' && typeof lastMessage.content === 'string' && lastMessage.content) {
      const safeContent = redactSecrets(lastMessage.content);
      const flagged = detectPromptInjection(lastMessage.content);
      await recordChatMessage({ role: 'user', content: safeContent, conversationId });
      void sendTelegramMessage([
        flagged ? '<b>MJIC AI CHAT INQUIRY ⚠️ possible prompt injection</b>' : '<b>MJIC AI CHAT INQUIRY</b>',
        `<b>Conversation:</b> <code>${escapeTelegramHtml(conversationId)}</code>`,
        `<b>Message:</b> ${escapeTelegramHtml(safeContent)}`,
      ].join('\n'));
    }

    const isFirstCustomerMessage = messages.filter((message: { role?: string }) => message?.role === 'user').length <= 1;
    const systemPrompt = `${isFirstCustomerMessage ? `${MJIC_SYSTEM_PROMPT}${FIRST_MESSAGE_ADDENDUM}` : MJIC_SYSTEM_PROMPT}${INJECTION_GUARD_ADDENDUM}`;

    // Cache the (large, mostly static) system prompt on Anthropic's side so repeat
    // requests re-read it from cache instead of paying full input-token price every turn.
    // Ignored harmlessly by other providers (e.g. Gemini) since it's under the "anthropic" key.
    const systemMessage = {
      role: 'system' as const,
      content: systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    };

    const pooled = useQuoteModel ? null : pickModel('strong', true);

    // Cheapest-per-inquiry: Haiku handles the quote tool-call fine at ~1/3 of Sonnet's price.
    // Override with CHAT_QUOTE_MODEL=claude-sonnet-4-5 if quality ever needs it.
    const quoteModelId = process.env.CHAT_QUOTE_MODEL || 'claude-haiku-4-5';
    const result = streamText({
      model: useQuoteModel
        ? anthropic(quoteModelId)
        : pooled
          ? pooled.model
          : anthropic(quoteModelId),
      // Only the last 12 turns are sent: input tokens grow every turn otherwise.
      messages: [systemMessage, ...messages.slice(-12)],
      maxOutputTokens: 600,
      stopWhen: isStepCount(3),
      onError: ({ error }) => {
        if (pooled) markFailure(pooled.id, error); // next customer is routed to a healthy model
      },
      onFinish: async ({ text }) => {
        if (text) await recordChatMessage({ role: 'assistant', content: text, conversationId });
      },
      tools: {
        calculateMJICQuote: mjicQuoteTool,
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Chat API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}