import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../_lib/integrations';
import { editorChatFromRequest } from '../_lib/site-content';
import { formatManila } from '../_lib/manila-time';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['cutting', 'embroidery', 'sewing', 'quality', 'dispatch', 'update']);
const TYPES = new Set(['image', 'video', 'youtube', 'none']);
const MEDIA_URL = /^(https:\/\/|\/(?!\/))[^\s"'<>()]+$/;
const MAX_URL = 2000;
const MAX_CAPTION = 500;
const FEED_LIMIT = 30;

type UpdateRow = {
  id: number;
  media_url: string | null;
  media_type: string;
  embed_url: string | null;
  caption: string;
  status: string;
  created_at: string;
};

function toFeedItem(row: UpdateRow) {
  const ts = Date.parse(row.created_at) || 0;
  return {
    id: row.id,
    img: row.media_url || '',
    type: row.media_type,
    embedUrl: row.embed_url || '',
    caption: row.caption,
    status: row.status,
    ts,
    date: formatManila(ts, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

// Public marketing feed — service-role read, table stays RLS-locked to anon/authenticated.
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  const { data, error } = await supabase
    .from('production_updates')
    .select('id, media_url, media_type, embed_url, caption, status, created_at')
    .order('created_at', { ascending: false })
    .limit(FEED_LIMIT);
  if (error) return NextResponse.json({ error: 'Could not load updates.' }, { status: 500 });
  return NextResponse.json((data as UpdateRow[]).map(toFeedItem), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid update.' }, { status: 400 });
  const { img, type, embedUrl, caption, status } = body as Record<string, unknown>;

  if (caption !== undefined && (typeof caption !== 'string' || caption.length > MAX_CAPTION)) {
    return NextResponse.json({ error: `Caption must be ${MAX_CAPTION} characters or fewer.` }, { status: 400 });
  }
  const text = (caption as string | undefined)?.trim() ?? '';
  const mediaUrl = typeof img === 'string' ? img.trim() : '';
  const embed = typeof embedUrl === 'string' ? embedUrl.trim() : '';
  const mediaType = TYPES.has(type as string) ? (type as string) : mediaUrl ? 'image' : 'none';
  const feedStatus = STATUSES.has(status as string) ? (status as string) : 'update';

  if (!mediaUrl && !text) return NextResponse.json({ error: 'Add a photo/video or a caption first.' }, { status: 400 });
  if (mediaUrl && (mediaUrl.length > MAX_URL || !MEDIA_URL.test(mediaUrl))) {
    return NextResponse.json({ error: 'Media must be an https:// or / path URL.' }, { status: 400 });
  }
  if (mediaType === 'youtube' && (embed.length > MAX_URL || !/^https:\/\/(www\.)?youtube\.com\/embed\/[\w-]+$/.test(embed))) {
    return NextResponse.json({ error: 'Invalid YouTube embed URL.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('production_updates')
    .insert({
      media_url: mediaUrl || null,
      media_type: mediaType,
      embed_url: mediaType === 'youtube' ? embed : null,
      caption: text,
      status: feedStatus,
    })
    .select('id, media_url, media_type, embed_url, caption, status, created_at')
    .single();
  if (error) return NextResponse.json({ error: 'Post failed. Please try again.' }, { status: 500 });
  return NextResponse.json(toFeedItem(data as UpdateRow));
}

export async function DELETE(request: Request) {
  if (!editorChatFromRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  const { error } = await supabase.from('production_updates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Delete failed. Please try again.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
