import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from './integrations';
import {
  decodedByteLength,
  mapStrings,
  parseImageDataUrl,
  SITE_MEDIA_BUCKET,
  SITE_MEDIA_EXTENSIONS,
  SITE_MEDIA_MAX_BYTES,
} from './site-media-logic';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

let bucketReady = false;

// Uploads an image to the public site-media bucket and returns its public URL, or null on failure.
export async function uploadSiteImage(supabase: Supabase, bytes: Buffer, mime: string): Promise<string | null> {
  const extension = SITE_MEDIA_EXTENSIONS[mime];
  if (!extension) return null;
  if (!bucketReady) {
    const { error } = await supabase.storage.createBucket(SITE_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: SITE_MEDIA_MAX_BYTES,
      allowedMimeTypes: Object.keys(SITE_MEDIA_EXTENSIONS),
    });
    if (error && !/already exists/i.test(error.message)) {
      console.error('Site media bucket creation failed:', error.message);
      return null;
    }
    bucketReady = true;
  }
  const path = `${Date.now()}-${randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(SITE_MEDIA_BUCKET).upload(path, bytes, { contentType: mime, cacheControl: '3600', upsert: false });
  if (error) {
    console.error('Site media upload failed:', error.message);
    return null;
  }
  return supabase.storage.from(SITE_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Replaces inline base64 images in an editor payload with public storage URLs so the saved JSON stays small.
export async function externalizeDataImages(supabase: Supabase, body: unknown): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const dataUrls = new Set<string>();
  mapStrings(body, (text) => {
    if (text.startsWith('data:image/')) dataUrls.add(text);
    return text;
  });
  if (dataUrls.size === 0) return { ok: true, body };

  const replacements = new Map<string, string>();
  for (const dataUrl of dataUrls) {
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) return { ok: false, error: 'Only PNG, JPEG, WebP, or GIF images can be published.' };
    if (decodedByteLength(parsed.base64) > SITE_MEDIA_MAX_BYTES) return { ok: false, error: 'Each image must be 5 MB or smaller.' };
    const url = await uploadSiteImage(supabase, Buffer.from(parsed.base64, 'base64'), parsed.mime);
    if (!url) return { ok: false, error: 'Image upload failed. Please try again.' };
    replacements.set(dataUrl, url);
  }
  return { ok: true, body: mapStrings(body, (text) => replacements.get(text) ?? text) };
}
