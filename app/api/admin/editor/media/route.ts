import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';

export const dynamic = 'force-dynamic';

const BUCKET = 'site-media';
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
  const extension = EXTENSIONS[file.type];
  if (!extension) return NextResponse.json({ error: 'Only PNG, JPEG, WebP, or GIF images are allowed.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be 5 MB or smaller.' }, { status: 400 });

  // Creating the bucket is idempotent here: an "already exists" error is expected on every call after the first.
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: Object.keys(EXTENSIONS) });

  const path = `${Date.now()}-${randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
