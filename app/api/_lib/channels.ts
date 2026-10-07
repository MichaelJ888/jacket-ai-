import type { Channel } from './crm';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 10000;

export type SendResult = { ok: boolean; reason?: string };

function chunk(text: string, size = 1900) {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const cut = Math.max(rest.lastIndexOf('\n', size), rest.lastIndexOf(' ', size));
    const at = cut > size / 2 ? cut : size;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function graphPost(path: string, body: Record<string, unknown>, token: string): Promise<{ ok: boolean; data: Record<string, unknown>; reason?: string }> {
  try {
    const response = await fetch(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = (data.error as { message?: string } | undefined)?.message || `HTTP ${response.status}`;
      return { ok: false, data, reason: message };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, data: {}, reason: error instanceof Error ? error.message : 'request failed' };
  }
}

export function publicBaseUrl() {
  return process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://jacket-ai.vercel.app');
}

export async function sendChannelMessage(
  channel: Channel,
  externalId: string,
  text: string,
  options: { images?: string[]; commentId?: string } = {},
): Promise<SendResult> {
  if (channel === 'manychat' || channel === 'website') return { ok: true, reason: 'delivered inline by the caller' };

  if (channel === 'facebook' || channel === 'instagram') {
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return { ok: false, reason: 'META_PAGE_ACCESS_TOKEN is not set' };
    // A comment id is only valid for the first private reply; afterwards use the user id.
    const recipient = options.commentId ? { comment_id: options.commentId } : { id: externalId };
    const parts = chunk(text);
    for (let index = 0; index < parts.length; index += 1) {
      const result = await graphPost('/me/messages', {
        recipient: index === 0 ? recipient : { id: externalId },
        messaging_type: 'RESPONSE',
        message: { text: parts[index] },
      }, token);
      if (!result.ok) return { ok: false, reason: result.reason };
      if (index === 0 && options.commentId && typeof result.data.recipient_id === 'string') externalId = result.data.recipient_id;
    }
    for (const image of options.images || []) {
      await graphPost('/me/messages', {
        recipient: { id: externalId },
        messaging_type: 'RESPONSE',
        message: { attachment: { type: 'image', payload: { url: image, is_reusable: true } } },
      }, token);
    }
    return { ok: true };
  }

  if (channel === 'whatsapp') {
    const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false, reason: 'WhatsApp credentials are not set' };
    for (const part of chunk(text, 3500)) {
      const result = await graphPost(`/${phoneId}/messages`, { messaging_product: 'whatsapp', to: externalId, type: 'text', text: { body: part } }, token);
      if (!result.ok) return { ok: false, reason: result.reason };
    }
    return { ok: true };
  }

  if (channel === 'email') {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    if (!key || !from) return { ok: false, reason: 'RESEND_API_KEY / RESEND_FROM are not set' };
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ from, to: [externalId], subject: 'MJIC - Your custom jacket inquiry', text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok ? { ok: true } : { ok: false, reason: `Resend HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'request failed' };
    }
  }

  return { ok: false, reason: `Unsupported channel ${channel}` };
}

// Public comment reply under a post (FB: /{id}/comments, IG: /{id}/replies).
export async function replyToComment(platform: 'facebook' | 'instagram', commentId: string, text: string): Promise<SendResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return { ok: false, reason: 'META_PAGE_ACCESS_TOKEN is not set' };
  const path = platform === 'facebook' ? `/${commentId}/comments` : `/${commentId}/replies`;
  const result = await graphPost(path, { message: text }, token);
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export { graphPost, GRAPH };
