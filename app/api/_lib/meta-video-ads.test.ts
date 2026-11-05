import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { uploadFacebookVideo } from './meta-video-ads.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Call = { url: string; phase: string; offset?: string };

// Scripted Graph responses per upload phase. Each phase consumes the next queued response.
function mockGraph(queue: Array<{ status: number; body: Record<string, unknown> } | 'network-error'>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    calls.push({ url: String(url), phase: String(form.get('upload_phase')), offset: form.get('start_offset')?.toString() });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra call');
    if (next === 'network-error') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

const input = (size: number) => ({ pageId: '123', token: 'test-token', bytes: new Uint8Array(size).fill(7), description: 'ad' });

test('uploads start, transfers all chunks, then finishes and returns the video id', async () => {
  const size = 5 * 1024 * 1024 + 10;
  const calls = mockGraph([
    { status: 200, body: { upload_session_id: 's1', video_id: 'v1', start_offset: '0' } },
    { status: 200, body: { start_offset: String(5 * 1024 * 1024) } },
    { status: 200, body: { start_offset: String(size) } },
    { status: 200, body: { success: true } },
  ]);
  const result = await uploadFacebookVideo(input(size));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'v1' });
  assert.deepEqual(calls.map((c) => c.phase), ['start', 'transfer', 'transfer', 'finish']);
  assert.equal(calls[2].offset, String(5 * 1024 * 1024));
  assert.ok(calls.every((c) => c.url.startsWith('https://graph-video.facebook.com/')));
});

test('retries a transient transfer failure at the same offset', async () => {
  const calls = mockGraph([
    { status: 200, body: { upload_session_id: 's1', video_id: 'v1', start_offset: '0' } },
    { status: 503, body: { error: { message: 'busy' } } },
    { status: 200, body: { start_offset: '100' } },
    { status: 200, body: { success: true } },
  ]);
  const result = await uploadFacebookVideo(input(100));
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((c) => [c.phase, c.offset]), [['start', undefined], ['transfer', '0'], ['transfer', '0'], ['finish', undefined]]);
});

test('does not retry the finish phase', async () => {
  const calls = mockGraph([
    { status: 200, body: { upload_session_id: 's1', video_id: 'v1', start_offset: '0' } },
    { status: 200, body: { start_offset: '100' } },
    { status: 500, body: { error: { message: 'boom' } } },
  ]);
  const result = await uploadFacebookVideo(input(100));
  assert.equal(result.ok, false);
  assert.equal(calls.filter((c) => c.phase === 'finish').length, 1);
});

test('fails when the offset does not advance', async () => {
  mockGraph([
    { status: 200, body: { upload_session_id: 's1', video_id: 'v1', start_offset: '0' } },
    { status: 200, body: { start_offset: '0' } },
  ]);
  const result = await uploadFacebookVideo(input(100));
  assert.equal(result.ok, false);
  assert.match(String(result.reason), /stalled/);
});

test('surfaces a permission error from the start phase without transferring', async () => {
  const calls = mockGraph([{ status: 403, body: { error: { message: 'Insufficient permissions' } } }]);
  const result = await uploadFacebookVideo(input(100));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Insufficient permissions');
  assert.equal(calls.length, 1);
});
