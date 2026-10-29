import { getSupabaseAdmin } from './integrations';
import { MAX_MEDIA_BYTES, isFreshUpdateInsertError, type TelegramMedia } from './telegram-logic';

// Telegram plumbing for the CEO chat: typing indicator, update_id dedupe, and media download.

export async function sendTelegramChatAction(chatId: string, action: 'typing' | 'upload_photo' = 'typing') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Cosmetic only.
  }
}

// Keeps the "typing…" bubble alive (Telegram clears it after ~5s) until stop() is called.
export function startTyping(chatId: string) {
  void sendTelegramChatAction(chatId);
  const timer = setInterval(() => void sendTelegramChatAction(chatId), 4000);
  return () => clearInterval(timer);
}

// Telegram retries slow webhooks. Returns false when this update_id was already processed.
export async function claimTelegramUpdate(updateId: unknown): Promise<boolean> {
  const id = Number(updateId);
  if (!Number.isSafeInteger(id)) return true;
  const supabase = getSupabaseAdmin();
  if (!supabase) return true;
  const { error } = await supabase.from('telegram_updates').insert({ update_id: id });
  if (Math.random() < 0.02) {
    await supabase.from('telegram_updates').delete().lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  }
  return isFreshUpdateInsertError(error);
}

export type TelegramMediaFile = { data: Uint8Array; mediaType: string };

// Retries network errors, 429 and 5xx only. Other 4xx responses are returned so the caller can read Telegram's description.
async function telegramFetch(url: string, timeoutMs: number): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Direct Bot API download: getFile -> file endpoint -> bytes. Returns the concrete failure reason instead of a bare null.
export async function downloadTelegramMedia(media: TelegramMedia): Promise<TelegramMediaFile | { error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { error: 'TELEGRAM_BOT_TOKEN is not set' };
  try {
    const info = await telegramFetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(media.fileId)}`, 8000);
    const meta = (await info.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { file_path?: string; file_size?: number } } | null;
    const filePath = meta?.ok ? meta.result?.file_path : null;
    if (!filePath) return { error: `getFile failed (HTTP ${info.status}): ${meta?.description ?? 'no file_path'}` };
    const size = meta?.result?.file_size ?? media.size ?? 0;
    if (size > MAX_MEDIA_BYTES) return { error: `file too large (${size} bytes)` };

    const file = await telegramFetch(`https://api.telegram.org/file/bot${token}/${filePath}`, 20000);
    if (!file.ok) return { error: `file download failed (HTTP ${file.status})` };
    const data = new Uint8Array(await file.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > MAX_MEDIA_BYTES) return { error: `invalid file size (${data.byteLength} bytes)` };
    return { data, mediaType: media.mediaType };
  } catch (error) {
    return { error: `download error: ${error instanceof Error ? error.message : String(error)}` };
  }
}
