// Pure Meta media rules (no I/O) so they can be unit-tested without network access.

export type MetaImagePlatform = 'facebook' | 'instagram';

export type SniffedImage = { mime: 'image/jpeg' | 'image/png'; width: number; height: number };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Instagram Content Publishing: JPEG only, 8 MB max, aspect ratio 4:5 to 1.91:1, width at least 320 px.
// Facebook Photos API: JPEG or PNG, 8 MB max, both sides at least 200 px.
export const META_IMAGE_RULES: Record<MetaImagePlatform, { mimes: SniffedImage['mime'][]; maxBytes: number; minWidth: number; minHeight: number; minRatio: number; maxRatio: number }> = {
  instagram: { mimes: ['image/jpeg'], maxBytes: MAX_IMAGE_BYTES, minWidth: 320, minHeight: 320, minRatio: 0.8, maxRatio: 1.91 },
  facebook: { mimes: ['image/jpeg', 'image/png'], maxBytes: MAX_IMAGE_BYTES, minWidth: 200, minHeight: 200, minRatio: 0, maxRatio: Number.POSITIVE_INFINITY },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Start-of-frame markers that carry dimensions (excludes DHT C4, JPG C8, DAC CC).
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 9 > bytes.length) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { mime: 'image/jpeg', width, height };
    }
    i += 2 + length;
  }
  return null;
}

// Identifies the real format from magic bytes, not from the server's Content-Type header.
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return sniffJpeg(bytes);
  if (bytes.length >= 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  return null;
}

// Returns null when the image is acceptable for the platform, otherwise a human-readable reason.
export function checkImageForPlatform(platform: MetaImagePlatform, image: SniffedImage, byteLength: number): string | null {
  const rules = META_IMAGE_RULES[platform];
  if (!rules.mimes.includes(image.mime)) return `${platform} does not accept ${image.mime}`;
  if (byteLength > rules.maxBytes) return `image is ${byteLength} bytes (max ${rules.maxBytes})`;
  if (image.width < rules.minWidth || image.height < rules.minHeight) return `image is ${image.width}x${image.height} (min ${rules.minWidth}x${rules.minHeight})`;
  const ratio = image.width / image.height;
  if (ratio < rules.minRatio || ratio > rules.maxRatio) return `aspect ratio ${ratio.toFixed(3)} outside ${rules.minRatio}-${rules.maxRatio}`;
  return null;
}

// Converts a stored media reference into an absolute HTTPS URL Meta can fetch. Relative paths resolve against the site origin.
export function toAbsoluteMediaUrl(raw: string | null | undefined, siteOrigin: string): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  const candidate = value.startsWith('/') ? `${siteOrigin.replace(/\/$/, '')}${value}` : value;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Meta error texts that mean "this image URL is not a usable image".
export function isMetaImageRejection(message: string | undefined): boolean {
  return /missing or invalid image file|only photo or video|image_url|media type/i.test(message || '');
}
