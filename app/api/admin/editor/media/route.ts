import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorOrAdminAuthorized } from '../../../_lib/site-content';
import { uploadSiteImage } from '../../../_lib/site-media';
import { SITE_MEDIA_EXTENSIONS, SITE_MEDIA_MAX_BYTES } from '../../../_lib/site-media-logic';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!editorOrAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
  if (!SITE_MEDIA_EXTENSIONS[file.type]) return NextResponse.json({ error: 'Only PNG, JPEG, WebP, or GIF images are allowed.' }, { status: 400 });
  if (file.size > SITE_MEDIA_MAX_BYTES) return NextResponse.json({ error: 'Image must be 5 MB or smaller.' }, { status: 400 });

  const url = await uploadSiteImage(supabase, Buffer.from(await file.arrayBuffer()), file.type);
  if (!url) return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, url });
}
