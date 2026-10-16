import { fetchWithRetry, getSupabaseAdmin } from './integrations';
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

export async function downloadTelegramMedia(media: TelegramMedia): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const info = await fetchWithRetry(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(media.fileId)}`, { signal: AbortSignal.timeout(8000) });
  const meta = (await info?.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string; file_size?: number } } | null;
  const filePath = meta?.ok ? meta.result?.file_path : null;
  if (!filePath || (meta?.result?.file_size ?? 0) > MAX_MEDIA_BYTES) return null;
  const file = await fetchWithRetry(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(15000) });
  if (!file?.ok) return null;
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_MEDIA_BYTES) return null;
  return { data: buffer, mediaType: media.mediaType };
}
