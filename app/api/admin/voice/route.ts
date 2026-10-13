import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '../../_lib/auth';
import { documentToText, MAX_DOC_BYTES } from '../../_lib/doc-to-text';
import { getSupabaseAdmin } from '../../_lib/integrations';
import { parseQaText } from '../../_lib/voice-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUDIENCES = ['client', 'employee', 'supplier'];

// Teach the AI your replies. Accepts multipart (file = .docx/.txt, audience) or JSON { audience, text }. ?preview=1 parses without saving.
export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  let audience = 'client';
  let text = '';
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    audience = String(form.get('audience') || 'client');
    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_DOC_BYTES) return NextResponse.json({ error: 'File too large (8MB max)' }, { status: 413 });
      const buffer = Buffer.from(await file.arrayBuffer());
      try {
        text = await documentToText(file.name, buffer);
      } catch {
        return NextResponse.json({ error: 'Could not read that file. Use .docx, .pdf, .xlsx or .txt.' }, { status: 400 });
      }
    }
    text = `${text}\n\n${String(form.get('text') || '')}`.trim();
  } else {
    const body = await request.json().catch(() => ({}));
    audience = String(body.audience || 'client');
    text = String(body.text || '');
  }
  if (!AUDIENCES.includes(audience)) audience = 'client';
  const examples = parseQaText(text);
  if (!examples.length) return NextResponse.json({ error: 'No Q&A text found. Upload a .docx/.txt or paste text.' }, { status: 400 });
  if (new URL(request.url).searchParams.get('preview')) return NextResponse.json({ success: true, preview: true, found: examples.length, sample: examples.slice(0, 5) });

  const rows = examples.slice(0, 2000).map((item) => ({ kind: audience, audience, prompt: item.prompt?.slice(0, 1000) || null, example: item.reply.slice(0, 1000) }));
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await supabase.from('style_examples').insert(rows.slice(index, index + 200));
    if (error) return NextResponse.json({ error: error.message, savedSoFar: index }, { status: 500 });
  }
  return NextResponse.json({ success: true, saved: rows.length, truncated: examples.length > rows.length, audience });
}
