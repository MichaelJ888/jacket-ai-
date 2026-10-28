import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { isAdminAuthorized } from '../../_lib/auth';
import { documentToText, MAX_DOC_BYTES } from '../../_lib/doc-to-text';
import { getSupabaseAdmin } from '../../_lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'mjic-knowledge';
const CATEGORIES = ['faq', 'tone', 'product', 'size_chart', 'internal_cost', 'supplier', 'template'] as const;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isCategory(value: string): value is (typeof CATEGORIES)[number] {
  return CATEGORIES.includes(value as (typeof CATEGORIES)[number]);
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const { data, error } = await supabase
    .from('mjic_knowledge_items')
    .select('id, category, title, content, file_name, mime_type, storage_path, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = await Promise.all((data || []).map(async (item) => {
    if (!item.storage_path) return { ...item, storage_path: undefined, asset_url: null };
    const { data: signed, error: signingError } = await supabase.storage.from(BUCKET).createSignedUrl(item.storage_path, 300);
    if (signingError) return { error: signingError.message };
    return { ...item, storage_path: undefined, asset_url: signed.signedUrl };
  }));
  const failed = items.find((item) => 'error' in item);
  if (failed && 'error' in failed) return NextResponse.json({ error: failed.error }, { status: 500 });
  return NextResponse.json({ success: true, items });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const form = await request.formData();
  const category = String(form.get('category') || 'faq');
  const title = String(form.get('title') || '').trim().slice(0, 120);
  const suppliedText = String(form.get('content') || '').trim();
  const file = form.get('file');
  if (!isCategory(category)) return NextResponse.json({ error: 'Unsupported knowledge category.' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
  if (suppliedText.length > 20000) return NextResponse.json({ error: 'Text is limited to 20,000 characters.' }, { status: 413 });

  let content = suppliedText;
  let storagePath: string | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_DOC_BYTES) return NextResponse.json({ error: 'File too large (8MB max).' }, { status: 413 });
    const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
    mimeType = MIME_BY_EXTENSION[extension] || '';
    if (!mimeType) return NextResponse.json({ error: 'Use .txt, .docx, .pdf, .xlsx, .jpg, .png, or .webp.' }, { status: 400 });
    if (file.type && file.type !== 'application/octet-stream' && file.type !== mimeType) {
      return NextResponse.json({ error: 'File extension and media type do not match.' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    fileName = file.name.replace(/[^\w.-]/g, '_').slice(-120);
    if (IMAGE_MIME_TYPES.has(mimeType)) {
      if (category !== 'product' && category !== 'size_chart') {
        return NextResponse.json({ error: 'Images must be categorized as product or size_chart.' }, { status: 400 });
      }
      content ||= title;
      storagePath = `${category}/${randomUUID()}${extension}`;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const upload = await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType: mimeType, upsert: false });
      if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
    } else {
      try {
        content = `${content}\n\n${await documentToText(file.name, bytes)}`.trim();
      } catch (error) {
        console.error('Knowledge document extraction failed:', error);
        return NextResponse.json({ error: 'Could not extract document text. Check that the file is a valid supported document.' }, { status: 400 });
      }
      if (!content) return NextResponse.json({ error: 'The uploaded document contained no readable text.' }, { status: 400 });
    }
  }

  if (!content) return NextResponse.json({ error: 'Add text or upload a supported file.' }, { status: 400 });
  const { data, error } = await supabase
    .from('mjic_knowledge_items')
    .insert({
      category,
      title,
      content: content.slice(0, 20000),
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
    })
    .select('id, category, title, content, file_name, mime_type, created_at')
    .single();
  if (error) {
    if (storagePath) {
      const cleanup = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (cleanup.error) console.error('Knowledge upload cleanup failed:', cleanup.error.message);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, item: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[\da-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'A valid knowledge item id is required.' }, { status: 400 });

  const { data, error: lookupError } = await supabase.from('mjic_knowledge_items').select('storage_path').eq('id', id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Knowledge item not found.' }, { status: 404 });
  if (data.storage_path) {
    const { error } = await supabase.storage.from(BUCKET).remove([data.storage_path]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { error } = await supabase.from('mjic_knowledge_items').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
