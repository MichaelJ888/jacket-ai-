import { tool } from 'ai';
import { z } from 'zod';

import { createApproval, getSetting, setSetting } from './ceo-control';
import { CRON_JOBS, cronRisk, evaluateGuard, sanitizePageKey, type CronJob } from './ceo-policy';
import { runCronJob } from './ceo-exec';
import { listPageBrands } from './page-brands';
import { updateContact } from './crm';
import { advanceOrder, confirmDeposit } from './order-lifecycle';
import { findOrdersByRef, resolveStageInput } from './client-pulse';
import { getSupabaseAdmin } from './integrations';

// Action tools for the CEO bot. Each one goes through guarded(): kill switch, daily action budget, injection screen, audit log.
// Money, public publishing, deletion and code changes are never executed here: they become a one-tap Telegram approval.

async function guarded<T>(name: string, input: unknown, run: () => Promise<T>): Promise<T | { blocked: string }> {
  const supabase = getSupabaseAdmin();
  const killSwitch = (await getSetting('kill_switch', 'off')) === 'on';
  const dailyCap = Number(process.env.CEO_DAILY_ACTION_CAP || 200);
  let actionsToday = 0;
  if (supabase) {
    const { count } = await supabase.from('system_logs').select('id', { count: 'exact', head: true }).eq('context', 'ceo-audit').gte('created_at', new Date(Date.now() - 86400000).toISOString());
    actionsToday = count || 0;
  }
  const verdict = evaluateGuard({ killSwitch, actionsToday, dailyCap, payload: input });
  const audit = (outcome: string) => supabase?.from('system_logs').insert({ severity: verdict.ok ? 'info' : 'warning', context: 'ceo-audit', message: `${name}: ${outcome}`, details: { input: JSON.stringify(input).slice(0, 800) } });
  if (!verdict.ok) {
    await audit(`BLOCKED - ${verdict.reason}`);
    return { blocked: verdict.reason };
  }
  try {
    const result = await run();
    await audit('ok');
    return result;
  } catch (error) {
    await audit(`error - ${error instanceof Error ? error.message : 'unknown'}`);
    throw error;
  }
}

