import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from './integrations';
import { detectImage, matchTrustClient, TRUST_CLIENTS, type TrustClient } from './client-logos-logic';

type Supabase = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

// Public bucket: logos are shown on the homepage trust roster. Each upload gets a unique path, so it can be cached for a year.
const BUCKET = 'client-logos';
const MAX_BYTES = 8 * 1024 * 1024;

export async function loadClientLogos(supabase: Supabase): Promise<{ name: string; logo: string }[]> {
  const { data, error } = await supabase.from('client_logos').select('slug, logo_url');
  if (error || !data) return [];
  const bySlug = new Map((data as { slug: string; logo_url: string }[]).map((row) => [row.slug, row.logo_url]));
  return TRUST_CLIENTS.filter((client) => bySlug.has(client.slug)).map((client) => ({ name: client.name, logo: bySlug.get(client.slug)! }));
}

async function saveClientLogo(supabase: Supabase, client: TrustClient, bytes: Uint8Array, type: string, ext: string) {
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] });

  const path = `${client.slug}/${Date.now()}-${randomUUID()}.${ext}`;
  const upload = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: type, cacheControl: '31536000', upsert: false });
  if (upload.error) return { error: upload.error.message };

  const previous = await supabase.from('client_logos').select('storage_path').eq('slug', client.slug).maybeSingle();
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const saved = await supabase.from('client_logos').upsert(
    { slug: client.slug, display_name: client.name, logo_url: urlData.publicUrl, storage_path: path, updated_at: new Date().toISOString() },
    { onConflict: 'slug' },
  );
  if (saved.error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: saved.error.message };
  }

  // Replacing a logo: drop the old object so the bucket does not keep orphans. Best effort.
  const oldPath = (previous.data as { storage_path?: string } | null)?.storage_path;
  if (oldPath && oldPath !== path) await supabase.storage.from(BUCKET).remove([oldPath]);
  return { url: urlData.publicUrl };
}

// Handles a CEO photo/file whose caption is "logo <client>". Returns the Telegram reply text.
export async function handleClientLogoUpload(ref: string, file: { data: Uint8Array }): Promise<string> {
  const client = matchTrustClient(ref);
  if (!client) {
    const names = TRUST_CLIENTS.map((c) => c.aliases[0]).join(', ');
    return ref
      ? `Hindi ko kilala ang client na "${ref}", Boss. Gamitin ang isa sa: ${names}.`
      : `Ilagay ang pangalan ng client sa caption, halimbawa: logo Panasonic. Options: ${names}.`;
  }
  if (file.data.byteLength > MAX_BYTES) return 'Masyadong malaki ang logo file (max 8 MB), Boss.';

  // Telegram "photo" messages are recompressed to JPEG and lose transparency; a file/document keeps the original PNG.
  const detected = detectImage(file.data);
  if (!detected) return 'Hindi ito PNG, JPEG, o WebP, Boss. Ipadala ulit bilang file (document) na PNG/JPG/WebP.';

  const supabase = getSupabaseAdmin();
  if (!supabase) return 'Hindi ma-save ang logo: hindi naka-configure ang storage.';

  const result = await saveClientLogo(supabase, client, file.data, detected.type, detected.ext);
  if ('error' in result) return `Hindi na-save ang logo ng ${client.name}, Boss. Subukan ulit.`;
  return `✅ Na-save ang logo ng ${client.name}. Lalabas sa trust roster ng website sa susunod na bisita.`;
}
