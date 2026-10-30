import { generateText } from 'ai';

import { withModelFallback } from './llm-pool.ts';
import { findOrdersByRef, resolveStageInput } from './client-pulse.ts';
import { advanceOrder, confirmDeposit, createOrder } from './order-lifecycle.ts';
import { DEFAULT_ORDER_STAGE, DEPOSIT_RECEIVED } from './order-stages.ts';

// Lightweight, cost-efficient vision parser for chat screenshots (Viber, Messenger, etc.).
// Uses the cheap tier (gemini flash-lite) — NOT the strong CEO model — to stay within token budget.

export type ParsedClientUpdate = {
  clientName: string;
  projectName: string | null;
  stage: string | null; // canonical stage or null
  stageRaw: string | null; // what was written in the screenshot
  totalAmount: number | null;
  quantity: number | null;
  note: string | null;
};

export type VisionParseResult = {
  clients: ParsedClientUpdate[];
  summary: string;
  error: string | null;
};

const PARSE_PROMPT = `You are reading a screenshot of a chat (Viber/Messenger/SMS) or a handwritten/typed client list for a Philippine garment/uniform business (MJIC).

Extract EVERY client mentioned and their LATEST project status. For each client return:
- clientName: the client/organization name (required)
- projectName: the project/item (e.g. "50pcs jackets", "corporate uniforms") or null
- stage: ONE of these exact words that best matches their current status: inquiry, sourcing, design, quote, deposit, paid, sizing, sample, production, qc, balance, dispatch, done, hold, cancel. Map Filipino/English status words: "nag-inquire"/"bagong brief" = inquiry, "bumibili pa ng materials"/"buy mats"/"po" = sourcing, "mockup"/"artwork approved" = design, "quotation"/"presyo" = quote, "nag-down"/"naka-deposit" = deposit, "binayaran na"/"verified" = paid, "sizes/names" = sizing, "sample" = sample, "tinatahi"/"binaburda"/"cutting" = production, "QC"/"chine-check" = qc, "fully paid"/"balance" = balance, "naka-ready"/"for pickup"/"nadeliver"/"shipped" = dispatch, "tapos na" = done. If unclear, use null.
- stageRaw: the exact status phrase as written
- totalAmount: number in pesos if mentioned, else null
- quantity: number of pieces if mentioned, else null
- note: any important detail (deadline, revision, blocker), else null

Return ONLY valid JSON, no markdown, no explanation:
{"clients":[{"clientName":"...","projectName":"...","stage":"...","stageRaw":"...","totalAmount":null,"quantity":null,"note":"..."}],"summary":"one-line Taglish summary of what this screenshot shows"}

If no clients are found, return {"clients":[],"summary":"no clients found"}.`;

export async function parseClientScreenshot(image: { data: Uint8Array; mediaType: string }, caption: string): Promise<VisionParseResult> {
  try {
    const result = await withModelFallback({ tier: 'cheap', tools: false, budgetMs: 25_000, attemptMs: 15_000 }, (model, attemptMs) =>
      generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PARSE_PROMPT + (caption ? `\n\nCaption from sender: "${caption}"` : '') },
              { type: 'file', mediaType: image.mediaType, data: image.data },
            ],
          },
        ],
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(attemptMs),
      }),
    );
    const text = result.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(text) as { clients?: Array<Record<string, unknown>>; summary?: string };
    const clients: ParsedClientUpdate[] = (parsed.clients || [])
      .map((c) => ({
        clientName: String(c.clientName || '').trim(),
        projectName: c.projectName ? String(c.projectName).trim() : null,
        stage: c.stage ? resolveStageInput(String(c.stage)) : null,
        stageRaw: c.stageRaw ? String(c.stageRaw).trim() : null,
        totalAmount: typeof c.totalAmount === 'number' && c.totalAmount > 0 ? c.totalAmount : null,
        quantity: typeof c.quantity === 'number' && c.quantity > 0 ? Math.round(c.quantity) : null,
        note: c.note ? String(c.note).trim().slice(0, 300) : null,
      }))
      .filter((c) => c.clientName.length >= 2);
    return { clients, summary: String(parsed.summary || ''), error: null };
  } catch (error) {
    return { clients: [], summary: '', error: error instanceof Error ? error.message : 'Vision parse failed' };
  }
}

// Apply parsed updates to the database: update existing orders, create new ones.
// Returns per-client result lines for the Telegram confirmation.
export async function applyClientUpdates(clients: ParsedClientUpdate[]): Promise<{ lines: string[]; updated: number; created: number; failed: number }> {
  const lines: string[] = [];
  let updated = 0;
  let created = 0;
  let failed = 0;

  for (const client of clients) {
    try {
      const matches = await findOrdersByRef(client.clientName);
      if (matches.length > 1) {
        lines.push(`⚠️ ${client.clientName} — maraming match (${matches.map((o) => o.order_number).join(', ')}). Gamitin ang ORD-number.`);
        failed += 1;
        continue;
      }
      if (matches.length === 1) {
        const order = matches[0];
        if (!client.stage) {
          lines.push(`ℹ️ ${client.clientName} — existing order ${order.order_number} (${order.stage}), walang bagong stage na nabasa.`);
          continue;
        }
        const result = client.stage === DEPOSIT_RECEIVED
          ? await confirmDeposit(order.id, null)
          : await advanceOrder(order.id, client.stage, client.note || 'via screenshot');
        if (!result.ok) {
          lines.push(`❌ ${client.clientName} — ${result.error}`);
          failed += 1;
        } else {
          const newStage = client.stage === DEPOSIT_RECEIVED ? 'S06_SIZING' : client.stage;
          lines.push(`✅ ${client.clientName} — ${order.stage} → ${newStage}${client.note ? ` (${client.note})` : ''}`);
          updated += 1;
        }
        continue;
      }
      // No match — create a new order.
      const result = await createOrder({
        clientName: client.clientName,
        projectName: client.projectName,
        quantity: client.quantity,
        totalAmount: client.totalAmount ?? 0,
      });
      if (!result.order) {
        lines.push(`❌ ${client.clientName} — ${result.error}`);
        failed += 1;
        continue;
      }
      let finalStage = result.order.stage;
      if (client.stage && client.stage !== DEFAULT_ORDER_STAGE) {
        const moved = client.stage === DEPOSIT_RECEIVED
          ? await confirmDeposit(result.order.id, null)
          : await advanceOrder(result.order.id, client.stage, 'via screenshot (initial stage)');
        if (moved.ok) finalStage = client.stage === DEPOSIT_RECEIVED ? 'S06_SIZING' : client.stage;
      }
      lines.push(`✅ ${client.clientName} — NEW order ${result.order.order_number} (${finalStage})`);
      created += 1;
    } catch (error) {
      lines.push(`❌ ${client.clientName} — ${error instanceof Error ? error.message : 'unknown error'}`);
      failed += 1;
    }
  }
  return { lines, updated, created, failed };
}
