// Pure helpers for editor image uploads. No I/O here so they stay unit-testable.

export const SITE_MEDIA_BUCKET = 'site-media';
export const SITE_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const SITE_MEDIA_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const DATA_IMAGE_PATTERN = /^data:(image\/[a-z.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

export function parseImageDataUrl(value: string): { mime: string; base64: string } | null {
  const match = DATA_IMAGE_PATTERN.exec(value);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!SITE_MEDIA_EXTENSIONS[mime]) return null;
  return { mime, base64: match[2].replace(/\s/g, '') };
}

// Decoded size computed from the base64 length, so no buffer is allocated before the limit check.
export function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// Applies fn to every string inside a JSON-like value, returning a new value.
export function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]));
  }
  return value;
}
