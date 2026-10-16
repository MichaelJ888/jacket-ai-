// Pure helpers for Telegram updates. No imports so they are unit-testable.

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 180;

export type TelegramMedia = { kind: 'voice' | 'photo' | 'image-file'; fileId: string; mediaType: string; size: number | null };

type TelegramMessage = {
  voice?: { file_id?: string; mime_type?: string; file_size?: number; duration?: number };
  audio?: { file_id?: string; mime_type?: string; file_size?: number; duration?: number };
  photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>;
  document?: { file_id?: string; mime_type?: string; file_size?: number };
};

// Picks the one attachment the CEO bot can understand: a voice note/audio, the largest sensible photo size, or an image file.
export function pickTelegramMedia(message: TelegramMessage | undefined | null): { media: TelegramMedia | null; rejected?: string } {
  if (!message) return { media: null };
  const audio = message.voice || message.audio;
  if (audio?.file_id) {
    if ((audio.duration ?? 0) > MAX_VOICE_SECONDS) return { media: null, rejected: `Voice note is too long (max ${MAX_VOICE_SECONDS / 60} minutes). Please send a shorter one.` };
    if ((audio.file_size ?? 0) > MAX_MEDIA_BYTES) return { media: null, rejected: 'Audio file is too large.' };
    return { media: { kind: 'voice', fileId: audio.file_id, mediaType: normalizeAudioType(audio.mime_type), size: audio.file_size ?? null } };
  }
  if (message.photo?.length) {
    const fits = message.photo.filter((size) => size.file_id && (size.file_size ?? 0) <= MAX_MEDIA_BYTES);
    const best = fits.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
    if (!best?.file_id) return { media: null, rejected: 'Photo is too large.' };
    return { media: { kind: 'photo', fileId: best.file_id, mediaType: 'image/jpeg', size: best.file_size ?? null } };
  }
  const doc = message.document;
  if (doc?.file_id && /^image\/(jpeg|png|webp)$/i.test(doc.mime_type || '')) {
    if ((doc.file_size ?? 0) > MAX_MEDIA_BYTES) return { media: null, rejected: 'Image file is too large.' };
    return { media: { kind: 'image-file', fileId: doc.file_id, mediaType: (doc.mime_type as string).toLowerCase(), size: doc.file_size ?? null } };
  }
  return { media: null };
}

// Telegram voice notes are Opus in an OGG container; models expect a standard audio MIME type.
export function normalizeAudioType(mime?: string) {
  const type = (mime || '').toLowerCase();
  if (!type || type === 'audio/ogg' || type.includes('opus')) return 'audio/ogg';
  return type;
}

export function isFreshUpdateInsertError(error: { code?: string } | null | undefined) {
  return !error || error.code !== '23505';
}
