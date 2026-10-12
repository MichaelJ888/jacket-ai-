export const VIDEO_WIDTH = 720;
export const VIDEO_HEIGHT = 1280;
export const VIDEO_FPS = 24;
export const VIDEO_DURATION_SECONDS = 8;
export const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateImageFile(
  file: Pick<File, "name" | "size" | "type">,
  kind: "artwork" | "logo",
): string | null {
  const maxBytes = kind === "artwork" ? MAX_ARTWORK_BYTES : MAX_LOGO_BYTES;
  if (!IMAGE_TYPES.has(file.type)) return "Choose a PNG, JPEG, or WebP image.";
  if (file.size <= 0) return "The selected image is empty.";
  if (file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return `Keep this image under ${limitMb} MB.`;
  }
  return null;
}

export function getWebmMimeType(isSupported: (mimeType: string) => boolean): string | null {
  return [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find(isSupported) ?? null;
}

export function makeVideoFilename(clientName: string): string {
  const slug = clientName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${slug || "mjic-jacket"}-mockup.webm`;
}
