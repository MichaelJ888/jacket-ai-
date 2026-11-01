// Minimal Replicate client for the CEO AI Studio. Predictions run asynchronously and report back to a tokenised webhook,
// so no serverless request has to wait for a 1-2 minute GPU model.

export type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string | null;
};

const API = 'https://api.replicate.com/v1';

export async function createReplicatePrediction(model: string, input: Record<string, unknown>, webhookUrl: string): Promise<ReplicatePrediction> {
  const token = process.env.REPLICATE_API_KEY;
  if (!token) throw new Error('REPLICATE_API_KEY is not configured');
  const response = await fetch(`${API}/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, webhook: webhookUrl, webhook_events_filter: ['completed'] }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as ReplicatePrediction & { detail?: string };
  if (!response.ok) throw new Error(`Replicate ${response.status}: ${data.detail ?? 'request failed'}`);
  return data;
}

export function replicateOutputUrl(prediction: ReplicatePrediction): string {
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (typeof output !== 'string' || !/^https:\/\//.test(output)) throw new Error(`${prediction.id} returned no image URL`);
  return output;
}

export async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(40_000) });
  if (!response.ok) throw new Error(`Image download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
