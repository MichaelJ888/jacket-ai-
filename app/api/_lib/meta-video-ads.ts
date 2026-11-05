// Facebook Page video ads: resumable (chunked) upload to graph-video.facebook.com, then publish.
// Bytes come from the public Supabase Storage bucket that scripts/upload-videos-to-supabase.mjs fills from
// public/images/MJIC Facebook Video Ads/. That folder is excluded from the deploy by .vercelignore.
import { GRAPH_VIDEO, graphPostForm, isTransientGraphFailure, type GraphResult } from './meta-graph.ts';

export const VIDEO_CHUNK_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 1024 * 1024 * 1024;
const TRANSFER_ATTEMPTS = 3;

export async function fetchVideoBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(55000) });
  if (!response.ok) throw new Error(`video download failed (HTTP ${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error('video file is empty');
  if (bytes.byteLength > VIDEO_MAX_BYTES) throw new Error('video exceeds the 1 GB upload limit');
  return bytes;
}

function phaseForm(fields: Record<string, string>, chunk?: Uint8Array) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (chunk) form.set('video_file_chunk', new Blob([chunk as BlobPart], { type: 'application/octet-stream' }), 'chunk.bin');
  return form;
}

// Returns a GraphResult so the caller classifies token and permission errors the same way as other Meta posts.
// On success data.id is the video id. Start and transfer may retry (offset-addressed). Finish is never retried.
export async function uploadFacebookVideo(input: { pageId: string; token: string; bytes: Uint8Array; description: string }): Promise<GraphResult> {
  const path = `/${input.pageId}/videos`;
  const size = input.bytes.byteLength;

  const start = await graphPostForm(GRAPH_VIDEO, path, phaseForm({ upload_phase: 'start', file_size: String(size) }), input.token);
  if (!start.ok) return start;
  const sessionId = String(start.data.upload_session_id || '');
  const videoId = String(start.data.video_id || '');
  if (!sessionId || !videoId) return { ok: false, data: start.data, reason: 'Facebook did not return an upload session' };

  let offset = Number(start.data.start_offset ?? 0);
  while (offset < size) {
    const end = Math.min(offset + VIDEO_CHUNK_BYTES, size);
    let transfer: GraphResult | null = null;
    for (let attempt = 0; attempt < TRANSFER_ATTEMPTS; attempt += 1) {
      transfer = await graphPostForm(GRAPH_VIDEO, path, phaseForm({ upload_phase: 'transfer', upload_session_id: sessionId, start_offset: String(offset) }, input.bytes.subarray(offset, end)), input.token);
      if (transfer.ok || !isTransientGraphFailure(transfer)) break;
    }
    if (!transfer?.ok) return transfer ?? { ok: false, data: {}, reason: 'Facebook video transfer failed' };
    const next = Number(transfer.data.start_offset);
    if (!Number.isFinite(next) || next <= offset) return { ok: false, data: transfer.data, reason: 'Facebook video upload stalled (offset did not advance)' };
    offset = next;
  }

  const finish = await graphPostForm(GRAPH_VIDEO, path, phaseForm({ upload_phase: 'finish', upload_session_id: sessionId, description: input.description }), input.token);
  if (!finish.ok) return finish;
  if (finish.data.success === false) return { ok: false, data: finish.data, reason: 'Facebook rejected the finished video' };
  return { ok: true, data: { id: videoId } };
}
