// Isolated Meta Graph client. Publishing code imports only from here, so UI or component changes cannot alter how requests are signed or sent.

export const GRAPH = 'https://graph.facebook.com/v21.0';
export const GRAPH_VIDEO = 'https://graph-video.facebook.com/v21.0';
export const GRAPH_TIMEOUT_MS = 10000;

export type GraphResult = { ok: boolean; data: Record<string, unknown>; reason?: string; status?: number };

// Network failures and 5xx responses are transient. Only idempotent reads are retried automatically (see graphGet).
export function isTransientGraphFailure(result: GraphResult): boolean {
  return !result.ok && (result.status === undefined || result.status >= 500);
}

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(data: Record<string, unknown>, status: number) {
  return (data.error as { message?: string } | undefined)?.message || `HTTP ${status}`;
}

// Non-idempotent: a POST is never retried, because a timeout after Meta accepted it would double-post.
export async function graphPost(path: string, body: Record<string, unknown>, token: string, baseUrl = GRAPH): Promise<GraphResult> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    const data = await parseBody(response);
    if (!response.ok) return { ok: false, data, reason: errorMessage(data, response.status), status: response.status };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, data: {}, reason: error instanceof Error ? error.message : 'request failed' };
  }
}

// Multipart POST for resumable video uploads. Callers decide retries: transfer chunks are offset-addressed and safe to repeat, publish steps are not.
export async function graphPostForm(baseUrl: string, path: string, form: FormData, token: string, timeoutMs = 55000): Promise<GraphResult> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await parseBody(response);
    if (!response.ok) return { ok: false, data, reason: errorMessage(data, response.status), status: response.status };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, data: {}, reason: error instanceof Error ? error.message : 'request failed' };
  }
}

// Idempotent read (status polling). Retries transient failures with a short backoff.
export async function graphGet(path: string, token: string, attempts = 3, backoffMs = 1500): Promise<GraphResult> {
  let last: GraphResult = { ok: false, data: {}, reason: 'request failed' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    try {
      const response = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
      const data = await parseBody(response);
      last = response.ok ? { ok: true, data } : { ok: false, data, reason: errorMessage(data, response.status), status: response.status };
    } catch (error) {
      last = { ok: false, data: {}, reason: error instanceof Error ? error.message : 'request failed' };
    }
    if (!isTransientGraphFailure(last)) return last;
  }
  return last;
}
