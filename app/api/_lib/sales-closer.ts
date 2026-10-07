import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, isStepCount } from 'ai';

import { type Channel, type CrmContact, addHours, getRecentMessages, logMessage, scoreMessage, updateContact, upsertContact } from './crm';
import { publicBaseUrl, sendChannelMessage } from './channels';
import { createApproval, isShadowMode } from './ceo-control';
import { escapeTelegramHtml, getSupabaseAdmin, isManilaDaytime, recordLead, reportCriticalError, sendTelegramMessage } from './integrations';
import { FIRST_MESSAGE_ADDENDUM, MJIC_SYSTEM_PROMPT, SAMPLE_JACKET_IMAGES } from './mjic-prompt';
import { mjicQuoteTool } from './sales-tools';

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

const CLOSER_ADDENDUM = `

===========================================================================
CHANNEL MODE (live social-media / messaging inbox)
===========================================================================
- You are replying inside a live chat as the MJIC sales team, typing like a real person on a phone.
- Plain text ONLY: no markdown, no bold, no headings, no bullet symbols other than "-", no image embeds (photos are attached separately by the system).
- Short Taglish messages, 1 to 4 short paragraphs, warm and respectful ("po", "Sir/Ma'am"). Always end with ONE clear next step or question that moves the sale forward.
- Never invent prices, dates, stock, discounts or guarantees. Use the quote tool for numbers. If asked for something outside policy (special discount, custom terms, exact delivery date not in your instructions), say you will confirm with the boss and update them shortly.
- Match the customer's language: English, Tagalog or Taglish. Keep Taglish by default.
- Do not volunteer that you are an AI, and never claim to be a specific named human. If someone sincerely asks whether they are talking to a bot or a real person, say you will hand them over to the team for a personal reply.
`;

const ESCALATION_PATTERN = /(refund|reklamo|complain|complaint|scam|estafa|lawyer|abogado|kasuhan|demanda|chargeback|bawi ang pera|return my money)/i;
const NEGOTIATION_PATTERN = /(discount|tawad|mura pa|special price|bawas|installment|hulugan|credit terms|net 30|rush order|bulk order)/i;
const IDENTITY_PATTERN = /(are you (a )?(bot|ai|robot|real person|human)|bot ka ba|robot ka ba|totoong tao|real person ba|ai ba)/i;

export type InboundInput = {
  channel: Channel;
  externalId: string;
  text: string;
  name?: string;
  phone?: string;
  email?: string;
  messageId?: string;
  commentId?: string;
  imageUrls?: string[];
};

export type InboundResult = { handled: boolean; reply: string | null; sent: boolean; escalated: boolean; duplicate: boolean };

function model() {
  return process.env.GEMINI_API_KEY ? google('gemini-3.6-flash') : anthropic('claude-sonnet-4-5');
}

// Failover: if the primary model errors, retry once on the other provider when its key exists.
function fallbackModel() {
  if (process.env.GEMINI_API_KEY && process.env.ANTHROPIC_API_KEY) return anthropic('claude-sonnet-4-5');
  return null;
}

