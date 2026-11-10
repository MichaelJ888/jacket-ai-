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

// Telegram inline-button payload for a studio job, e.g. "studio:approve:<uuid>" (well under Telegram's 64-byte limit).
export function parseStudioCallback(data: string): { decision: StudioDecision; jobId: string } | null {
  const match = data.match(/^studio:(approve|reject):([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i);
  if (!match) return null;
  return { decision: match[1].toLowerCase() === 'approve' ? 'approve' : 'reject', jobId: match[2] };
}

// Same shape for generated ad pictures: "studioad:approve:<uuid>".
export function parseStudioAdCallback(data: string): { decision: StudioDecision; jobId: string } | null {
  const match = data.match(/^studioad:(approve|reject):([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i);
  if (!match) return null;
  return { decision: match[1].toLowerCase() === 'approve' ? 'approve' : 'reject', jobId: match[2] };
}

export function studioJobPath(prefix: string, extension: string, id: string) {
  return `${prefix}/${Date.now()}-${id}.${extension}`;
}

export const STUDIO_CATEGORIES = ['uniform', 'jacket', 'polo', 'corporate-wear', 'sports-jersey', 'giveaway', 'school-uniform', 'bag', 'other'] as const;

// Daily ad theme rotation. Five themes repeat in order by Manila calendar day (Day 6 = Day 1 again).
export const STUDIO_AD_THEMES = [
  { key: 'jackets', label: 'Customized Jackets (Varsity, Softshell, Bomber, Reflectorized)', categories: ['jacket'] },
  { key: 'corporate-uniforms', label: 'Customized Company Uniforms & Corporate Attire', categories: ['uniform', 'corporate-wear'] },
  { key: 'giveaways', label: 'Customized Corporate Giveaways & Promotional Merchandise', categories: ['giveaway', 'polo'] },
  { key: 'school-uniforms', label: 'Customized School Uniforms & Campus Wear', categories: ['school-uniform', 'sports-jersey'] },
  { key: 'bags-accessories', label: 'Customized Bags & Accessories', categories: ['bag'] },
] as const;
export type StudioAdTheme = (typeof STUDIO_AD_THEMES)[number];

const DAY_MS = 86_400_000;

// manilaDate is YYYY-MM-DD in Asia/Manila; the calendar date alone decides the theme, so every instance agrees.
export function studioThemeForDay(manilaDate: string): StudioAdTheme {
  const epochDay = Math.floor(Date.parse(`${manilaDate}T00:00:00Z`) / DAY_MS);
  return STUDIO_AD_THEMES[((epochDay % STUDIO_AD_THEMES.length) + STUDIO_AD_THEMES.length) % STUDIO_AD_THEMES.length];
}

export type StudioMetadata = { productTitle: string; category: string; fabric: string | null; description: string | null };

export function buildAutoStudioDescription(productTitle: string, category: string, fabric: string): string {
  const itemType = category.trim().replace(/-/g, ' ');
  const material = fabric.trim() ? ` Specified fabric: ${fabric.trim()}.` : '';
  return `Custom ${itemType} item: ${productTitle.trim()}.${material} A flexible option for teams, schools, and events. Add your logo and request a quotation for details.`;
}

// Catalog and ads need a real title and category; fabric and description are optional.
export function parseStudioMetadata(input: { productTitle?: unknown; category?: unknown; fabric?: unknown; description?: unknown }): StudioMetadata | null {
  const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const productTitle = clean(input.productTitle, 120);
  const category = clean(input.category, 40).toLowerCase();
  if (!productTitle || !(STUDIO_CATEGORIES as readonly string[]).includes(category)) return null;
  return {
    productTitle,
    category,
    fabric: clean(input.fabric, 120) || null,
    description: clean(input.description, 600) || null,
  };
}
