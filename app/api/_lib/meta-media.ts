import { publicBaseUrl } from './channels';
import {
  checkImageForPlatform,
  sniffImage,
  toAbsoluteMediaUrl,
  type MetaImagePlatform,
} from './meta-media-rules';

export { isMetaImageRejection } from './meta-media-rules';

export type ResolvedMetaImage = { url: string; fallback: boolean; reason: string | null };

const VALIDATION_TTL_MS = 10 * 60 * 1000;
const validationCache = new Map<string, { checkedAt: number; reason: string | null }>();

// Landscape/square JPEGs from public/images, verified against META_IMAGE_RULES (portrait photos fail Instagram's 0.8 minimum aspect ratio).
const FALLBACK_BANNER_PATHS = [
  '/images/company-uniforms/1.jpg',
  '/images/company-uniforms/10.jpg',
  '/images/company-uniforms/11.jpg',
  '/images/school-uniforms/an-education-volunteer-with-his-high-school-students-in-the-philippines-41a86c-1024.jpg',
];

// Fetches the image and returns null when it is acceptable, otherwise why it is not.
async function inspectImage(platform: MetaImagePlatform, url: string): Promise<string | null> {
  const cacheKey = `${platform}|${url}`;
  const cached = validationCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < VALIDATION_TTL_MS) return cached.reason;

  let reason: string | null;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      reason = `HTTP ${response.status}`;
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const image = sniffImage(bytes);
      reason = image ? checkImageForPlatform(platform, image, bytes.length) : 'not a JPEG or PNG file';
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : 'image request failed';
  }
  validationCache.set(cacheKey, { checkedAt: Date.now(), reason });
  return reason;
}

// Returns a URL Meta can fetch as a valid image for the platform. Missing, relative-but-broken, or invalid images fall back to a verified banner.
export async function resolveMetaImage(platform: MetaImagePlatform, rawUrl: string | null | undefined): Promise<ResolvedMetaImage> {
  const absolute = toAbsoluteMediaUrl(rawUrl, publicBaseUrl());
  const originalReason = absolute ? await inspectImage(platform, absolute) : 'missing or non-HTTPS image URL';
  if (absolute && originalReason === null) return { url: absolute, fallback: false, reason: null };

  const failures: string[] = [];
  for (const path of FALLBACK_BANNER_PATHS) {
    const candidate = toAbsoluteMediaUrl(path, publicBaseUrl());
    if (!candidate) continue;
    const reason = await inspectImage(platform, candidate);
    if (reason === null) return { url: candidate, fallback: true, reason: originalReason };
    failures.push(`${path}: ${reason}`);
  }
  throw new Error(`No valid ${platform} image (${originalReason}); fallback banners also failed: ${failures.join('; ')}`);
}
