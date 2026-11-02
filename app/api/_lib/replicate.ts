// Minimal Replicate client for the CEO AI Studio. Predictions run asynchronously and report back to a tokenised webhook,
// so no serverless request has to wait for a 1-2 minute GPU model.

export type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string | null;
  metrics?: { predict_time?: number | null };
};

const API = 'https://api.replicate.com/v1';

// Studio models (codeplugtech/face-swap, nightmareai/real-esrgan, 851-labs/background-remover) run on
// A100/L40S hardware at $0.0014/$0.000975 per second. The default uses the A100 worst case so the credit
// ledger never under-reports spend; set REPLICATE_USD_PER_SECOND to override, or 0 to disable recording.
const DEFAULT_USD_PER_SECOND = 0.0014;

// Estimated billed cost of a completed prediction: GPU run time × per-second rate.
export function replicateSpendUsd(prediction: ReplicatePrediction): number {
  const raw = process.env.REPLICATE_USD_PER_SECOND;
  const parsed = raw === undefined ? NaN : Number(raw);
  const rate = Number.isFinite(parsed) ? parsed : DEFAULT_USD_PER_SECOND;
  const seconds = prediction.metrics?.predict_time ?? 0;
  if (rate <= 0 || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * rate;
}

export const REPLICATE_BILLING_MESSAGE =
  'Replicate billing needs a top-up: add credit at https://replicate.com/account/billing, then start the job again.';

// Replicate answers out-of-credit requests with 402 or a billing-related detail string.
export function isReplicateBillingFailure(status: number | null, detail: string | null | undefined) {
  return status === 402 || /insufficient|credit|billing|payment|spend limit/i.test(detail ?? '');
}

export class ReplicateBillingError extends Error {
  constructor() {
    super(REPLICATE_BILLING_MESSAGE);
    this.name = 'ReplicateBillingError';
  }
}

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
  if (!response.ok) {
    if (isReplicateBillingFailure(response.status, data.detail)) throw new ReplicateBillingError();
    throw new Error(`Replicate ${response.status}: ${data.detail ?? 'request failed'}`);
  }
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
