import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { isStepCount, streamText } from 'ai';
import { escapeTelegramHtml, recordChatMessage, sendTelegramMessage } from '../_lib/integrations';
import { FIRST_MESSAGE_ADDENDUM, MJIC_SYSTEM_PROMPT } from '../_lib/mjic-prompt';
import { mjicQuoteTool } from '../_lib/sales-tools';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : crypto.randomUUID();

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user' && typeof lastMessage.content === 'string' && lastMessage.content) {
      await recordChatMessage({ role: 'user', content: lastMessage.content, conversationId });
      void sendTelegramMessage([
        '<b>MJIC AI CHAT INQUIRY</b>',
        `<b>Conversation:</b> <code>${escapeTelegramHtml(conversationId)}</code>`,
        `<b>Message:</b> ${escapeTelegramHtml(lastMessage.content)}`,
      ].join('\n'));
    }

    const isFirstCustomerMessage = messages.filter((message: { role?: string }) => message?.role === 'user').length <= 1;
    const systemPrompt = isFirstCustomerMessage ? `${MJIC_SYSTEM_PROMPT}${FIRST_MESSAGE_ADDENDUM}` : MJIC_SYSTEM_PROMPT;

    // Cache the (large, mostly static) system prompt on Anthropic's side so repeat
    // requests re-read it from cache instead of paying full input-token price every turn.
    // Ignored harmlessly by other providers (e.g. Gemini) since it's under the "anthropic" key.
    const systemMessage = {
      role: 'system' as const,
      content: systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    };

    const result = streamText({
      model: process.env.GEMINI_API_KEY
        ? google('gemini-3.6-flash')
        : anthropic('claude-sonnet-4-5'),
      messages: [systemMessage, ...messages],
      stopWhen: isStepCount(3),
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