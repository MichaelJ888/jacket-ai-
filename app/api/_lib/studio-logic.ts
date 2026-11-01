// Pure CEO AI Studio policy: Replicate inputs, logo placement and upload validation. No I/O so it is unit-testable.

export const STUDIO_INPUT_BUCKET = 'studio-inputs';
export const STUDIO_OUTPUT_BUCKET = 'studio-outputs';
export const STUDIO_MAX_BYTES = 8 * 1024 * 1024;
export const STUDIO_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
export const STUDIO_UPLOAD_KINDS = ['source', 'face', 'logo'] as const;
export type StudioUploadKind = (typeof STUDIO_UPLOAD_KINDS)[number];
export type StudioDecision = 'approve' | 'reject';

export function studioImageExtension(mime: string): string | null {
  return STUDIO_MIME_EXTENSIONS[mime] ?? null;
}

export function isStudioUploadKind(value: unknown): value is StudioUploadKind {
  return typeof value === 'string' && (STUDIO_UPLOAD_KINDS as readonly string[]).includes(value);
}

// Only https URLs that point at our own Supabase project storage are accepted, so the server never fetches arbitrary hosts.
export function isAllowedStudioAssetUrl(value: unknown, supabaseUrl: string | undefined): value is string {
  if (typeof value !== 'string' || !supabaseUrl) return false;
  try {
    const url = new URL(value);
    const base = new URL(supabaseUrl);
    return url.protocol === 'https:' && url.host === base.host && url.pathname.startsWith('/storage/v1/object/public/');
  } catch {
    return false;
  }
}

export function buildFaceSwapInput(sourceUrl: string, faceUrl: string) {
  // codeplugtech/face-swap: swap_image supplies the new face, input_image is the garment photo being edited.
  return { swap_image: faceUrl, input_image: sourceUrl };
}

export function buildEnhanceInput(imageUrl: string, scale: number) {
  const safeScale = scale === 2 || scale === 4 ? scale : 2;
  return { image: imageUrl, scale: safeScale, face_enhance: false };
}

export type LogoPlacement = { left: number; top: number; width: number; height: number };

// Left chest of a garment photo: the wearer's left, which is the viewer's right of a front-facing jacket.
// Logo width is a fraction of the image width so it scales with the photo's resolution.
export function logoPlacementLeftChest(imageWidth: number, imageHeight: number, logoWidth: number, logoHeight: number, widthRatio = 0.12): LogoPlacement {
  const width = Math.max(1, Math.round(imageWidth * widthRatio));
  const height = Math.max(1, Math.round((logoHeight / logoWidth) * width));
  const left = Math.round(imageWidth * 0.66 - width / 2);
  const top = Math.round(imageHeight * 0.3 - height / 2);
  return {
    left: Math.min(Math.max(0, left), Math.max(0, imageWidth - width)),
    top: Math.min(Math.max(0, top), Math.max(0, imageHeight - height)),
    width,
    height,
  };
}

export function studioJobPath(prefix: string, extension: string, id: string) {
  return `${prefix}/${Date.now()}-${id}.${extension}`;
}