function cleanForChat(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function styleBlock(audience: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return '';
  const { data } = await supabase.from('style_examples').select('prompt, example').eq('audience', audience).order('created_at', { ascending: false }).limit(14);
  if (!data?.length) return '';
  const lines = data.map((row) => (row.prompt ? `Customer: ${row.prompt}\nBoss reply: ${row.example}` : `Boss message: ${row.example}`));
  return `\n\nHOW THE BOSS REALLY WRITES (copy this voice, vocabulary, length and level of formality; these are real examples):\n${lines.join('\n---\n')}`;
}

async function buildSystem(isFirst: boolean, audience = 'client') {
  return `${MJIC_SYSTEM_PROMPT}${isFirst ? FIRST_MESSAGE_ADDENDUM : ''}${CLOSER_ADDENDUM}${await styleBlock(audience)}`;
}

function galleryUrls(count = 5) {
  const base = publicBaseUrl();
  return SAMPLE_JACKET_IMAGES.slice(0, count).map((path) => `${base}${path}`);
}

async function notifyCeo(lines: string[]) {
  await sendTelegramMessage(lines.join('\n'));
}

export async function handleInboundMessage(input: InboundInput): Promise<InboundResult> {
  const empty: InboundResult = { handled: false, reply: null, sent: false, escalated: false, duplicate: false };
  const text = input.text.trim();
  if (!text && !input.imageUrls?.length) return empty;

  const { contact, isNew, error } = await upsertContact(input);
  if (!contact) {
    await reportCriticalError('sales-closer:upsert-contact', new Error(error || 'unknown'), { channel: input.channel });
    return empty;
  }

  const logged = await logMessage({
    contactId: contact.id,
    channel: input.channel,
    direction: 'in',
    sender: 'customer',
    content: text || '[image attachment]',
    externalMessageId: input.messageId,
  });
  if (logged.duplicate) return { ...empty, duplicate: true };

  const label = `${escapeTelegramHtml(contact.name || contact.external_id)} (${input.channel})`;
  const reopened = contact.stage === 'dormant' || contact.stage === 'lost';
  await updateContact(contact.id, {
    last_inbound_at: new Date().toISOString(),
    followup_count: 0,
    next_followup_at: null,
    lead_score: scoreMessage(text, contact.lead_score),
    stage: contact.stage === 'new' || reopened ? 'engaged' : contact.stage,
  });

  if (isNew) {
    void recordLead({ name: input.name, contact: input.phone || input.email || input.externalId, message: text, source: `${input.channel}-inbox` });
    void notifyCeo([`<b>NEW LEAD — ${label}</b>`, escapeTelegramHtml(text.slice(0, 300))]);
  }

  if (contact.ai_paused) {
    void notifyCeo([`<b>Customer replied (AI paused) — ${label}</b>`, escapeTelegramHtml(text.slice(0, 300))]);
    return { ...empty, handled: true };
  }

  // Payment proofs and complaints always go to a human; the customer still gets an immediate holding reply.
  let holding: string | null = null;
  let escalate = false;
  if (input.imageUrls?.length) {
    holding = 'Received po ang inyong proof of payment. I-verify lang po namin saglit at ico-confirm po namin agad. Salamat po!';
    void notifyCeo([`<b>PAYMENT PROOF / IMAGE — ${label}</b>`, input.imageUrls.map(escapeTelegramHtml).join('\n'), 'Please verify (use payment-verify).']);
  } else if (ESCALATION_PATTERN.test(text)) {
    holding = 'Pasensya na po sa abala. Ipapasa ko po agad ito sa aming boss para personal po kayong matulungan. Babalikan po namin kayo sa lalong madaling panahon.';
    escalate = true;
  } else if (IDENTITY_PATTERN.test(text)) {
    holding = 'Sandali lang po, ipapasa ko po kayo sa aming team para personal po kayong masagot.';
    escalate = true;
  }

  if (escalate) {
    await updateContact(contact.id, { ai_paused: true });
    void notifyCeo([`🚨 <b>NEEDS YOU — ${label}</b>`, escapeTelegramHtml(text.slice(0, 400)), 'AI is paused on this contact. Reply via POST /api/crm {id, reply}, or set ai_paused:false to resume.']);
  }

  let reply = holding;
  let quoted = false;
  if (!reply) {
    try {
      const history = await getRecentMessages(contact.id, 14);
      const isFirst = history.filter((message) => message.direction === 'out').length === 0;
      const messages = history.map((message) => ({ role: message.direction === 'in' ? ('user' as const) : ('assistant' as const), content: message.content }));
      if (!messages.length || messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: text });
      const system = await buildSystem(isFirst);
      const run = (chosen: ReturnType<typeof model>) => generateText({
        model: chosen,
        system,
        messages,
        tools: { calculateMJICQuote: mjicQuoteTool },
        stopWhen: isStepCount(3),
        abortSignal: AbortSignal.timeout(25000),
      });
      const backup = fallbackModel();
      const result = await run(model()).catch((primaryError) => {
        if (!backup) throw primaryError;
        console.error('primary model failed, using fallback:', primaryError);
        return run(backup);
      });
      reply = cleanForChat(result.text);
      quoted = result.steps.some((step) => step.toolCalls?.some((call) => call.toolName === 'calculateMJICQuote'));
    } catch (aiError) {
      await reportCriticalError('sales-closer:generate', aiError, { channel: input.channel, contact: contact.id });
    }
  }

  if (!reply) {
    void notifyCeo([`<b>AI could not reply — ${label}</b>`, escapeTelegramHtml(text.slice(0, 300)), 'Please answer manually.']);
    return { ...empty, handled: true };
  }

  // Special terms are the CEO's call: park the AI draft behind an Approve/Reject button and send only a holding line.
  if (!holding && NEGOTIATION_PATTERN.test(text)) {
    await createApproval({
      kind: 'special-terms',
      summary: `${contact.name || contact.external_id} (${input.channel}) asked: "${text.slice(0, 300)}"\nAI draft: ${reply.slice(0, 400)}\nApprove = send the AI draft as is. Reject = you reply personally.`,
      action: { type: 'send_reply', contactId: contact.id, channel: input.channel, externalId: input.externalId, text: reply },
    });
    await updateContact(contact.id, { ai_paused: true });
    reply = 'Noted po. Kino-confirm ko lang po sa aming boss ang request ninyo at babalikan namin kayo agad.';
  }

  if (await isShadowMode()) {
    await logMessage({ contactId: contact.id, channel: input.channel, direction: 'out', sender: 'ai', content: reply, status: 'draft' });
    await updateContact(contact.id, { next_followup_at: null });
    void notifyCeo([`<b>SHADOW MODE draft - ${label}</b>`, `Customer: ${escapeTelegramHtml(text.slice(0, 300))}`, `AI would send:\n${escapeTelegramHtml(reply.slice(0, 700))}`]);
    return { handled: true, reply: null, sent: false, escalated: escalate, duplicate: false };
  }

  const isFirstReply = (await getRecentMessages(contact.id, 30)).filter((message) => message.direction === 'out').length === 0;
  const sendResult = await sendChannelMessage(input.channel, input.externalId, reply, {
    commentId: input.commentId,
    images: isFirstReply && !holding ? galleryUrls() : [],
  });

  await logMessage({
    contactId: contact.id,
    channel: input.channel,
    direction: 'out',
    sender: 'ai',
    content: reply,
    status: sendResult.ok ? 'sent' : 'draft',
  });
  await updateContact(contact.id, {
    last_outbound_at: new Date().toISOString(),
    next_followup_at: escalate ? null : addHours(3),
    ...(quoted && (contact.stage === 'new' || contact.stage === 'engaged' || reopened) ? { stage: 'quoted' } : {}),
  });

  if (!sendResult.ok) {
    void notifyCeo([`<b>Reply NOT delivered — ${label}</b>`, `Reason: ${escapeTelegramHtml(sendResult.reason || 'unknown')}`, `Draft:\n${escapeTelegramHtml(reply.slice(0, 600))}`]);
  }
  return { handled: true, reply, sent: sendResult.ok, escalated: escalate, duplicate: false };
}

export async function generateFollowUp(contact: CrmContact, attempt: number) {
  const history = await getRecentMessages(contact.id, 14);
  const messages = history.map((message) => ({ role: message.direction === 'in' ? ('user' as const) : ('assistant' as const), content: message.content }));
  messages.push({
    role: 'user',
    content: `[SYSTEM NOTE - not from the customer] The customer has gone quiet. Write follow-up #${attempt} (of 2). ${attempt === 1 ? 'Friendly, short check-in that restates the next step and offers help.' : 'Last gentle nudge: mention the sample option (₱2,500, fully deductible) or a quick call, no pressure.'} Do not repeat earlier wording. Never invent prices.`,
  });
  const result = await generateText({ model: model(), system: await buildSystem(false), messages, abortSignal: AbortSignal.timeout(30000) });
  return cleanForChat(result.text);
}

export { isManilaDaytime };
