type ChatMessage = {
  role?: unknown;
  content?: unknown;
  parts?: unknown;
};

const QUOTE_REQUEST = /\b(?:quote|quotation|estimate|pricing|price|cost|deposit|total)\b/i;
const QUANTITY = /\b\d+\s*(?:pcs?|pieces?|units?|jackets?|uniforms?|shirts?|hoodies?|vests?|apparel)\b/i;
const GARMENT_ORDER = /\b(?:i|we)\s+(?:need|want|would like)|\blooking for\b|\border(?:ing)?\b/i;
const GARMENTS = /\b(?:jackets?|uniforms?|shirts?|hoodies?|vests?|apparel|garments?)\b/i;
const SPECIFICATION = /\b(?:embroider(?:y|ed)?|logo|fabric|material|colors?|sizes?)\b/i;
const QUOTE_CONTEXT = /\b(?:quote|quotation|pricing|price|how many|quantity|pcs|pieces|budget)\b/i;

function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;

  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is { type: 'text'; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join(' ');
}

export function shouldUseQuoteModel(input: unknown): boolean {
  if (!Array.isArray(input)) return false;

  const messages = input.filter(
    (message): message is ChatMessage =>
      typeof message === 'object' && message !== null && 'role' in message,
  );
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user');
  if (latestUserIndex < 0) return false;

  const latestUserMessage = messageText(messages[latestUserIndex]);
  if (
    QUOTE_REQUEST.test(latestUserMessage) ||
    QUANTITY.test(latestUserMessage) ||
    (GARMENT_ORDER.test(latestUserMessage) && GARMENTS.test(latestUserMessage))
  ) {
    return true;
  }

  if (!SPECIFICATION.test(latestUserMessage)) return false;

  return messages
    .slice(Math.max(0, latestUserIndex - 4), latestUserIndex)
    .some((message) => QUOTE_CONTEXT.test(messageText(message)));
}
