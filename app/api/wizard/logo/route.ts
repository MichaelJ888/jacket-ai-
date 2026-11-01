import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';

// Private bucket: client logos are confidential, so staff get a time-limited signed URL instead of a public link.
const BUCKET = 'wizard-logos';
const MAX_BYTES = 8 * 1024 * 1024;
const SEVEN_DAYS_SECONDS = 7 * 86400;

// Magic-byte check so the stored object is really an image, not just a file that claims to be one.
function detectImage(buf: Buffer): { type: string; ext: string } | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be 8 MB or smaller.' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectImage(bytes);
  if (!detected) return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 400 });

  // Creating the bucket is idempotent; an "already exists" error is expected after the first call.
  await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] });

  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${detected.ext}`;
  const upload = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: detected.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });

  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, SEVEN_DAYS_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: 'Upload saved, but link creation failed.' }, { status: 500 });

  return NextResponse.json({ ok: true, path, url: signed.data.signedUrl });
}
