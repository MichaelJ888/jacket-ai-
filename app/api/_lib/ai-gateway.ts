export const AI_GATEWAY_BILLING_MESSAGE =
  'Vercel AI Gateway needs billing attention (credit card or credits). Add a payment method or credits at https://vercel.com/dashboard/ai-gateway, then retry. The rest of the site is unaffected.';

const BILLING_PATTERN = /credit card|billing|payment required|insufficient (credit|funds|balance)|out of credits|spend limit|quota exceeded/i;

// Duck-typed so this module stays free of the `ai` SDK import and can run under node --test.
export function isAiGatewayBillingFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return BILLING_PATTERN.test(String(error ?? ''));
  const candidate = error as { statusCode?: unknown; status?: unknown; message?: unknown; responseBody?: unknown };
  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : typeof candidate.status === 'number' ? candidate.status : null;
  if (status === 402) return true;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const body = typeof candidate.responseBody === 'string' ? candidate.responseBody : '';
  return BILLING_PATTERN.test(message) || BILLING_PATTERN.test(body);
}

// Structured warning for log drains; never includes API keys or request bodies.
export function logAiGatewayBilling(context: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 300) : String(error ?? '').slice(0, 300);
  console.warn(JSON.stringify({ level: 'warn', source: 'ai-gateway', code: 'ai_gateway_billing', context, message, action: AI_GATEWAY_BILLING_MESSAGE }));
}
