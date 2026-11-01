import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { STUDIO_INPUT_BUCKET, STUDIO_MAX_BYTES, isStudioUploadKind, studioImageExtension, studioJobPath } from '../../../_lib/studio-logic';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const kind = form?.get('kind');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
  if (!isStudioUploadKind(kind)) return NextResponse.json({ error: 'Upload kind must be source, face, or logo.' }, { status: 400 });
  const extension = studioImageExtension(file.type);
  if (!extension) return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 400 });
  if (file.size > STUDIO_MAX_BYTES) return NextResponse.json({ error: 'Image must be 8 MB or smaller.' }, { status: 400 });

  // Creating the bucket is idempotent: an "already exists" error is expected after the first call.
  await supabase.storage.createBucket(STUDIO_INPUT_BUCKET, { public: true, fileSizeLimit: STUDIO_MAX_BYTES });
  const path = studioJobPath(kind, extension, randomUUID());
  const { error } = await supabase.storage.from(STUDIO_INPUT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });

  return NextResponse.json({ ok: true, url: supabase.storage.from(STUDIO_INPUT_BUCKET).getPublicUrl(path).data.publicUrl });
}