export function buildActionTools() {
  return {
    set_page_brand: tool({
      description: 'Map a ManyChat page_identifier (e.g. "cebu") to the branch/brand name the sales AI uses when replying on that Facebook/Instagram Page. Safe, instant, no redeploy. Call with no brand to list current mappings.',
      inputSchema: z.object({ page: z.string().min(1).max(40).optional(), brand: z.string().min(2).max(80).optional() }),
      execute: async (input) => guarded('set_page_brand', input, async () => {
        const brands = await listPageBrands();
        if (!input.page || !input.brand) return { brands };
        const key = sanitizePageKey(input.page);
        if (!key) return { error: 'Invalid page identifier' };
        const stored = JSON.parse((await getSetting('page_brands', '')) || '{}') as Record<string, string>;
        stored[key] = input.brand.trim();
        await setSetting('page_brands', JSON.stringify(stored));
        return { saved: true, brands: { ...brands, [key]: input.brand.trim() } };
      }),
    }),

    set_contact_ai: tool({
      description: 'Pause or resume the sales AI for ONE customer (search by name, phone or contact id fragment). Safe and reversible.',
      inputSchema: z.object({ search: z.string().min(2).max(80), paused: z.boolean() }),
      execute: async (input) => guarded('set_contact_ai', input, async () => {
        const supabase = getSupabaseAdmin();
        if (!supabase) return { error: 'Supabase is not configured' };
        const term = input.search.replace(/[%,()]/g, ' ').trim();
        const { data } = await supabase.from('crm_contacts').select('id, name, external_id').or(`name.ilike.%${term}%,external_id.ilike.%${term}%,phone.ilike.%${term}%`).limit(3);
        if (!data?.length) return { error: 'No matching contact' };
        if (data.length > 1) return { error: 'Several contacts match; be more specific', matches: data.map((row) => row.name || row.external_id) };
        await updateContact(data[0].id, { ai_paused: input.paused });
        return { contact: data[0].name || data[0].external_id, ai_paused: input.paused };
      }),
    }),

    run_cron: tool({
      description: `Trigger a scheduled job now. Safe jobs run immediately (${Object.entries(CRON_JOBS).filter(([, risk]) => risk === 'auto').map(([job]) => job).join(', ')}). Jobs that touch money, publish publicly, book external services or delete data (${Object.entries(CRON_JOBS).filter(([, risk]) => risk === 'approval').map(([job]) => job).join(', ')}) are sent to the CEO as an Approve/Reject button first. Unknown jobs are refused.`,
      inputSchema: z.object({ job: z.string().min(2).max(40) }),
      execute: async ({ job }) => guarded('run_cron', { job }, async () => {
        const risk = cronRisk(job);
        if (!risk) return { error: `Unknown job. Allowed: ${Object.keys(CRON_JOBS).join(', ')}` };
        if (risk === 'approval') {
          const approval = await createApproval({ kind: 'run-cron', summary: `Run the "${job}" job now? It can touch money, publish, book or delete.`, action: { type: 'run_cron', job: job as CronJob } });
          return { status: 'awaiting_ceo_approval', approval_id: approval.id };
        }
        const result = await runCronJob(job as CronJob);
        return { job, ok: result.ok, http_status: result.status, detail: result.body };
      }),
    }),

    request_code_change: tool({
      description: 'Request a change to the MJIC system itself (new feature, bug fix, upgrade). Always needs the CEO\'s one-tap approval; then a GitHub issue opens for the coding agent, which makes a pull request. CI runs lint/test/build and the CEO merges. Nothing is deployed automatically.',
      inputSchema: z.object({ title: z.string().min(5).max(120), details: z.string().min(20).max(4000).describe('Self-contained description of the change and why.') }),
      execute: async (input) => guarded('request_code_change', input, async () => {
        const approval = await createApproval({ kind: 'code-change', summary: `Code change request: ${input.title}\n${input.details.slice(0, 600)}`, action: { type: 'code_change', title: input.title, body: input.details } });
        return { status: 'awaiting_ceo_approval', approval_id: approval.id };
      }),
    }),

    propose_improvement: tool({
      description: 'Propose an improvement to the business or the AI system as a structured idea. It goes to the CEO as a one-tap Approve/Reject; on approval a GitHub issue opens for the coding agent (pull request, CI, CEO merges). Nothing deploys automatically. Always gather evidence first (system_introspection, query_business_data).',
      inputSchema: z.object({
        title: z.string().min(5).max(120),
        problem: z.string().min(10).max(1200).describe('What is wrong or missing, with the evidence/numbers.'),
        proposal: z.string().min(10).max(1800).describe('Exactly what to build or change.'),
        expected_impact: z.string().min(5).max(400).describe('Peso or time impact.'),
        effort: z.enum(['low', 'medium', 'high']),
      }),
      execute: async (input) => guarded('propose_improvement', input, async () => {
        const body = `Problem:\n${input.problem}\n\nProposal:\n${input.proposal}\n\nExpected impact: ${input.expected_impact}\nEffort: ${input.effort}`;
        const approval = await createApproval({ kind: 'improvement', summary: `Improvement idea: ${input.title}\nImpact: ${input.expected_impact}\nEffort: ${input.effort}`, action: { type: 'code_change', title: input.title, body } });
        return { status: 'awaiting_ceo_approval', approval_id: approval.id };
      }),
    }),

    update_order: tool({
      description: 'Update a client order\'s production stage when the CEO says so in chat (typed, or transcribed from a photo/voice note). Find the order by client name or ORD-number, then move it to a new stage. Stages: deposit, paid, po, cutting, embroidery, sewing, qc, packing, ready, shipped, delivered, done, hold, cancel. Use this whenever the CEO reports progress on a client (e.g. "Max project tapos na ang sewing", "Philflex nadeliver na").',
      inputSchema: z.object({
        ref: z.string().min(2).max(80).describe('Client name or ORD-number the CEO mentioned.'),
        stage: z.string().min(2).max(30).describe('The new stage (shortcut or full name).'),
        note: z.string().max(300).optional().describe('Optional note about the update.'),
      }),
      execute: async (input) => guarded('update_order', input, async () => {
        const stage = resolveStageInput(input.stage);
        if (!stage) return { error: `Unknown stage "${input.stage}". Use: deposit, paid, po, cutting, embroidery, sewing, qc, packing, ready, shipped, delivered, done, hold, cancel` };
        const matches = await findOrdersByRef(input.ref);
        if (!matches.length) return { error: `No open order matches "${input.ref}".` };
        if (matches.length > 1) return { error: `Multiple matches for "${input.ref}": ${matches.map((o) => `${o.order_number} (${o.client_name || o.project_name}, ${o.stage})`).join('; ')}. Ask the CEO which one or use the ORD-number.` };
        const order = matches[0];
        const result = stage === 'DEPOSIT_VERIFIED'
          ? await confirmDeposit(order.id, null)
          : await advanceOrder(order.id, stage, (input.note || 'via CEO Telegram').slice(0, 300));
        if (!result.ok) return { error: `${order.order_number}: ${result.error}` };
        return { updated: true, order_number: order.order_number, client: order.client_name || order.project_name, from: order.stage, to: stage };
      }),
    }),

    kill_switch: tool({
      description: 'Emergency stop. ON freezes every action tool (read-only tools still work) until turned OFF. Use immediately if anything looks wrong.',
      inputSchema: z.object({ state: z.enum(['on', 'off']) }),
      execute: async ({ state }) => {
        await setSetting('kill_switch', state);
        return { kill_switch: state };
      },
    }),
  };
}
