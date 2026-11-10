import { getSupabaseAdmin } from '../../../_lib/integrations';
import { editorChatFromRequest } from '../../../_lib/site-content';
import { isAllowedStudioAssetUrl } from '../../../_lib/studio-logic';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export async function GET(request: Request) {
  if (!editorChatFromRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: 'Supabase is not configured' }, { status: 500 });

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return Response.json({ error: 'A valid studio job id is required.' }, { status: 400 });

  const { data: job, error } = await supabase.from('studio_jobs').select('id, output_url').eq('id', id).maybeSingle();
  if (error) return Response.json({ error: 'Could not load the studio job.' }, { status: 500 });
  if (!job?.output_url) return Response.json({ error: 'No finished image is available for this job.' }, { status: 404 });
  if (
    !isAllowedStudioAssetUrl(job.output_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    !new URL(job.output_url).pathname.startsWith('/storage/v1/object/public/studio-outputs/')
  ) {
    return Response.json({ error: 'The saved image URL is invalid.' }, { status: 502 });
  }

  let image: Response;
  try {
    image = await fetch(job.output_url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return Response.json({ error: 'Could not retrieve the image from storage.' }, { status: 502 });
  }
  if (!image.ok) return Response.json({ error: `Image download failed (HTTP ${image.status}).` }, { status: 502 });

  const contentLength = Number(image.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    return Response.json({ error: 'The saved image exceeds the download size limit.' }, { status: 413 });
  }
  if (!image.body) return Response.json({ error: 'The image response was empty.' }, { status: 502 });
  const reader = image.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        void reader.cancel().catch(() => undefined);
        return Response.json({ error: 'The saved image exceeds the download size limit.' }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: 'Could not retrieve the complete image from storage.' }, { status: 502 });
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);

  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename="mjic-studio-${id.slice(0, 8)}.jpg"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
